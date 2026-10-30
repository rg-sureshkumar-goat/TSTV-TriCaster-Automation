// The TC1's feeds in the app (Phase 5, runs in a background worker): in live mode, the camera boxes show the
// TC1's camera feeds (1)–(3) and the Program box its program feed (MIX 1), received over NDI on the cable
// and served on this laptop as moving JPEG pictures, which a page shows like any picture (the simulator's
// cameras work the same way). Recording saves the program feed, picture and sound, to the laptop.
// Tested at the studio Oct 30, 2026: the feeds are 1280×720 at 59.94 frames a second.
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import { parentPort } from 'node:worker_threads';
import ffmpegStatic from 'ffmpeg-static';
import { BANDWIDTH, COLOR, FRAME, audioBuffer, copyBytes, copySound, listSources, loadNdi, videoBuffer } from './ndi.ts';

const ffmpeg = ffmpegStatic as unknown as string;

export type FeedsMessage = { type: 'record'; file: string } | { type: 'stopRecording' } | { type: 'close' };
export type FeedsReport =
  | { type: 'ready'; port: number }
  | { type: 'recording'; file: string | null; seconds: number; error: string | null }
  | { type: 'error'; message: string };

const post = (report: FeedsReport) => parentPort?.postMessage(report);

function startFeeds(): void {
  const ndi = loadNdi();
  const finder = ndi.findCreate({ show_local_sources: false, p_groups: null, p_extra_ips: null });

  /** The TC1's feed for a name in a URL: "1" to "4" are its inputs, "program" is MIX 1. */
  const sourceFor = (feed: string) => {
    const label = feed === 'program' ? '(MIX 1)' : `(${feed})`;
    return listSources(ndi, finder).find((s) => /^TC1-/i.test(s.p_ndi_name) && s.p_ndi_name.endsWith(label)) ?? null;
  };

  /**
   * One viewer of a feed: an NDI receiver whose frames FFmpeg turns into moving JPEG for the page, at most
   * fps frames a second. Stops when the page stops watching.
   */
  const watch = (feed: string, fps: number, res: http.ServerResponse, req: http.IncomingMessage) => {
    const source = sourceFor(feed);
    if (!source) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('That feed isn’t on the cable right now.');
    }
    const receiver = ndi.recvCreate({ source_to_connect_to: source, color_format: COLOR.BGRX_BGRA, bandwidth: BANDWIDTH.lowest, allow_video_fields: false, p_ndi_recv_name: 'TSTV Show App' });
    const video = videoBuffer(ndi);
    let maker: ChildProcess | null = null;
    let size = '';
    let last = 0;
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=ffmpeg', 'Cache-Control': 'no-store' });
    const timer = setInterval(() => {
      // Whatever has arrived since the last look; only the newest picture matters.
      for (let kind = ndi.recvCapture(receiver, video.buffer, null, null, 0); kind !== FRAME.none; kind = ndi.recvCapture(receiver, video.buffer, null, null, 0)) {
        if (kind !== FRAME.video) continue;
        const v = video.read();
        const now = performance.now();
        if (now - last >= 1000 / fps - 2) {
          last = now;
          const frameSize = `${v.xres}x${v.yres}`;
          if (frameSize !== size) {
            // A new picture size (the first frame, or NDI switching quality): a fresh FFmpeg for it.
            maker?.kill('SIGKILL');
            size = frameSize;
            maker = spawn(ffmpeg, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', size, '-r', String(fps), '-i', 'pipe:0', '-vf', `scale='min(960,iw)':-2`, '-f', 'mpjpeg', '-q:v', '7', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
            maker.stdout!.pipe(res, { end: false });
            maker.stdin!.on('error', () => undefined);
          }
          const bytes = copyBytes(ndi, v.p_data, v.line_stride_in_bytes * v.yres);
          if (maker?.stdin?.writable && maker.stdin.writableLength < 8 * 1024 * 1024) maker.stdin.write(bytes);
        }
        ndi.recvFreeVideo(receiver, video.buffer);
      }
    }, 1000 / 60);
    req.on('close', () => {
      clearInterval(timer);
      maker?.kill('SIGKILL');
      ndi.recvDestroy(receiver);
    });
  };

  const server = http.createServer((req, res) => {
    const match = /^\/feed\/(1|2|3|4|program)$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (!match) {
      res.writeHead(404);
      return res.end();
    }
    watch(match[1], match[1] === 'program' ? 30 : 15, res, req);
  });
  server.listen(0, '127.0.0.1', () => post({ type: 'ready', port: (server.address() as { port: number }).port }));

  // ---- Recording the program feed to the laptop ----

  let recording: { stop: () => void } | null = null;

  /**
   * Saves the TC1's program feed (MIX 1), picture and sound, as an MP4 on the laptop: H.264 (the Mac's own
   * encoder, or x264 on Windows) and AAC. The file is written in pieces, so it plays even if the laptop
   * stops partway.
   */
  const record = (file: string) => {
    const source = sourceFor('program');
    if (!source) return post({ type: 'recording', file: null, seconds: 0, error: 'The TC1’s program feed isn’t on the cable, so there’s nothing to record.' });
    const receiver = ndi.recvCreate({ source_to_connect_to: source, color_format: COLOR.BGRX_BGRA, bandwidth: BANDWIDTH.highest, allow_video_fields: false, p_ndi_recv_name: 'TSTV Show App recording' });
    const video = videoBuffer(ndi);
    const audio = audioBuffer(ndi);
    let encoder: ChildProcess | null = null;
    let started = 0;
    let error: string | null = null;
    const encode = (size: string, rate: string) => {
      const picture = process.platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-b:v', '12M'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
      encoder = spawn(
        ffmpeg,
        [
          '-v', 'error', '-y',
          '-use_wallclock_as_timestamps', '1', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', size, '-r', rate, '-i', 'pipe:0',
          '-use_wallclock_as_timestamps', '1', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'pipe:3',
          '-map', '0:v', '-map', '1:a', ...picture, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
          '-fps_mode', 'cfr', '-r', rate, '-movflags', '+frag_keyframe+empty_moov', file,
        ],
        { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] },
      );
      let said = '';
      encoder.stderr!.on('data', (chunk: Buffer) => (said += chunk.toString()));
      encoder.on('exit', (code) => {
        if (code && !stopping) {
          error = `Recording stopped: ${said.trim().split('\n').pop() ?? 'FFmpeg quit'}`;
          post({ type: 'recording', file: null, seconds: 0, error });
        }
      });
      encoder.stdin!.on('error', () => undefined);
      (encoder.stdio[3] as NodeJS.WritableStream).on('error', () => undefined);
      started = Date.now();
    };
    let stopping = false;
    const timer = setInterval(() => {
      for (let kind = ndi.recvCapture(receiver, video.buffer, audio.buffer, null, 0); kind !== FRAME.none; kind = ndi.recvCapture(receiver, video.buffer, audio.buffer, null, 0)) {
        if (kind === FRAME.video) {
          const v = video.read();
          if (!encoder) encode(`${v.xres}x${v.yres}`, `${v.frame_rate_N}/${v.frame_rate_D}`);
          const pipe = encoder!.stdin!;
          if (pipe.writable && pipe.writableLength < 64 * 1024 * 1024) pipe.write(copyBytes(ndi, v.p_data, v.line_stride_in_bytes * v.yres));
          ndi.recvFreeVideo(receiver, video.buffer);
        } else if (kind === FRAME.audio) {
          const a = audio.read();
          if (encoder) {
            // The file takes the first two channels.
            const out = copySound(ndi, a);
            const pipe = (encoder as ChildProcess).stdio[3] as NodeJS.WritableStream & { writable: boolean };
            if (pipe.writable) pipe.write(Buffer.from(out.buffer));
          }
          ndi.recvFreeAudio(receiver, audio.buffer);
        }
      }
    }, 1000 / 120);
    const report = setInterval(() => post({ type: 'recording', file, seconds: started ? (Date.now() - started) / 1000 : 0, error }), 1000);
    post({ type: 'recording', file, seconds: 0, error: null });
    recording = {
      stop: () => {
        stopping = true;
        clearInterval(timer);
        clearInterval(report);
        ndi.recvDestroy(receiver);
        const e = encoder as ChildProcess | null;
        e?.stdin?.end();
        (e?.stdio[3] as NodeJS.WritableStream | undefined)?.end();
        post({ type: 'recording', file: null, seconds: 0, error: null });
      },
    };
  };

  parentPort?.on('message', (message: FeedsMessage) => {
    if (message.type === 'record') {
      recording?.stop();
      record(message.file);
    } else if (message.type === 'stopRecording') {
      recording?.stop();
      recording = null;
    } else if (message.type === 'close') {
      recording?.stop();
      server.close();
      ndi.findDestroy(finder);
      process.exit(0);
    }
  });
}

try {
  startFeeds();
} catch (e) {
  post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
}
