// Network side of the simulator. It answers on the same addresses as a real TriCaster
// (web API, change notifications, port-5951 state stream), plus /sim for its own page.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import ffmpegStatic from 'ffmpeg-static';
import { Switcher, type ChangeEvent, type CommandRecord } from './switcher.ts';
import { MACROS, type ClipSpec } from './profile.ts';
import {
  buildXml,
  ddrPlaylistXml,
  ddrTimecodeXml,
  effectsXml,
  macrosXml,
  parseShortcutCommands,
  productInformationXml,
  recordConfigurationXml,
  shortcutStatesXml,
  switcherXml,
  tallyXml,
} from './xml.ts';

export interface Faults {
  /** Pretend the cable is unplugged: refuse and drop every connection to the TC1 interfaces. */
  offline: boolean;
  /** Delay every TC1 reply and command by this many milliseconds. */
  latencyMs: number;
  /** Accept commands but do nothing with them. */
  dropCommands: boolean;
  /** When set, the web API asks for this LivePanel password (user "admin"). */
  password: string | null;
}

export interface SimulatorOptions {
  host?: string;
  httpPort?: number;
  statePort?: number;
}

export interface RunningSimulator {
  host: string;
  httpPort: number;
  statePort: number;
  switcher: Switcher;
  faults: Faults;
  /** Commands that arrived from outside (web API or state port), not from the simulator page. */
  externalCommands: () => CommandRecord[];
  close: () => Promise<void>;
}

