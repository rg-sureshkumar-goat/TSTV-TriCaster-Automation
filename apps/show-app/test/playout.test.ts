// The playout on this laptop: it plays real clips and music and sends them over NDI; a receiver here checks
// what the TC1's input 4 would get. Skipped on a computer without the NDI runtime (NDI Tools).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { BANDWIDTH, COLOR, FRAME, findRuntime, listSources, loadNdi, videoBuffer, audioBuffer, type Ndi } from '../src/main/ndi.ts';
import { Playout } from '../src/main/playout.ts';

const run = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
const NAME = `TSTV Show App (test ${process.pid})`;

let folder: string;
let playout: Playout;
let ndi: Ndi;
let receiver: unknown;

/**
 * Frames and sound from the playout for a while (or until `done` says so): the last picture's corner and
 * bar pixels, and the loudest sound.
 */
function receive(ms: number, done?: (got: { bar: number[]; corner: number[]; peak: number }) => boolean) {
  const video = videoBuffer(ndi);
  const audio = audioBuffer(ndi);
  let frames = 0;
  let peak = 0;
  let bar: number[] = [];
  let corner: number[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end && !(done && frames > 0 && done({ bar, corner, peak }))) {
    const kind = ndi.recvCapture(receiver, video.buffer, audio.buffer, null, 50);
    if (kind === FRAME.video) {
      const v = video.read();
      const pixels = new Uint8Array(ndi.koffi.view(v.p_data as never, v.line_stride_in_bytes * v.yres));
      const at = (x: number, y: number) => Array.from(pixels.slice((y * v.xres + x) * 4, (y * v.xres + x) * 4 + 4));
      bar = at(300, 600);
      corner = at(20, 20);
      frames++;
      ndi.recvFreeVideo(receiver, video.buffer);
    } else if (kind === FRAME.audio) {
      const a = audio.read();
      const all = new Float32Array(ndi.koffi.view(a.p_data as never, a.channel_stride_in_bytes * a.no_channels).slice(0));
      // Each channel has spare room after its samples, which isn't sound.
      for (let c = 0; c < a.no_channels; c++) {
        const from = (c * a.channel_stride_in_bytes) / 4;
        for (let i = from; i < from + a.no_samples; i++) peak = Math.max(peak, Math.abs(all[i]));
      }
      ndi.recvFreeAudio(receiver, audio.buffer);
    }
  }
  return { frames, bar, corner, peak };
}

const hasNdi = findRuntime() !== null;

