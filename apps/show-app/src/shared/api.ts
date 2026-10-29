// What the show app's window shows, and what the producer can do in it. The app sends the whole state
// to the window whenever it changes.
import type { CueBehavior, ElementType } from '@tstv/shared';

export type LinkStatus = 'off' | 'connecting' | 'connected' | 'error';

export interface ElementView {
  id: string;
  sectionId: string;
  sectionLabel: string;
  /** Like "Take L3 Score". */
  label: string;
  type: ElementType;
  behavior: CueBehavior;
  file: string | null;
  seconds: number | null;
  /** A small JPEG, as a data: URL. */
  thumbnail: string | null;
  /** Where its file sits in DDR 2, counting from 0; null when DDR 2 doesn't have it. */
  ddrItem: number | null;
  skipped: boolean;
}

export interface SectionView {
  id: string;
  label: string;
  slug: string;
  camera: string;
  elements: ElementView[];
}

export interface FileProblem {
  path: string;
  name: string;
  /** Why the app couldn't place it, in plain words. */
  reason: string;
  /** The elements it could go on. */
  candidates: { id: string; label: string }[];
}

export interface AppState {
  website: { status: LinkStatus; error: string | null; siteUrl: string; key: string };
  episode: { id: string; title: string; showName: string; airDate: string; airTime: string } | null;
  cameras: { name: string; input: number }[];
  switcher: {
    status: LinkStatus | 'refused';
    error: string | null;
    address: string;
    /** The camera input on air through M/E 1. */
    programInput: number | null;
    dskOn: boolean;
    ddrItem: number | null;
    ddrPlaying: boolean;
    ddrRemaining: number | null;
    musicPlaying: boolean;
    playlist: string[];
    soundTracks: string[];
  };
  prompter: { connected: boolean; label: string; speed: number; paused: boolean };
  automation: {
    paused: boolean;
    sectionId: string | null;
    sectionLabel: string | null;
    onAir: ElementView | null;
    upNext: ElementView[];
    nextChoice: string | null;
  };
  sections: SectionView[];
  problems: FileProblem[];
  /** The music's in and out points: "default", "none", "section:<id>" or "cue:<id>". */
  music: { in: string; out: string; defaults: { in: string; out: string }; points: { id: string; label: string }[] };
  clock: { startedAt: number | null; sectionLabel: string | null; overUnderSeconds: number | null };
  lastCue: { label: string; latencyMs: number | null; at: number } | null;
  log: { at: number; text: string }[];
}

export type Action =
  | { kind: 'connect'; siteUrl: string; key: string }
  | { kind: 'disconnect' }
  | { kind: 'connectSwitcher'; address: string }
  | { kind: 'fireNext' }
  | { kind: 'skip'; elementId: string; skipped: boolean }
  | { kind: 'chooseNext'; elementId: string | null }
  | { kind: 'takeCamera'; input: number }
  | { kind: 'pause'; paused: boolean }
  | { kind: 'importFiles' }
  | { kind: 'addFiles'; paths: string[] }
  | { kind: 'chooseFile'; elementId: string }
  | { kind: 'assign'; path: string; elementId: string }
  | { kind: 'clearFile'; elementId: string }
  | { kind: 'dismissProblem'; path: string }
  | { kind: 'loadSimulator' }
  | { kind: 'setMusic'; in: string; out: string };
