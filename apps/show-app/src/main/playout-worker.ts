// The playout (Phase 5, runs in a background worker): plays the show's graphics and music on the laptop and
// sends them to the TC1's input 4 over NDI, picture with its see-through parts, and sound (decided Oct 30,
// 2026). It also sends the show's green-screen background as a second source, "… Background", which the TC1
// uses behind the keyed cameras (RG, Oct 30, 2026). It stands in for DDR 2: the app selects a clip, plays it, stops it, and hears when it ends. FFmpeg
// reads each file at the TC1 session's size (1280×720) and 29.97 frames a second. The music and the clip's
// sound are mixed, through the Sound fader. See playout.ts for the app's side.
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parentPort, workerData } from 'node:worker_threads';
import { ffmpegPath } from './ffmpeg.ts';
import { FOURCC_BGRA, loadNdi, NDI_TIMECODE } from './ndi.ts';

export const WIDTH = 1280;
export const HEIGHT = 720;
const FPS_N = 30000;
const FPS_D = 1001;
const FPS = FPS_N / FPS_D;
const RATE = 48000;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const SAMPLES_PER_FRAME = (RATE * FPS_D) / FPS_N;
const ffmpeg = ffmpegPath!;
const run = promisify(execFile);

export type PlayoutMessage =
  /** fallback: the app's small playable copy, played if the original can't be read (its drive unplugged or blocked). */
  | { type: 'playlist'; clips: { name: string; path: string; fallback?: string; seconds: number | null }[] }
  | { type: 'select'; item: number }
  | { type: 'play' }
  | { type: 'stop' }
  | { type: 'music'; play: boolean; path?: string }
  | { type: 'fader'; level: number }
  /** The green-screen background (a still or a clip, which loops), or none; fallback as for the playlist. */
  | { type: 'background'; path: string | null; fallback?: string }
  | { type: 'close' };

export type PlayoutReport =
  | { type: 'state'; item: number | null; playing: boolean; remaining: number | null; musicPlaying: boolean; connections: number }
  | { type: 'ended'; item: number }
  | { type: 'level'; db: number }
  | { type: 'error'; message: string };

const post = (report: PlayoutReport) => parentPort?.postMessage(report);