describe.skipIf(!hasNdi)('the playout, over NDI on this laptop', () => {
  beforeAll(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-playout-'));
    const file = (name: string) => path.join(folder, name);
    // A 2-second ProRes 4444 lower third: a blue bar on see-through, no sound.
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0:s=1920x1080:r=30:d=2,format=rgba,drawbox=x=120:y=800:w=900:h=140:color=0x2563eb@1:t=fill:replace=1,format=yuva444p10le', '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', file('A1_L3_Bar.mov')]);
    // A 4-second clip with a loud tone.
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file('A2_VO_Tone.mp4')]);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'libmp3lame', file('Music.mp3')]);
    // Green-screen backgrounds: an orange still, and a 1-second green clip.
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xff8000:s=1920x1080', '-frames:v', '1', file('Background.png')]);
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x00c000:s=1280x720:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('Background.mp4')]);

    playout = new Playout(NAME);
    playout.setPlaylist([
      { name: 'A1_L3_Bar', path: file('A1_L3_Bar.mov'), seconds: 2 },
      { name: 'A2_VO_Tone', path: file('A2_VO_Tone.mp4'), seconds: 4 },
      // Its drive is unplugged: the copy plays.
      { name: 'A3_L3_Gone', path: '/Volumes/Unplugged/A3_L3_Gone.mov', fallback: file('A1_L3_Bar.mov'), seconds: 2 },
    ]);
    ndi = loadNdi();
    const finder = ndi.findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: null });
    let source = null;
    for (let i = 0; i < 20 && !source; i++) {
      ndi.findWait(finder, 500);
      // Exactly the graphics source, not "… Background".
      source = listSources(ndi, finder).find((s) => s.p_ndi_name.endsWith(`(${NAME})`)) ?? null;
    }
    expect(source).not.toBeNull();
    receiver = ndi.recvCreate({ source_to_connect_to: source, color_format: COLOR.BGRX_BGRA, bandwidth: BANDWIDTH.highest, allow_video_fields: false, p_ndi_recv_name: 'TSTV test' });
    receive(500);
  }, 60_000);

  afterAll(async () => {
    if (receiver) ndi.recvDestroy(receiver);
    await playout?.close();
    if (folder) await rm(folder, { recursive: true, force: true });
  });

  it('plays a graphic with its see-through parts, holds its last frame, and says when it ended', async () => {
    const ended = new Promise<number>((resolve) => playout.once('ended', resolve));
    playout.select(0);
    playout.play();
    const got = receive(1200);
    expect(got.frames).toBeGreaterThan(20);
    // BGRA: the bar is solid blue, the corner fully see-through.
    expect(got.bar[3]).toBe(255);
    expect(got.bar[0]).toBeGreaterThan(200);
    expect(got.corner[3]).toBe(0);
    expect(await ended).toBe(0);
    expect(playout.state.item).toBe(0);
  }, 20_000);

  it('cuts straight to the next clip with its sound, through the fader', async () => {
    playout.select(1);
    playout.play();
    // However long a busy computer takes to start the clip.
    const loud = receive(5000, (got) => got.bar[2] > 200 && got.peak > 0.3);
    // The red clip fills the picture: solid red (BGRA).
    expect(loud.bar[2]).toBeGreaterThan(200);
    expect(loud.bar[0]).toBeLessThan(60);
    expect(loud.bar[3]).toBe(255);
    expect(loud.peak).toBeGreaterThan(0.3);
    // The fader, by the playout's own level (what the Sound meter shows): a quarter is 12 dB down.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await wait(300);
    const before = playout.state.level;
    playout.fader(0.25);
    await wait(400);
    expect(before - playout.state.level).toBeGreaterThan(9);
    playout.fader(1);
  }, 20_000);

  it('plays the copy of a graphic whose original can’t be read', async () => {
    playout.stop();
    receive(3000, (got) => got.bar[3] === 0);
    playout.select(2);
    playout.play();
    const got = receive(5000, (g) => g.bar[3] === 255);
    expect(got.bar[3]).toBe(255);
    expect(got.bar[0]).toBeGreaterThan(200);
  }, 20_000);

  it('sends the green-screen background as its own source: a still, or a clip on a loop', async () => {
    const finder = ndi.findCreate({ show_local_sources: true, p_groups: null, p_extra_ips: null });
    let source = null;
    for (let i = 0; i < 20 && !source; i++) {
      ndi.findWait(finder, 500);
      source = listSources(ndi, finder).find((s) => s.p_ndi_name.endsWith(`(${NAME} Background)`)) ?? null;
    }
    expect(source).not.toBeNull();
    const main = receiver;
    receiver = ndi.recvCreate({ source_to_connect_to: source, color_format: COLOR.BGRX_BGRA, bandwidth: BANDWIDTH.highest, allow_video_fields: false, p_ndi_recv_name: 'TSTV test background' });
    try {
      playout.background(path.join(folder, 'Background.png'));
      // Orange (BGRA), solid, in the corner too: it fills the picture.
      const still = receive(5000, (got) => got.corner[2] > 200 && got.corner[1] > 100 && got.corner[0] < 60);
      expect(still.corner[3]).toBe(255);
      expect(still.corner[2]).toBeGreaterThan(200);
      playout.background(path.join(folder, 'Background.mp4'));
      receive(5000, (got) => got.corner[1] > 150 && got.corner[2] < 60);
      // A 1-second clip still sends a picture every frame long after it would have ended: it loops.
      const looping = receive(2500);
      expect(looping.frames).toBeGreaterThan(50);
      expect(looping.corner[1]).toBeGreaterThan(150);
      playout.background(null);
    } finally {
      ndi.recvDestroy(receiver);
      receiver = main;
      ndi.findDestroy(finder);
    }
  }, 30_000);

  it('clears input 4 when DSK 2 goes off, and plays the music', async () => {
    playout.stop();
    const cleared = receive(3000, (got) => got.bar[3] === 0);
    expect(cleared.bar[3]).toBe(0);
    playout.music(true, path.join(folder, 'Music.mp3'));
    const withMusic = receive(5000, (got) => got.peak > 0.05);
    expect(withMusic.peak).toBeGreaterThan(0.05);
    // The playout's report arrives once this test lets it.
    await new Promise((r) => setTimeout(r, 100));
    expect(playout.state.musicPlaying).toBe(true);
    playout.music(false);
  }, 20_000);
});
