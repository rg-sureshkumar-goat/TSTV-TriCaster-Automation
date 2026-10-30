// Talks to the simulator over the network the same three ways the show app will talk to the TC1.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import { startSimulator, type RunningSimulator } from '../src/server.ts';

let sim: RunningSimulator;
beforeEach(async () => {
  sim = await startSimulator({ httpPort: 0, statePort: 0 });
});
afterEach(async () => {
  await sim.close();
});

const api = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${sim.httpPort}${p}`, init);

function connectStatePort(): Promise<{ socket: net.Socket; received: () => string }> {
  return new Promise((resolve, reject) => {
    let text = '';
    const socket = net.connect({ host: '127.0.0.1', port: sim.statePort }, () => resolve({ socket, received: () => text }));
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (text += chunk));
    socket.on('error', reject);
  });
}

const waitFor = async (check: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('simulator web API', () => {
  it('identifies itself as the simulator', async () => {
    const res = await api('/v1/version');
    expect(res.headers.get('x-tstv-simulator')).toBe('true');
    expect(await res.text()).toContain('<product_name>TSTV Simulator</product_name>');
  });

  it('runs a shortcut command and logs it as coming from the web API', async () => {
    await api('/v1/shortcut?name=v1_a_row_named_input&value=INPUT3');
    expect(sim.switcher.mes.v1.a).toBe('input3');
    await api('/v1/shortcut?name=main_a_row_named_input&value=V2');
    expect(await (await api('/v1/dictionary?key=switcher')).text()).toContain('main_source="V2"');
    expect(sim.externalCommands()).toMatchObject([
      { source: 'http', name: 'v1_a_row_named_input', value: 'INPUT3', result: 'ok' },
      { source: 'http', name: 'main_a_row_named_input', value: 'V2', result: 'ok' },
    ]);
  });

  it('accepts XML commands in a POST', async () => {
    await api('/v1/shortcut', { method: 'POST', body: '<shortcuts><shortcut name="main_dsk2_take" /><shortcut name="record_toggle" value="1" /></shortcuts>' });
    expect(sim.switcher.dsks.main_dsk2.onAir).toBe(true);
    expect(sim.switcher.recording.on).toBe(true);
  });

  it('drops the connection when asked for data it does not have, like the real TC1', async () => {
    await expect(api('/v1/dictionary?key=nothing_here')).rejects.toThrow();
  });

  it('reports DDR playlists, clip timing and recording the way the real TC1 does', async () => {
    const playlist = await (await api('/v1/dictionary?key=ddr_playlist')).text();
    expect(playlist).toMatch(/<ddr2 custom_short_name="B"[^>]*><playlist [^>]*current_clip="0">/);
    expect(playlist).toContain('alias="TSTV Ident 2022 News"');
    const timecode = await (await api('/v1/dictionary?key=ddr_timecode')).text();
    expect(timecode).toMatch(/<ddr2 clip_seconds_elapsed="0" clip_seconds_remaining="4.963"/);
    expect(await (await api('/v1/dictionary?key=record_configuration')).text()).toBe('<state is_recording="false" />');
  });

  it('asks for the LivePanel password when that practice problem is on', async () => {
    sim.faults.password = 'secret';
    const denied = await api('/v1/version');
    expect(denied.status).toBe(401);
    expect(denied.headers.get('www-authenticate')).toContain('Basic');
    const allowed = await api('/v1/version', { headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` } });
    expect(allowed.status).toBe(200);
  });

  it('acts unplugged when that practice problem is on', async () => {
    sim.faults.offline = true;
    await expect(api('/v1/version')).rejects.toThrow();
    // The simulator page itself keeps working so you can turn the problem off again.
    expect((await api('/sim/api/state')).status).toBe(200);
  });
});

describe('simulator state port (5951)', () => {
  it('sends build info and every state after register, then each change', async () => {
    const { socket, received } = await connectStatePort();
    socket.write('<register name="NTK_states"/>\n');
    await waitFor(() => received().includes('</shortcut_states>'));
    expect(received()).toContain('<build number=');
    expect(received()).toContain('name="main_dsk2_value" value="0"');
    sim.switcher.command('panel', 'main_dsk2_take');
    await waitFor(() => received().includes('name="main_dsk2_value" value="1"'));
    socket.destroy();
  });

  it('accepts XML commands', async () => {
    const { socket } = await connectStatePort();
    socket.write('<shortcut name="v1_a_row_named_input" value="INPUT2" />\n');
    await waitFor(() => sim.switcher.mes.v1.a === 'input2');
    expect(sim.externalCommands()[0]).toMatchObject({ source: 'tcp', name: 'v1_a_row_named_input' });
    socket.destroy();
  });

  it('sends nothing to a client that has not registered', async () => {
    const { socket, received } = await connectStatePort();
    sim.switcher.command('panel', 'main_dsk2_take');
    await new Promise((r) => setTimeout(r, 200));
    expect(received()).toBe('');
    socket.destroy();
  });
});

describe('simulator change notifications', () => {
  it('names the data that changed', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${sim.httpPort}/v1/change_notifications`);
    const messages: string[] = [];
    ws.on('message', (data) => messages.push(String(data)));
    await new Promise((r) => ws.once('open', r));
    sim.switcher.command('panel', 'main_a_row', 'V2');
    await waitFor(() => messages.includes('switcher\0'));
    // The real TC1 ends each notification with a null character.
    expect(messages).toEqual(expect.arrayContaining(['tally\0', 'switcher\0', 'shortcut_states\0']));
    ws.close();
  });
});

describe('camera video', () => {
  it('streams a moving test picture for each camera, as JPEG frames', async () => {
    const controller = new AbortController();
    const response = await api('/sim/video/input2', { signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('multipart/x-mixed-replace;boundary=ffmpeg');
    const reader = response.body!.getReader();
    let text = '';
    while (!/Content-type: image\/jpeg/i.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('latin1');
    }
    expect(text).toMatch(/--ffmpeg/);
    expect(text).toMatch(/Content-type: image\/jpeg/i);
    controller.abort();
    expect((await api('/sim/video/input7')).status).toBe(404);
  }, 15_000);
});