const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const UI_FILES: Record<string, string> = {
  '/sim/': 'index.html',
  '/sim/index.html': 'index.html',
  '/sim/app.js': 'app.js',
  '/sim/style.css': 'style.css',
};
const CONTENT_TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export async function startSimulator(options: SimulatorOptions = {}): Promise<RunningSimulator> {
  const host = options.host ?? '127.0.0.1';
  const switcher = new Switcher();
  const faults: Faults = { offline: false, latencyMs: 0, dropCommands: false, password: null };
  const stateClients = new Set<net.Socket>();
  const registered = new Set<net.Socket>();
  const notifyClients = new Set<WebSocket>();
  const uiClients = new Set<WebSocket>();
  const sockets = new Set<net.Socket>();

  const delay = () => (faults.latencyMs > 0 ? new Promise((r) => setTimeout(r, faults.latencyMs)) : Promise.resolve());

  // ---- Changes go out to every listener ----
  switcher.on('change', (event: ChangeEvent) => {
    if (event.states.length > 0) {
      const xml = `${shortcutStatesXml(event.states)}\n`;
      for (const client of registered) client.write(xml);
    }
    // The real TC1 ends each notification with a null character.
    for (const key of event.keys) for (const ws of notifyClients) ws.send(`${key}\0`);
    pushUi();
  });
  let uiTimer: NodeJS.Timeout | undefined;
  const pushUi = () => {
    if (uiTimer) return;
    uiTimer = setTimeout(() => {
      uiTimer = undefined;
      const message = JSON.stringify(uiState());
      for (const ws of uiClients) ws.send(message);
    }, 50);
  };
  switcher.on('tick', pushUi);
  switcher.on('command', pushUi);

  const uiState = () => ({
    type: 'state',
    switcher: switcher.snapshot(),
    faults,
    log: switcher.commandLog().slice(-200).reverse(),
    connections: { stateStream: stateClients.size, notifications: notifyClients.size },
    ports: { http: httpPort, state: statePort },
  });

  // ---- Web API and simulator page ----
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://sim.local');
    try {
      if (url.pathname.startsWith('/v1')) {
        if (faults.offline) return void req.socket.destroy();
        await delay();
        if (!authorized(req, faults)) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LivePanel (simulated)"', 'X-TSTV-Simulator': 'true' });
          res.end('Password required');
          return;
        }
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname === '/' || url.pathname === '/sim') {
        res.writeHead(302, { Location: '/sim/' });
        res.end();
        return;
      }
      if (url.pathname.startsWith('/sim/api/')) {
        await handleSimApi(req, res, url);
        return;
      }
      const video = /^\/sim\/video\/input([1-3])$/.exec(url.pathname);
      if (video) return cameraVideo(req, res, Number(video[1]));
      const file = UI_FILES[url.pathname];
      if (file) {
        const body = await fs.readFile(path.join(UI_DIR, file));
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err));
    }
  });

  /**
   * A moving test picture for each camera (Phase 4), so the show app's camera boxes play video on the
   * simulator. Each camera has its own tint. It's a stream of JPEG frames, which any web page can show,
   * made by FFmpeg only while someone is watching. How the real TC1's cameras reach the laptop is still
   * to be found at the station (the probe now lists the TC1's NDI video feeds).
   */
  function cameraVideo(req: http.IncomingMessage, res: http.ServerResponse, camera: number) {
    const ffmpeg = ffmpegStatic as unknown as string | null;
    if (faults.offline || !ffmpeg) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end(faults.offline ? 'The simulated TC1 is unplugged' : 'FFmpeg is missing');
      return;
    }
    const hue = [0, 0, 120, 240][camera];
    const maker = spawn(
      ffmpeg,
      ['-v', 'error', '-re', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=12,hue=h=${hue}`, '-f', 'mpjpeg', '-q:v', '8', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=ffmpeg', 'Cache-Control': 'no-store', 'X-TSTV-Simulator': 'true' });
    maker.stdout.pipe(res);
    const stop = () => maker.kill('SIGKILL');
    req.on('close', stop);
    maker.on('exit', () => res.end());
    videoMakers.add(maker);
    maker.on('exit', () => videoMakers.delete(maker));
  }
  const videoMakers = new Set<ReturnType<typeof spawn>>();

  const xml = (res: http.ServerResponse, body: string, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/xml; charset=utf-8', 'X-TSTV-Simulator': 'true' });
    res.end(body);
  };

  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const remote = req.socket.remoteAddress;
    switch (url.pathname) {
      case '/v1/version':
        return xml(res, productInformationXml());
      case '/v1/dictionary': {
        const key = url.searchParams.get('key') ?? '';
        const body = dictionary(key);
        // The real TC1 drops the connection when asked for data it doesn't have.
        if (body === undefined) return void req.socket.destroy();
        return xml(res, body);
      }
      case '/v1/datalink':
        return xml(res, '<datalink_values></datalink_values>');
      case '/v1/shortcut': {
        const commands: { name: string; value?: string }[] = [];
        const name = url.searchParams.get('name');
        if (name) commands.push({ name, value: url.searchParams.get('value') ?? undefined });
        if (req.method === 'POST') commands.push(...parseShortcutCommands(await readBody(req)));
        for (const c of commands) switcher.command('http', c.name, c.value, remote);
        return xml(res, '<shortcut_response result="ok" />');
      }
      default:
        return xml(res, '', 404);
    }
  }

  function dictionary(key: string): string | undefined {
    switch (key) {
      case 'shortcut_states':
        return shortcutStatesXml(switcher.shortcutStates());
      case 'tally':
        return tallyXml(switcher.tallyColumns());
      case 'switcher':
        return switcherXml(switcher.program, switcher.preview, switcher.dsks);
      case 'macros_list':
        return macrosXml(MACROS);
      case 'switcher_ui_effects':
        return effectsXml();
      case 'ddr_playlist':
        return ddrPlaylistXml(Object.values(switcher.snapshot().players));
      case 'ddr_timecode':
        return ddrTimecodeXml(Object.values(switcher.snapshot().players));
      case 'record_configuration':
        return recordConfigurationXml(switcher.recording.on);
      default:
        return undefined;
    }
  }

  async function handleSimApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const route = url.pathname.slice('/sim/api/'.length);
    if (req.method === 'GET' && route === 'state') return json(uiState());
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
    const body = JSON.parse((await readBody(req)) || '{}');
    switch (route) {
      case 'panel':
        return json(switcher.command('panel', String(body.name), body.value === undefined ? undefined : String(body.value)));
      case 'faults':
        if (typeof body.offline === 'boolean') {
          faults.offline = body.offline;
          if (faults.offline) dropConnections();
        }
        if (body.latencyMs !== undefined) faults.latencyMs = Math.max(0, Math.min(10_000, Number(body.latencyMs) || 0));
        if (typeof body.dropCommands === 'boolean') faults.dropCommands = switcher.dropCommands = body.dropCommands;
        if (body.password !== undefined) faults.password = body.password ? String(body.password) : null;
        pushUi();
        return json(faults);
      case 'playlist':
        switcher.loadPlaylist(String(body.player), (body.clips ?? []) as ClipSpec[]);
        return json({ ok: true });
      case 'clip-end':
        switcher.endClipNow(String(body.player));
        return json({ ok: true });
      case 'reset':
        Object.assign(faults, { offline: false, latencyMs: 0, dropCommands: false, password: null });
        switcher.dropCommands = false;
        switcher.reset();
        switcher.clearLog();
        pushUi();
        return json({ ok: true });
      case 'clear-log':
        switcher.clearLog();
        pushUi();
        return json({ ok: true });
      default:
        return json({ error: 'Unknown simulator action' }, 404);
    }
  }

  // ---- WebSockets: TriCaster change notifications and the simulator page's live feed ----
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://sim.local');
    if (url.pathname === '/v1/change_notifications') {
      if (faults.offline) return socket.destroy();
      if (!authorized(req, faults)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="LivePanel (simulated)"\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        notifyClients.add(ws);
        ws.on('close', () => notifyClients.delete(ws));
        pushUi();
      });
    } else if (url.pathname === '/sim/events') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        uiClients.add(ws);
        ws.on('close', () => uiClients.delete(ws));
        ws.send(JSON.stringify(uiState()));
      });
    } else {
      socket.destroy();
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // ---- Port 5951: state stream and XML commands ----
  const stateServer = net.createServer((socket) => {
    if (faults.offline) return void socket.destroy();
    stateClients.add(socket);
    pushUi();
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk: string) => {
      buffer += chunk;
      if (/<register\s+name="NTK_states"\s*\/>/i.test(buffer) && !registered.has(socket)) {
        registered.add(socket);
        socket.write(buildXml());
        socket.write(`${shortcutStatesXml(switcher.shortcutStates())}\n`);
      }
      const commands = parseShortcutCommands(buffer);
      const lastTag = buffer.lastIndexOf('>');
      buffer = lastTag >= 0 ? buffer.slice(lastTag + 1) : buffer;
      if (buffer.length > 100_000) buffer = '';
      if (commands.length > 0) await delay();
      for (const c of commands) switcher.command('tcp', c.name, c.value, socket.remoteAddress);
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      stateClients.delete(socket);
      registered.delete(socket);
      pushUi();
    });
  });

  function dropConnections() {
    for (const s of stateClients) s.destroy();
    for (const ws of notifyClients) ws.terminate();
  }

  const httpPort = await listen(server, host, options.httpPort ?? 8080);
  const statePort = await listen(stateServer, host, options.statePort ?? 5951);

  return {
    host,
    httpPort,
    statePort,
    switcher,
    faults,
    externalCommands: () => switcher.commandLog().filter((c) => c.source === 'http' || c.source === 'tcp'),
    close: async () => {
      clearTimeout(uiTimer);
      for (const maker of videoMakers) maker.kill('SIGKILL');
      for (const ws of [...notifyClients, ...uiClients]) ws.terminate();
      for (const s of stateClients) s.destroy();
      for (const s of sockets) s.destroy();
      wss.close();
      switcher.close();
      await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => stateServer.close(r))]);
    },
  };
}

function authorized(req: http.IncomingMessage, faults: Faults): boolean {
  if (!faults.password) return true;
  const header = req.headers.authorization ?? '';
  const expected = `Basic ${Buffer.from(`admin:${faults.password}`).toString('base64')}`;
  return header === expected;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function listen(server: net.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}
