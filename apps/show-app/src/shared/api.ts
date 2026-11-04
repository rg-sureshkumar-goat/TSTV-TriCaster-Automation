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
  /** A copy of its file the Program box can play (a file: URL), once the app has made it. */
  playable: string | null;
  /** False when the app can't read its file right now (its drive is unplugged or blocked) and it has no copy yet. */
  fileFound: boolean;
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
  /** Where it could go: element ids, or "perm:<name>" for a permanent graphic. */
  candidates: { id: string; label: string }[];
}

/** One of the show's permanent graphics, with its file on this laptop. */
export interface PermanentView {
  name: string;
  withSound: boolean;
  file: string | null;
  seconds: number | null;
  thumbnail: string | null;
}

export interface AppState {
  /** The show's two transitions, saved in its profile (RG, Nov 2, 2026). */
  transitions: { which: 'tease' | 'lites'; file: string | null; seconds: number | null; thumbnail: string | null; playable: string | null }[];
  /** Show profiles (RG, Nov 2, 2026): every show, from the website, with its logo, and the one picked by hand. */
  profiles: { id: string; name: string; logo: string | null }[];
  profile: { id: string; name: string } | null;
  /**
   * Whether a profile has been picked since RiGster opened: it opens on the Select A Show Profile page every
   * time (RG, Nov 2, 2026).
   */
  profilePicked: boolean;
  /** The RiGster key's episode belongs to another show than the profile picked, so it isn't followed. */
  profileMismatch: boolean;
  /**
   * The profile and Google Drive: what's being uploaded or downloaded, the last problem, how many files are
   * waiting to go up (and on which drives: they go once it's plugged in), and the Drive's account (null when
   * none is connected). checked: the website's list has come.
   */
  profileSync: { working: string | null; error: string | null; waiting: number; waitingOn: string[]; drive: string | null; checked: boolean };
  /**
   * A new version of RiGster (Phase 6): available (Mac: to download), downloading or ready (Windows:
   * installs when RiGster restarts). Null when this is the newest, or when run from the source.
   */
  update: { status: 'available' | 'downloading' | 'ready'; version: string; platform: 'mac' | 'windows' } | null;
  website: { status: LinkStatus; error: string | null; siteUrl: string; key: string };
  /** Start live broadcast on the website: automation follows the prompter only while it's on. */
  live: { on: boolean; startedAt: number | null };
  permanent: PermanentView[];
  /** The show's green-screen background: playable is the app's own copy, which the box shows (a clip plays on a loop). */
  greenScreen: { file: string; seconds: number | null; thumbnail: string | null; playable: string | null } | null;
  /** The show's music track, and whether the Sound player has it. */
  /** playable: a copy the app plays out loud while the Sound player plays (on the simulator). */
  musicTrack: { file: string; seconds: number | null; inSoundPlayer: boolean; playable: string | null } | null;
  episode: { id: string; title: string; showName: string; airDate: string; airTime: string } | null;
  /** video: where to watch the camera's picture (the simulator's test pictures for now), or null. */
  cameras: { name: string; input: number; video: string | null }[];
  /**
   * Simulator or live mode (Phase 5). Live mode runs the real TC1: the producer turns it on, with a
   * confirmation, and the app never remembers it.
   */
  mode: 'simulator' | 'live';
  /**
   * Open On Manual Mode (RG, Nov 2, 2026): running the TC1 by hand, with no rundown, prompter or RiGster
   * key. Its graphics fire in the Playlist's order and stay up until taken off.
   */
  manualSession: boolean;
  /** The shows whose green screen Manual Mode can use. */
  greenScreenChoices: { showId: string; name: string }[];
  /**
   * RiGster runs the TC1 from the moment it opens, with no simulator (RG, Nov 2, 2026). Off only in
   * development (npm run show-app:simulator).
   */
  alwaysLive: boolean;
  /** Live mode: where the page watches the TC1's program feed (MIX 1). */
  programVideo: string | null;
  /** Live mode: the recording of the program feed to the laptop (file is null when not recording). */
  recording: { file: string | null; seconds: number; error: string | null } | null;
  /** Why live mode couldn't start, if it couldn't. */
  liveError: string | null;
  /** While live mode is being turned on: what RiGster is waiting for (the cable, the TC1, or its session). */
  liveWaiting: string | null;
  /** Live mode's playout: how many receivers take the laptop's NDI source (the TC1's input 4), and any problem. */
  playout: { connections: number; error: string | null } | null;
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
    /** The producer paused the graphic on air where it is (RG, Nov 4, 2026). */
    ddrPaused: boolean;
    musicPlaying: boolean;
    dskSource: string | null;
    /** The LITES layout is on program (M/E 4), with this camera in its left box. */
    layoutOn: boolean;
    layoutCamera: number | null;
    /** A transition wipe playing: which, and when it started. */
    transition: { which: string; startedAt: number; seconds: number } | null;
    playlist: string[];
    soundTracks: string[];
  };
  prompter: { connected: boolean; label: string; speed: number };
  automation: {
    /** Manual mode (Pause Automation): the producer fires the graphics and takes the cameras. */
    manual: boolean;
    /** Cameras by hand: sections starting take no cameras; the producer clicks them. */
    camerasByHand: boolean;
    sectionId: string | null;
    sectionLabel: string | null;
    onAir: ElementView | null;
    upNext: ElementView[];
    nextChoice: string | null;
    /** What going back (the left arrow) puts up again. */
    previous: ElementView | null;
  };
  sections: SectionView[];
  problems: FileProblem[];
  /**
   * Graphics that can't play in the Program box because the app can't read their files, and where the
   * files are; blocked when macOS isn't letting the app read the drive (rather than it being unplugged).
   */
  unreachable: { count: number; places: string[]; blocked: boolean };
  /** The music's in and out points: "default", "none", "section:<id>" or "cue:<id>". */
  music: { in: string; out: string; defaults: { in: string; out: string }; points: { id: string; label: string }[] };
  clock: { startedAt: number | null; sectionLabel: string | null; overUnderSeconds: number | null };
  lastCue: { label: string; latencyMs: number | null; at: number } | null;
  log: { at: number; text: string }[];
}