/** What FFmpeg says a file has: its length, and whether it has sound and moving pictures. */
async function probe(file: string): Promise<{ seconds: number | null; audio: boolean; still: boolean; readable: boolean }> {
  const output = await run(ffmpeg, ['-hide_banner', '-i', file], { timeout: 15_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? '',
  );
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return { seconds: seconds > 0.2 ? seconds : null, audio: /Audio:/.test(output), still: seconds <= 0.2, readable: /Video:|Audio:/.test(output) };
}

/** Float sound, two channels interleaved, kept in order as it arrives. */
class SoundQueue {
  private chunks: Float32Array[] = [];
  private offset = 0;
  length = 0;

  /** Bytes of a sample cut off at the end of the last chunk FFmpeg sent. */
  private leftover = Buffer.alloc(0);

  push(bytes: Buffer): void {
    const all = this.leftover.length ? Buffer.concat([this.leftover, bytes]) : bytes;
    const whole = all.length - (all.length % 4);
    this.leftover = Buffer.from(all.subarray(whole));
    // Copied out, so the samples are aligned whatever the chunk's position in memory.
    const copy = new Float32Array(whole >> 2);
    new Uint8Array(copy.buffer).set(all.subarray(0, whole));
    this.chunks.push(copy);
    this.length += copy.length;
  }

  /** Adds up to `samples` stereo samples into `out`, scaled; returns how many there were. */
  mixInto(out: Float32Array, samples: number): number {
    let wanted = samples * 2;
    let at = 0;
    while (wanted > 0 && this.chunks.length) {
      const chunk = this.chunks[0];
      const n = Math.min(wanted, chunk.length - this.offset);
      for (let i = 0; i < n; i++) out[at + i] += chunk[this.offset + i];
      at += n;
      wanted -= n;
      this.offset += n;
      this.length -= n;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    return at / 2;
  }

  get seconds(): number {
    return this.length / 2 / RATE;
  }
}

/** A clip being read by FFmpeg: a few frames of picture, and its sound, ready ahead of time. */
class Clip {
  frames: Buffer[] = [];
  sound = new SoundQueue();
  done = false;
  sent = 0;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private process: ChildProcess;

  constructor(
    readonly item: number,
    readonly file: string,
    readonly totalFrames: number | null,
    audio: boolean,
    still: boolean,
  ) {
    // Fit inside 1280×720 keeping the shape, with see-through bars if it doesn't fill it.
    const picture = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=bgra`;
    const args = ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', picture, ...(still ? ['-frames:v', '1'] : ['-r', `${FPS_N}/${FPS_D}`]), '-f', 'rawvideo', 'pipe:1'];
    if (audio && !still) args.push('-map', '0:a:0', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', 'pipe:3');
    this.process = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore', 'pipe'] });
    this.process.stdout!.on('data', (chunk: Buffer) => this.onPicture(chunk));
    (this.process.stdio[3] as NodeJS.ReadableStream | null)?.on('data', (chunk: Buffer) => this.sound.push(chunk));
    this.process.on('exit', () => (this.done = true));
    this.process.on('error', () => (this.done = true));
  }

  private onPicture(chunk: Buffer): void {
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    while (this.pendingBytes >= FRAME_BYTES) {
      const all = Buffer.concat(this.pending);
      this.frames.push(all.subarray(0, FRAME_BYTES));
      const rest = all.subarray(FRAME_BYTES);
      this.pending = rest.length ? [rest] : [];
      this.pendingBytes = rest.length;
    }
    // Half a second ahead is plenty; FFmpeg waits until frames are used.
    if (this.frames.length >= 15) this.process.stdout!.pause();
  }

  /** The next picture, if it's ready. */
  take(): Buffer | undefined {
    const frame = this.frames.shift();
    if (this.frames.length < 8) this.process.stdout!.resume();
    return frame;
  }

  get ready(): boolean {
    return this.frames.length > 0 || this.done;
  }

  get remaining(): number | null {
    return this.totalFrames === null ? null : Math.max(0, (this.totalFrames - this.sent) / FPS);
  }

  close(): void {
    this.process.kill('SIGKILL');
  }
}

/**
 * The green-screen background: a still, sent over and over, or a clip, on a loop. It fills the picture
 * (cropped to 16:9 if it isn't), with no sound.
 */
class Background {
  private frames: Buffer[] = [];
  private stillFrame: Buffer | null = null;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private process: ChildProcess;

  constructor(
    file: string,
    readonly still: boolean,
  ) {
    const picture = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},format=bgra`;
    const args = ['-v', 'error', ...(still ? [] : ['-stream_loop', '-1']), '-i', file, '-map', '0:v:0', '-vf', picture, ...(still ? ['-frames:v', '1'] : ['-r', `${FPS_N}/${FPS_D}`]), '-f', 'rawvideo', 'pipe:1'];
    this.process = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.pending.push(chunk);
      this.pendingBytes += chunk.length;
      while (this.pendingBytes >= FRAME_BYTES) {
        const all = Buffer.concat(this.pending);
        const frame = all.subarray(0, FRAME_BYTES);
        if (this.still) this.stillFrame = frame;
        else this.frames.push(frame);
        const rest = all.subarray(FRAME_BYTES);
        this.pending = rest.length ? [rest] : [];
        this.pendingBytes = rest.length;
      }
      if (this.frames.length >= 15) this.process.stdout!.pause();
    });
    this.process.on('error', () => undefined);
  }

  /** The picture for this frame, if there's one to send. */
  take(): Buffer | undefined {
    if (this.still) return this.stillFrame ?? undefined;
    const frame = this.frames.shift();
    if (this.frames.length < 8) this.process.stdout!.resume();
    return frame;
  }

  close(): void {
    this.process.kill('SIGKILL');
  }
}

