// The app's side of the playout (Phase 5): starts playout-worker.ts in the background and passes it the
// show's clips, the cue engine's commands, the music and the Sound fader; reports what's playing on input 4,
// like DDR 2 does on the simulator.
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { PlayoutMessage, PlayoutReport } from './playout-worker.ts';
import { startWorker } from './workers.ts';

export interface PlayoutState {
  item: number | null;
  playing: boolean;
  paused: boolean;
  remaining: number | null;
  musicPlaying: boolean;
  /** How many receivers (the TC1's input 4, its multiview) take the source. */
  connections: number;
  /** The level of the sound going to the TC1, in dB, after the fader. */
  level: number;
  error: string | null;
}

export class Playout extends EventEmitter {
  private worker: Worker;
  state: PlayoutState = { item: null, playing: false, paused: false, remaining: null, musicPlaying: false, connections: 0, level: -60, error: null };

  /** The NDI sources' names, as the TC1 lists them after the machine's name (RIGSTER). */
  constructor(name = 'Graphics', backgroundName = 'Green Screen', transitionName = 'Transition') {
    super();
    this.worker = startWorker('playout-worker', { name, backgroundName, transitionName });
    this.worker.on('message', (report: PlayoutReport) => {
      if (report.type === 'ended') return void this.emit('ended', report.item);
      if (report.type === 'level') {
        this.state.level = report.db;
        return void this.emit('level', report.db);
      }
      if (report.type === 'error') this.state.error = report.message;
      else this.state = { ...this.state, item: report.item, playing: report.playing, paused: report.paused, remaining: report.remaining, musicPlaying: report.musicPlaying, connections: report.connections };
      this.emit('change');
    });
    this.worker.on('error', (e: Error) => {
      this.state.error = e.message;
      this.emit('change');
    });
  }

  private send(message: PlayoutMessage): void {
    this.worker.postMessage(message);
  }

  /** The show's clips, in the order the cue engine numbers them (see Runtime.playlistClips). */
  setPlaylist(clips: { name: string; path: string; fallback?: string; seconds: number | null }[]): void {
    this.send({ type: 'playlist', clips });
  }

  select(item: number): void {
    this.send({ type: 'select', item });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  stop(): void {
    this.send({ type: 'stop' });
  }

  pause(paused: boolean): void {
    this.send({ type: 'pause', paused });
  }

  music(play: boolean, path?: string): void {
    this.send({ type: 'music', play, path });
  }

  /** The green-screen background, sent as the "… Background" source; null for none. */
  background(path: string | null, fallback?: string): void {
    this.send({ type: 'background', path, fallback });
  }

  /** Plays a transition once, on its own source (RIGSTER (Transition), shown by DSK 4 on the TC1). */
  transition(path: string, fallback?: string): void {
    this.send({ type: 'transition', path, fallback });
  }

  fader(level: number): void {
    this.send({ type: 'fader', level });
  }

  async close(): Promise<void> {
    this.send({ type: 'close' });
    await new Promise((r) => setTimeout(r, 200));
    await this.worker.terminate();
  }
}