export type Action =
  /** Mac: opens the download page for the new version. Windows: restarts RiGster into it. */
  | { kind: 'getUpdate' }
  /** Open On Manual Mode (RG, Nov 2, 2026): runs the TC1 by hand, with no rundown, prompter or key. */
  | { kind: 'openManual' }
  /** Drags a Manual Mode graphic to just before another (null: to the end). */
  | { kind: 'moveManual'; elementId: string; before: string | null }
  /** Takes every graphic out of Manual Mode's Playlist. */
  | { kind: 'clearManual' }
  /** Manual Mode uses a show's green screen. */
  | { kind: 'useShowGreenScreen'; showId: string }
  /** Picks the show profile by hand: its permanent graphics, green screen and music load. */
  | { kind: 'setProfile'; showId: string }
  /** The show's transitions (RG, Nov 2, 2026): between back-to-back teases, and in and out of a LITES. */
  | { kind: 'setTransition'; which: 'tease' | 'lites'; path: string }
  | { kind: 'chooseTransition'; which: 'tease' | 'lites' }
  | { kind: 'clearTransition'; which: 'tease' | 'lites' }
  | { kind: 'connect'; siteUrl: string; key: string }
  | { kind: 'disconnect' }
  | { kind: 'connectSwitcher'; address: string }
  | { kind: 'setLiveMode'; on: boolean }
  | { kind: 'record'; on: boolean }
  /** The Sound fader, from 0 (silent) to 2 (+6 dB). */
  | { kind: 'setFader'; level: number }
  | { kind: 'fireNext' }
  | { kind: 'fireBack' }
  | { kind: 'takeOff' }
  /** Manual mode: fires this graphic straight away, by a double click in the Playlist (RG, Nov 4, 2026). */
  | { kind: 'fireNow'; elementId: string }
  /** Manual mode: pauses the graphic on air where it is, or starts it again (RG, Nov 4, 2026). */
  | { kind: 'pauseGraphic' }
  | { kind: 'skip'; elementId: string; skipped: boolean }
  | { kind: 'chooseNext'; elementId: string | null }
  | { kind: 'takeCamera'; input: number }
  | { kind: 'setManual'; manual: boolean }
  | { kind: 'setCamerasByHand'; byHand: boolean }
  | { kind: 'importFiles' }
  | { kind: 'addFiles'; paths: string[] }
  | { kind: 'chooseFile'; elementId: string }
  | { kind: 'assign'; path: string; elementId: string }
  | { kind: 'clearFile'; elementId: string }
  | { kind: 'dismissProblem'; path: string }
  | { kind: 'addPermanent'; paths: string[] }
  | { kind: 'choosePermanent'; name: string }
  | { kind: 'clearPermanent'; name: string }
  | { kind: 'setGreenScreen'; path: string }
  | { kind: 'chooseGreenScreen' }
  | { kind: 'clearGreenScreen' }
  | { kind: 'setMusicTrack'; path: string }
  | { kind: 'chooseMusicTrack' }
  | { kind: 'clearMusicTrack' }
  | { kind: 'setMusic'; in: string; out: string };