/** The music track, read by FFmpeg as sound only, a few seconds ahead. */
class Music {
  sound = new SoundQueue();
  done = false;
  private process: ChildProcess;

  constructor(file: string) {
    this.process = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.sound.push(chunk);
      // A few seconds ahead is plenty.
      if (this.sound.seconds > 4) this.process.stdout!.pause();
    });
    this.process.on('exit', () => (this.done = true));
    this.process.on('error', () => (this.done = true));
  }

  /** Keeps FFmpeg reading once the music has played down to a couple of seconds ahead. */
  topUp(): void {
    if (this.sound.seconds < 2) this.process.stdout!.resume();
  }

  close(): void {
    this.process.kill('SIGKILL');
  }
}

function startPlayout(name: string): void {
  const ndi = loadNdi();
  const sender = ndi.sendCreate({ p_ndi_name: name, p_groups: null, clock_video: false, clock_audio: false });
  const backgroundSender = ndi.sendCreate({ p_ndi_name: `${name} Background`, p_groups: null, clock_video: false, clock_audio: false });
  let background: Background | null = null;
  // The latest background asked for wins, if two come quickly.
  let backgroundAsked = 0;
  const clear = Buffer.alloc(FRAME_BYTES);
  let playlist: { name: string; path: string; fallback?: string; seconds: number | null }[] = [];
  const probes = new Map<string, Promise<{ seconds: number | null; audio: boolean; still: boolean; readable: boolean }>>();
  const probeOf = (file: string) => {
    if (!probes.has(file)) {
      const asked = probe(file);
      probes.set(file, asked);
      // A file that couldn't be read (its drive unplugged) is asked about again next time, in case it's back.
      void asked.then((info) => !info.readable && probes.delete(file));
    }
    return probes.get(file)!;
  };
  // What's on input 4: the clip playing or held, the one selected next, and whether it plays.
  let current: Clip | null = null;
  let next: Clip | null = null;
  let playing = false;
  let switchWhenReady = false;
  // The clip being selected, while FFmpeg is asked about it.
  let selecting: number | null = null;
  let music: Music | null = null;
  let fader = 1;
  let tick = 0;
  let lastState = '';

  const sendPicture = (data: Buffer, to: unknown = sender) =>
    ndi.sendVideo(to, {
      xres: WIDTH,
      yres: HEIGHT,
      FourCC: FOURCC_BGRA,
      frame_rate_N: FPS_N,
      frame_rate_D: FPS_D,
      picture_aspect_ratio: WIDTH / HEIGHT,
      frame_format_type: 1,
      timecode: NDI_TIMECODE,
      p_data: data,
      line_stride_in_bytes: WIDTH * 4,
      p_metadata: null,
      timestamp: 0n,
    });

  const state = (force = false) => {
    const report = { type: 'state' as const, item: current?.item ?? null, playing, remaining: current?.remaining ?? null, musicPlaying: !!music, connections: ndi.sendConnections(sender, 0) };
    const key = JSON.stringify({ ...report, remaining: report.remaining === null ? null : Math.round(report.remaining) });
    if (force || key !== lastState) post(report);
    lastState = key;
  };

  /** Input 4 shows nothing: a see-through frame, so a DSK going on never flashes an old picture. */
  const clearPicture = () => sendPicture(clear);
  clearPicture();

  const select = async (item: number) => {
    const clip = playlist[item];
    if (!clip) return;
    selecting = item;
    let file = clip.path;
    let info = await probeOf(file);
    if (!info.readable && clip.fallback) {
      // The original can't be read right now: the small copy plays instead, rather than nothing.
      file = clip.fallback;
      info = await probeOf(file);
      post({ type: 'error', message: `Couldn’t read ${clip.name}; playing the app’s small copy of it.` });
    }
    // A later select won.
    if (selecting !== item) return;
    selecting = null;
    next?.close();
    const seconds = info.seconds ?? clip.seconds;
    next = new Clip(item, file, info.still || !seconds ? null : Math.round(seconds * FPS), info.audio, info.still);
  };

  // Each frame: the clip's next picture and its sound, plus the music, through the fader.
  const started = performance.now();
  const step = () => {
    tick++;
    const samples = Math.floor(tick * SAMPLES_PER_FRAME) - Math.floor((tick - 1) * SAMPLES_PER_FRAME);
    const sound = new Float32Array(samples * 2);
    if (switchWhenReady && next?.ready) {
      // Straight from the clip on input 4 to the next one, with no gap between them.
      current?.close();
      current = next;
      next = null;
      switchWhenReady = false;
      playing = true;
    }
    if (current && playing) {
      const frame = current.take();
      if (frame) {
        sendPicture(frame);
        current.sent++;
        current.sound.mixInto(sound, samples);
      } else if (current.done) {
        // The clip ended: its last picture stays on input 4, as DDR 2 holds it.
        playing = false;
        post({ type: 'ended', item: current.item });
      }
    }
    // The background: a clip's next frame, or a still twice a second (the TC1 holds the last one).
    if (background && (!background.still || tick % 15 === 0)) {
      const frame = background.take();
      if (frame) sendPicture(frame, backgroundSender);
    }
    if (music) {
      music.sound.mixInto(sound, samples);
      music.topUp();
      if (music.done && music.sound.length === 0) {
        music.close();
        music = null;
      }
    }
    let peak = 0;
    for (let i = 0; i < sound.length; i++) {
      sound[i] *= fader;
      peak = Math.max(peak, Math.abs(sound[i]));
    }
    ndi.sendAudioInterleaved(sender, { sample_rate: RATE, no_channels: 2, no_samples: samples, timecode: NDI_TIMECODE, p_data: Buffer.from(sound.buffer) });
    if (tick % 3 === 0) post({ type: 'level', db: peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60 });
    state(tick % 15 === 0 && playing);
    // On time, however long this frame took.
    const due = started + (tick * 1000) / FPS;
    setTimeout(step, Math.max(0, due - performance.now()));
  };
  setTimeout(step, 1000 / FPS);

  parentPort?.on('message', (message: PlayoutMessage) => {
    switch (message.type) {
      case 'playlist':
        playlist = message.clips;
        for (const clip of playlist) void probeOf(clip.path);
        return;
      case 'select':
        void select(message.item);
        return;
      case 'play':
        if (next || selecting !== null) switchWhenReady = true;
        else if (current) playing = true;
        return;
      case 'stop':
        // DSK 2 off: the clip stops, and input 4 is cleared for the next one.
        current?.close();
        current = null;
        playing = false;
        switchWhenReady = false;
        clearPicture();
        state(true);
        return;
      case 'music':
        music?.close();
        music = message.play && message.path ? new Music(message.path) : null;
        state(true);
        return;
      case 'fader':
        fader = Math.max(0, Math.min(2, message.level));
        return;
      case 'background':
        void (async () => {
          const asked = ++backgroundAsked;
          background?.close();
          background = null;
          if (!message.path) return;
          let file = message.path;
          let info = await probeOf(file);
          if (!info.readable && message.fallback) {
            file = message.fallback;
            info = await probeOf(file);
          }
          if (asked === backgroundAsked) background = new Background(file, info.still);
        })();
        return;
      case 'close':
        current?.close();
        next?.close();
        music?.close();
        background?.close();
        ndi.sendDestroy(sender);
        ndi.sendDestroy(backgroundSender);
        process.exit(0);
    }
  });
}

try {
  startPlayout((workerData as { name?: string } | undefined)?.name ?? 'TSTV Show App');
} catch (e) {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}
