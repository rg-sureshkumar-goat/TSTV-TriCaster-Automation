// The producer screen, laid out from RG's sketch (docs/show-app-sketch.pdf, Oct 29, 2026):
//   top:    Program with the cameras under it · the Playlist (on air, up next) · Pause/Continue, section, elapsed, time left
//   bottom: Up next preview · Permanent graphics drop box · Green screen drop box · Music
// The episode key is at the top right. Import graphics opens a window that matches files to cues.
// Keys: see shared/keys.ts.
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { elementKind } from '@tstv/shared';
import type { Action, AppState, ElementView } from '../shared/api.ts';
import { keyAction } from '../shared/keys.ts';
import { connectSound, programSound, setFader, soundLevel } from './audio.ts';
import { useTheme } from './theme.ts';

declare global {
  interface Window {
    showApp: {
      onState(listener: (state: AppState) => void): () => void;
      onLevel(listener: (db: number) => void): () => void;
      act(action: Action): Promise<void>;
      pathOf(file: File): string;
    };
  }
}

const act = (action: Action) => window.showApp.act(action);

function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Paths of files dropped on the window. */
const droppedPaths = (e: DragEvent) =>
  Array.from(e.dataTransfer.files)
    .map((f) => window.showApp.pathOf(f))
    .filter(Boolean);

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  // Which window is open over the screen: Edit graphics (every cue and its file) or just what's missing.
  const [graphicsOpen, setGraphicsOpen] = useState<'edit' | 'missing' | false>(false);
  useEffect(() => window.showApp.onState(setState), []);

  // The show's keys (see the top of this file). Not while typing in a box or with a window open. A menu
  // picked from last (like the green screen's) still has the keyboard, but isn't typed in: the keys still
  // fire, and the menu lets go (RG, Nov 2, 2026).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || !(state?.episode || state?.manualSession) || graphicsOpen) return;
      const action = keyAction(e.key, state.automation.manual, state.manualSession);
      // Space does nothing in automation, and mustn't press the button or menu that has the keyboard either.
      if (!action && e.key !== ' ') return;
      e.preventDefault();
      // The button clicked last still has the keyboard; let go of it, so Space doesn't press it as well.
      if (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLSelectElement) document.activeElement.blur();
      if (action) void act(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, graphicsOpen]);

  // Files to place by hand show up in the graphics window (or in the missing list, when that's open).
  const problems = state?.problems.length ?? 0;
  useEffect(() => {
    if (problems > 0) setGraphicsOpen((open) => open || 'edit');
  }, [problems]);

  if (!state) return <div className="loading">Starting…</div>;
  // After importing, the window it was started from stays open.
  const importGraphics = async (from: 'edit' | 'missing' = 'edit') => {
    await act({ kind: 'importFiles' });
    setGraphicsOpen(from);
  };
  // Every time RiGster opens, it starts on the Select A Show Profile page (RG, Nov 2, 2026).
  if (!state.profilePicked) return <ProfilePicker state={state} />;
  return (
    <div className={`app${state.automation.manual ? ' manual' : ''}`}>
      <LiveBar state={state} />
      <Header state={state} />
      <Tc1Banner state={state} />
      {/* The whole layout shows either way; a key for another show's episode just isn't followed (RG, Nov 2, 2026). */}
      {state.profileMismatch && (
        <div className="banner mismatch-banner" role="alert">
          <strong>This Show Profile Does Not Match the RiGster Key</strong>
          <span className="small">
            {' '}
            You’re in the {state.profile?.name ?? 'show'} profile, but the RiGster key is for another show’s episode, so RiGster isn’t following it. Pick that show at the
            top left, or paste a RiGster key for {state.profile?.name ?? 'this show'}.
          </span>
        </div>
      )}
      <Show state={state} onImport={() => importGraphics()} onEdit={() => setGraphicsOpen('edit')} onMissing={() => setGraphicsOpen('missing')} />
      {graphicsOpen === 'edit' && state.episode && <GraphicsWindow state={state} onClose={() => setGraphicsOpen(false)} onImport={() => importGraphics('edit')} />}
      {graphicsOpen === 'missing' && state.episode && <MissingWindow state={state} onClose={() => setGraphicsOpen(false)} onImport={() => importGraphics('missing')} />}
    </div>
  );
}

// ---- Header: show and episode at the left; status lights and the episode key at the right ----

/**
 * A new version of RiGster (Phase 6). Mac: a button to the download page. Windows: it downloads by itself,
 * then installs when RiGster is closed, or now with Restart to update, which isn't offered during a live show.
 */
function UpdateNote({ state }: { state: AppState }) {
  const update = state.update;
  if (!update) return null;
  if (update.platform === 'mac') {
    return (
      <button className="update" onClick={() => act({ kind: 'getUpdate' })} title={`RiGster ${update.version} is out. Opens the download page: install it like the first time, and everything RiGster remembers stays.`}>
        Get RiGster {update.version}
      </button>
    );
  }
  if (update.status === 'downloading') return <span className="update-note small muted">Downloading RiGster {update.version}…</span>;
  if (state.live.on) return <span className="update-note small" title="It installs when you close RiGster after the show">RiGster {update.version} installs after the show</span>;
  return (
    <button className="update" onClick={() => act({ kind: 'getUpdate' })} title={`RiGster ${update.version} is ready. RiGster closes, installs it and opens again; everything it remembers stays.`}>
      Update to {update.version}
    </button>
  );
}

/**
 * The show profile, picked by hand (RG, Nov 2, 2026): its permanent graphics, green screen and tease music
 * load, from Google Drive on any laptop.
 */
function ProfileMenu({ state }: { state: AppState }) {
  const options = state.profiles.length ? state.profiles : state.profile ? [state.profile] : [];
  if (!options.length && !state.manualSession) {
    return (
      <span className="profile-menu muted small" title="Show profiles come from the website: paste a RiGster key first">
        No show profile yet
      </span>
    );
  }
  return (
    <label className="profile-menu" title="The show profile: its permanent graphics, green screen and tease music">
      <span className="visually-hidden">Show profile</span>
      <select
        value={state.manualSession ? MANUAL : (state.profile?.id ?? '')}
        onChange={(e) => e.target.value && act(e.target.value === MANUAL ? { kind: 'openManual' } : { kind: 'setProfile', showId: e.target.value })}
      >
        {!state.profile && !state.manualSession && <option value="">Pick a show profile…</option>}
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={MANUAL}>Manual Mode</option>
      </select>
    </label>
  );
}

/** The Show profile menu's choice for Manual Mode. */
const MANUAL = '__manual';

/** Whether the profile's files are in Google Drive, and what's going up or coming down. */
function ProfileStatus({ state }: { state: AppState }) {
  const { working, error, drive, checked, waiting, waitingOn } = state.profileSync;
  if (working) return <p className="profile-status small working">⟳ {working}</p>;
  if (error) return <p className="profile-status small error">{error}</p>;
  if (!checked) return null;
  if (!drive) return <p className="profile-status small warn">Not shared yet: no Google Drive is connected (an admin connects one on the website’s Usage page).</p>;
  if (waiting > 0) {
    return (
      <p className="profile-status small warn">
        {waiting} {waiting === 1 ? 'file waits' : 'files wait'} for {waitingOn.join(' and ') || 'its drive'} to go to Google Drive: plug it in.
      </p>
    );
  }
  return (
    <p className="profile-status small muted" title={`In ${drive}’s Google Drive, in RiGster → ${state.profile?.name ?? ''}`}>
      ✓ Shared with every laptop through Google Drive
    </p>
  );
}

/**
 * The Select A Show Profile page, which RiGster opens on every time (RG's drawing, Nov 2, 2026): a tile for
 * each show, with its logo from the website and its name under it.
 */
function ProfilePicker({ state }: { state: AppState }) {
  const shows = state.profiles.length ? state.profiles : state.profile ? [{ ...state.profile, logo: null }] : [];
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  return (
    <main className="picker">
      <div className="picker-top">
        <ThemeSwitch />
        <strong className="app-name">RiGster</strong>
      </div>
      <h1>Select A Show Profile</h1>
      {shows.length > 0 && (
        <div className="picker-tiles">
          {shows.map((p) => (
            <button key={p.id} className={`picker-tile${p.id === state.profile?.id ? ' last' : ''}`} onClick={() => act({ kind: 'setProfile', showId: p.id })}>
              <span className="picker-art">{p.logo ? <img src={p.logo} alt="" /> : <span>{initials(p.name)}</span>}</span>
              <span className="picker-name">{p.name}</span>
              {p.id === state.profile?.id && <span className="picker-note">Last used</span>}
            </button>
          ))}
        </div>
      )}
      {/* Below the shows (RG, Nov 2, 2026): running the TC1 by hand, for recordings, with no rundown or key. */}
      <button className="picker-manual" onClick={() => act({ kind: 'openManual' })}>
        <strong>Open On Manual Mode</strong>
        <span className="small muted">Run the TC1 by hand: cameras, graphics and recording, with no rundown, prompter or RiGster key.</span>
      </button>
      {!state.profiles.length && state.website.key && (
        <p className="muted">{state.profileSync.error ? `${state.profileSync.error}${shows.length ? ' Showing the show used last.' : ''}` : 'Getting the shows from the website…'}</p>
      )}
      {!state.website.key && (
        <div className="picker-key">
          <p>The shows come from the website. To see them, paste a RiGster key from any episode.</p>
          <KeyPanel state={state} onDone={() => undefined} />
        </div>
      )}
    </main>
  );
}

function Header({ state }: { state: AppState }) {
  const { website, switcher, prompter, episode } = state;
  const [open, setOpen] = useState<'key' | 'simulator' | null>(episode || website.key ? null : 'key');
  useEffect(() => {
    if (episode) setOpen(null);
  }, [episode?.id]);
  return (
    <header className="topbar">
      <ThemeSwitch />
      <strong className="app-name">RiGster</strong>
      <ProfileMenu state={state} />
      <span className="title" title={episode ? episode.title : undefined}>
        {state.manualSession ? 'Manual Mode' : episode ? episode.title : ''}
      </span>
      <LiveSwitch state={state} />
      <span className="lights">
        <Light on={website.status === 'connected'} warn={website.status === 'connecting'} label="Website" detail={website.error ?? website.status} />
        <Light on={prompter.connected} label="Prompter" detail={prompter.connected ? `On ${prompter.label || 'the top'}` : 'The prompter isn’t open on this episode'} />
        {state.mode === 'live' || state.alwaysLive ? (
          <Light on={switcher.status === 'connected'} warn={switcher.status === 'connecting'} label="TC1" detail={switcher.error ?? `${switcher.address}: ${switcher.status}`} />
        ) : (
          <button className="light-button" onClick={() => setOpen(open === 'simulator' ? null : 'simulator')} title="Click to change the simulator’s address">
            <Light on={switcher.status === 'connected'} warn={switcher.status === 'connecting'} label="Simulator" detail={switcher.error ?? `${switcher.address}: ${switcher.status}`} />
          </button>
        )}
      </span>
      <UpdateNote state={state} />
      {/* Manual Mode follows no episode, so it has no key. */}
      {!state.manualSession && (
        <button className={episode ? '' : 'primary'} onClick={() => setOpen(open === 'key' ? null : 'key')} aria-expanded={open === 'key'}>
          Episode key
        </button>
      )}
      {open === 'key' && !state.manualSession && <KeyPanel state={state} onDone={() => setOpen(null)} />}
      {open === 'simulator' && <SimulatorPanel state={state} />}
    </header>
  );
}

/**
 * Simulator or live mode (Phase 5). Live mode runs TSTV's real TC1, so it takes a deliberate step: this
 * button, then a confirmation listing what the TC1 needs (the second of the three safety locks).
 */
function LiveSwitch({ state }: { state: AppState }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    await act({ kind: 'setLiveMode', on: true });
    setBusy(false);
    setAsking(false);
  };
  if (state.alwaysLive) return state.switcher.status === 'connected' ? <span className="mode live">LIVE: TC1</span> : null;
  if (state.mode === 'live') return <span className="mode live">LIVE: TC1</span>;
  // Turning on: RiGster waits for the cable, the TC1 and its session, and connects by itself (RG, Nov 1, 2026).
  if (state.liveWaiting) {
    return (
      <>
        <span className="mode waiting" title={state.liveWaiting}>
          Connecting to the TC1…
        </span>
        <button onClick={() => act({ kind: 'setLiveMode', on: false })}>Cancel</button>
      </>
    );
  }
  return (
    <>
      <span className="mode" title="The app runs the simulator until live mode is turned on">
        SIMULATOR
      </span>
      <button className="go-live" onClick={() => setAsking(true)}>
        Run the real TC1…
      </button>
      {state.liveError && !asking && (
        <span className="error small" role="alert">
          {state.liveError}
        </span>
      )}
      {asking && (
        <div className="overlay" role="dialog" aria-label="Turn on live mode">
          <div className="window small-window live-confirm">
            <h2>Run the real TC1?</h2>
            <p>
              Live mode sends commands to TSTV’s real TriCaster TC1: cameras, DSK 2, and the graphics and music over the cable. Check:
            </p>
            <ul>
              <li>The laptop is plugged into the TC1’s cable.</li>
              <li>Nothing is on air that the app shouldn’t touch.</li>
            </ul>
            <p className="small muted">
              Once live mode is on, the TC1 needs (if its RiGster session doesn’t have it saved yet): <strong>input 4</strong> set to the laptop’s source,{' '}
              <strong>RIGSTER (Graphics)</strong>; <strong>DSK 2’s source</strong> set to input 4; input 4’s sound on in the AUDIO MIXER; and, for the green screen,
              input 5 set to <strong>RIGSTER (Green Screen)</strong>, used as M/E 1’s background; and for transitions, input 6 set to{' '}
              <strong>RIGSTER (Transition)</strong>, shown by DSK 4; and for the Preview box, input 7 set to <strong>RIGSTER (Up Next)</strong>, keyed on M/E 3. Save it in the TC1’s RiGster session once, and it works with any laptop.
            </p>
            {state.liveError && <p className="error">{state.liveError}</p>}
            <div className="row">
              <button className="danger" onClick={turnOn} disabled={busy}>
                {busy ? 'Connecting to the TC1…' : 'Turn on live mode'}
              </button>
              <button onClick={() => setAsking(false)} disabled={busy}>
                Stay on the simulator
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Until RiGster is connected to the TC1 (RG, Nov 2, 2026): it looks for the TC1 from the moment it opens,
 * and again if the connection drops, and says what it's waiting for.
 */
function Tc1Banner({ state }: { state: AppState }) {
  if (!state.alwaysLive || state.switcher.status === 'connected') return null;
  return (
    <div className="banner tc1-banner" role="alert">
      <strong>RiGster Is Not Connected to TC1</strong>
      <span>{state.liveWaiting ?? state.liveError ?? 'Plug in the TC1 Cable to Connect to TC1'}</span>
    </div>
  );
}

/** Across the top in live mode, so nobody forgets the app is running the real TC1. */
function LiveBar({ state }: { state: AppState }) {
  if (state.mode !== 'live' || state.switcher.status !== 'connected') return null;
  const connections = state.playout?.connections ?? 0;
  const dskSource = state.switcher.dskSource;
  return (
    <div className="live-bar" role="status">
      <strong>LIVE: TC1</strong>
      <span>The app is running the real TriCaster.</span>
      {dskSource && dskSource !== 'input4' && (
        <span className="live-warning" role="alert">
          DSK 2’s source on the TC1 is {dskSource.toUpperCase()}, not input 4, so the graphics won’t show. Set DSK 2’s source to input 4.
        </span>
      )}
      <span className="small">
        {state.playout?.error ?? (connections > 0 ? `Input 4 is taking the laptop’s graphics (${connections} connection${connections === 1 ? '' : 's'}).` : 'Waiting for the TC1’s input 4 to take the laptop’s graphics…')}
      </span>
      {!state.alwaysLive && <button onClick={() => act({ kind: 'setLiveMode', on: false })}>Back to the simulator</button>}
    </div>
  );
}

/** Switches the app between light and dark mode, like the website's switch. */
function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const dark = theme === 'dark';
  return (
    <button className="theme-switch" role="switch" aria-checked={dark} aria-label="Dark mode" title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <span className="theme-track">
        <span className="theme-thumb">{dark ? '☾' : '☀'}</span>
      </span>
    </button>
  );
}

function Light({ on, warn, label, detail }: { on: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <span className={`light ${on ? (warn ? 'warn' : 'on') : 'off'}`} title={detail}>
      <span className="dot" /> {label}
    </span>
  );
}

function KeyPanel({ state, onDone }: { state: AppState; onDone: () => void }) {
  const [key, setKey] = useState(state.website.key);
  const [siteUrl, setSiteUrl] = useState(state.website.siteUrl);
  return (
    <form
      className="dropdown"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ kind: 'connect', siteUrl, key });
      }}
    >
      <p>On the website, open the episode, click <strong>RiGster key</strong> and <strong>Copy</strong>, then paste it here.</p>
      <label>
        Episode key
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="tstv-…" autoFocus required />
      </label>
      <details>
        <summary>Website address</summary>
        <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} aria-label="Website address" />
      </details>
      {state.website.error && <p className="error">{state.website.error}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={state.website.status === 'connecting'}>
          {state.website.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        {state.episode && (
          <button type="button" onClick={onDone}>
            Close
          </button>
        )}
      </div>
    </form>
  );
}

function SimulatorPanel({ state }: { state: AppState }) {
  const [address, setAddress] = useState(state.switcher.address);
  return (
    <form
      className="dropdown"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ kind: 'connectSwitcher', address });
      }}
    >
      <p>
        The simulator runs on this laptop: start it with <code>npm run simulator</code>. Phase 4 only ever talks to the simulator.
      </p>
      <div className="row">
        <input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Simulator address" />
        <button type="submit">{state.switcher.status === 'connected' ? 'Reconnect' : 'Connect'}</button>
      </div>
      {state.switcher.error && <p className="error">{state.switcher.error}</p>}
    </form>
  );
}

// ---- The show ----

function Show({ state, onImport, onEdit, onMissing }: { state: AppState; onImport: () => void; onEdit: () => void; onMissing: () => void }) {
  const { automation, website, prompter, live } = state;
  return (
    <main className="show">
      {state.liveWaiting && (
        <div className="banner waiting-banner" role="status">
          {state.liveWaiting}
        </div>
      )}
      {state.manualSession ? (
        <div className="banner manual-banner" role="status">
          Manual Mode: no rundown or prompter. <kbd>→</kbd> fires the next graphic, <kbd>Space</kbd> pauses it where it is, <kbd>←</kbd> goes back one, and <kbd>↓</kbd> takes it off; each stays up until
          it’s taken off. Click a camera to take it. Drag a graphic by its <strong>⠿</strong> to change the order.
        </div>
      ) : automation.manual ? (
        <div className="banner manual-banner" role="alert">
          Manual mode: the prompter fires nothing. <kbd>→</kbd> fires the next graphic, <kbd>Space</kbd> pauses it where it is, <kbd>←</kbd> goes back one, and <kbd>↓</kbd> takes it off. Click a camera to take it.{' '}
          <strong>Continue automation</strong> (<kbd>P</kbd>) lets the prompter’s cues fire them again.
        </div>
      ) : !live.on ? (
        <div className="banner quiet" role="status">
          Not live yet. The app follows the prompter once the producer presses <strong>Start live broadcast</strong> on the website. Until then, the cameras and Fire next work by hand.
        </div>
      ) : (
        website.status === 'connected' &&
        !prompter.connected && (
          <div className="banner" role="alert">
            The prompter isn’t connected. Keep the show going by firing each cue with the <kbd>→</kbd> key.
          </div>
        )
      )}
      {state.unreachable.count > 0 && (
        <div className="banner" role="status">
          {state.unreachable.count} {state.unreachable.count === 1 ? 'graphic' : 'graphics'} can’t play in the Program box:{' '}
          {state.unreachable.blocked ? (
            <>
              macOS isn’t letting the app read {state.unreachable.places.join(' and ') || 'their drive'}. Click <strong>Import graphics</strong> and pick the drive’s folder again: that
              lets the app in, and it keeps copies on this laptop, so they play even after the drive is unplugged.
            </>
          ) : (
            <>
              {state.unreachable.places.length ? `their files are on ${state.unreachable.places.join(' and ')}, which isn’t plugged in` : 'their files aren’t on this laptop any more'}. Plug it in,
              and the app picks them up by itself and keeps copies on this laptop, so they play even after it’s unplugged.
            </>
          )}
        </div>
      )}
      <div className="grid">
        <div className="cell program-cell">
          <Program state={state} />
          <Cameras state={state} />
          <CameraControl state={state} />
        </div>
        <Playlist state={state} onImport={onImport} onEdit={onEdit} onMissing={onMissing} />
        <Status state={state} />
        <Preview state={state} />
        <TransitionsBox state={state} />
        <PermanentBox state={state} />
        <GreenScreenBox state={state} />
        <Music state={state} />
        <SoundStrip live={state.mode === 'live'} />
      </div>
    </main>
  );
}

/**
 * What's on air. On the simulator (RG's mock show, Oct 29, 2026): the camera on M/E 1, playing, with the
 * clip on DSK 2 playing over it from the app's copy of its file. The real TC1's own video comes later.
 */
function Program({ state }: { state: AppState }) {
  const camera = state.cameras.find((c) => c.input === state.switcher.programInput);
  const onAir = state.automation.onAir;
  // On the simulator, the app's own picture; live mode shows the TC1's program instead.
  const simulator = state.mode === 'simulator';
  // The LITES layout (RG, Nov 2, 2026): drawn here on the simulator; live mode shows the TC1's own.
  const layout = simulator && state.switcher.layoutOn;
  const showing = state.switcher.dskOn || layout;
  const keyed = simulator && showing ? onAir?.playable : null;
  // Until its clip can play (being made, or its drive isn't plugged in), a graphic shows as its still.
  const still = simulator && showing && onAir && !onAir.playable ? onAir.thumbnail : null;
  const layoutCamera = state.cameras.find((c) => c.input === state.switcher.layoutCamera);
  const background = state.greenScreen;
  // Ready before the first clip, so it isn't held back while the laptop's sound wakes up.
  useEffect(() => void programSound(), []);
  return (
    <div className={`program${layout ? ' with-layout' : ''}`} aria-label="Program">
      {layout ? (
        // As in RG's template: the green screen behind, the camera in the left box, the clip in the right.
        <div className="lites-frame">
          {background?.playable && background.seconds ? (
            <video className="lites-background" src={background.playable} autoPlay loop muted playsInline />
          ) : background?.playable || background?.thumbnail ? (
            <img className="lites-background" src={background.playable ?? background.thumbnail!} alt="" />
          ) : null}
          <div className="lites-box lites-camera">{layoutCamera?.video ? <CameraPicture src={`${layoutCamera.video}?size=large`} /> : null}</div>
          <div className="lites-box lites-clip">
            {keyed && <ProgramClip key={onAir!.id} src={keyed} />}
            {still && <img className="program-clip" src={still} alt="" />}
          </div>
        </div>
      ) : state.mode === 'live' ? (
        // Live mode: the TC1's real program, picture only.
        <CameraPicture src={state.programVideo} />
      ) : camera?.video ? (
        <CameraPicture src={`${camera.video}?size=large`} />
      ) : (
        <span className="program-note">Start the simulator, or turn on live mode, to see the program here.</span>
      )}
      {!layout && keyed && <ProgramClip key={onAir!.id} src={keyed} />}
      {!layout && still && <img className="program-clip" src={still} alt="" />}
      {/* On the simulator, the Sound player only pretends: the app plays the music out loud while it plays. */}
      {simulator && state.switcher.musicPlaying && state.musicTrack?.playable && <ProgramMusic src={state.musicTrack.playable} />}
      {/* A transition wipe on top of everything (RG, Nov 2, 2026); live mode shows the TC1's own. */}
      {simulator && state.switcher.transition && <TransitionWipe state={state} />}
      <span className={`live-dot${state.live.on ? ' on' : ''}`}>{state.live.on ? '● LIVE' : '○ Not live'}</span>
      <span className="program-caption">
        <strong>{layout ? `LITES layout: ${layoutCamera?.name ?? 'camera'}` : (camera?.name ?? (state.switcher.programInput ? `Input ${state.switcher.programInput}` : 'No camera'))}</strong>
        {onAir && <> + {onAir.label}</>}
        {still && <span className="muted"> (still: {onAir!.fileFound ? 'getting its clip ready' : 'the app can’t read its file'})</span>}
        {state.switcher.musicPlaying && <> + ♪ music</>}
      </span>
    </div>
  );
}

/** The music, playing from its start while the Sound player plays, through the Sound strip. */
function ProgramMusic({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => (audio.current ? connectSound(audio.current) : undefined), []);
  return <audio ref={audio} src={src} autoPlay />;
}

/** The clip on DSK 2, playing from its start with its sound; a still is shown as it is. */
/** The transition playing, over the whole Program box (its picture, or its still until a copy is ready). */
function TransitionWipe({ state }: { state: AppState }) {
  const playing = state.switcher.transition!;
  const t = state.transitions.find((x) => x.which === playing.which);
  if (!t) return null;
  if (t.playable && !t.playable.endsWith('.png')) return <ProgramClip key={playing.startedAt} src={t.playable} className="program-transition" />;
  const still = t.playable ?? t.thumbnail;
  return still ? <img key={playing.startedAt} className="program-clip program-transition" src={still} alt="" /> : null;
}

function ProgramClip({ src, className = '' }: { src: string; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  // Its sound goes through the Sound strip's fader and meter.
  useEffect(() => (video.current ? connectSound(video.current) : undefined), []);
  return src.endsWith('.png') ? <img className={`program-clip ${className}`} src={src} alt="" /> : <video ref={video} className={`program-clip ${className}`} src={src} autoPlay playsInline />;
}

/**
 * The Sound strip at the right (RG, Oct 29, 2026): one level meter and one fader for all of Program's
 * sound, the clip on DSK 2 and the music together, from silent to +6 dB. Double-click the fader to go back
 * to 0 dB. The laptop remembers where it was left.
 */
function SoundStrip({ live }: { live: boolean }) {
  const key = 'tstv-show-app-fader';
  const [level, setLevel] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key) ?? 1);
      return saved >= 0 && saved <= 2 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const cover = useRef<HTMLDivElement>(null);
  const reading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // The laptop's own sound on the simulator; the playout's, going to the TC1, in live mode.
    setFader(level);
    void act({ kind: 'setFader', level });
    try {
      localStorage.setItem(key, String(level));
    } catch {
      // Not remembered; it still works.
    }
  }, [level]);
  // In live mode, the level comes from the playout; on the simulator, from the laptop's own sound.
  const liveLevel = useRef(-60);
  useEffect(() => window.showApp.onLevel((db) => (liveLevel.current = db)), []);
  const liveNow = useRef(live);
  liveNow.current = live;
  // The meter moves every frame without redrawing the page.
  useEffect(() => {
    let frame = 0;
    let shown = -60;
    const draw = () => {
      const now = liveNow.current ? liveLevel.current : soundLevel();
      // Up at once, down gently, like a studio meter.
      shown = now > shown ? now : Math.max(now, shown - 1);
      if (cover.current) cover.current.style.height = `${(-shown / 60) * 100}%`;
      if (reading.current) reading.current.textContent = shown <= -59 ? '—' : `${Math.round(shown)}`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  const db = level === 0 ? '−∞' : `${level >= 1 ? '+' : ''}${(20 * Math.log10(level)).toFixed(1)}`;
  return (
    <section className="cell panel sound-strip" aria-label="Sound">
      <h2>Sound</h2>
      <div className="sound-columns">
        <div className="meter" title="How loud Program's sound (the clip and the music) is, in dB">
          <div className="meter-cover" ref={cover} />
        </div>
        <input
          className="fader"
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          onDoubleClick={() => setLevel(1)}
          aria-label="Program sound"
          title="Drag to change Program's sound (the clip and the music). Double-click for 0 dB."
        />
      </div>
      <p className="small muted sound-readout">
        Level <span ref={reading}>—</span>
        <br />
        Fader <strong>{db} dB</strong>
      </p>
    </section>
  );
}

/** Each camera's picture, playing; click one to take it. The one on air has a red frame. */
function Cameras({ state }: { state: AppState }) {
  return (
    <div className="cameras" aria-label="Cameras">
      {state.cameras.map((c) => (
        <button
          key={c.name}
          className={`camera${state.switcher.programInput === c.input ? ' on-air' : ''}`}
          onClick={() => act({ kind: 'takeCamera', input: c.input })}
          aria-label={`Take ${c.name}`}
        >
          <CameraPicture src={c.video} />
          <span className="camera-label">
            <strong>{c.name}</strong> <span>Input {c.input}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Takes the cameras off the prompter (RG, Oct 29, 2026): the producer switches them by clicking, while the
 * graphics still follow the prompter. Giving them back, the next section takes its camera.
 */
function CameraControl({ state }: { state: AppState }) {
  const { camerasByHand, manual } = state.automation;
  if (manual) return null;
  return (
    <div className={`camera-control${camerasByHand ? ' by-hand' : ''}`}>
      <button className={camerasByHand ? '' : 'primary'} onClick={() => act({ kind: 'setCamerasByHand', byHand: !camerasByHand })}>
        {camerasByHand ? 'Give cameras back to the prompter' : 'Switch cameras by hand'}
      </button>
      <span className="small muted">
        {camerasByHand ? 'Cameras by hand: click one to take it. Graphics still follow the prompter.' : 'Cameras follow the prompter.'}
      </span>
    </div>
  );
}

function CameraPicture({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  // Each try asks afresh, so a feed that wasn't there a moment ago gets another chance.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => setBroken(false), [src]);
  useEffect(() => {
    if (!broken) return;
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1);
      setBroken(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [broken]);
  if (!src || broken) return <span className="camera-picture none">No picture</span>;
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}try=${attempt}` : src;
  return <img className="camera-picture" src={url} alt="" onError={() => setBroken(true)} />;
}

function Panel({ title, actions, className = '', children }: { title: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`cell panel ${className}`}>
      <h2>
        {title}
        {actions && <span className="actions">{actions}</span>}
      </h2>
      {children}
    </section>
  );
}

function Playlist({ state, onImport, onEdit, onMissing }: { state: AppState; onImport: () => void; onEdit: () => void; onMissing: () => void }) {
  const { automation } = state;
  // Back and Take off are for manual mode, when the producer runs the graphics.
  const manual = automation.manual;
  const previous = automation.previous;
  const missing = state.sections.flatMap((s) => s.elements).filter((e) => e.behavior !== 'music' && !e.file).length;
  return (
    <Panel
      title="Playlist"
      className="playlist"
      actions={
        state.manualSession ? (
          <>
            <button className="primary" onClick={onImport}>
              Import graphics
            </button>
            <button
              onClick={() => confirm('Take every graphic out of the Playlist? Their files stay where they are.') && act({ kind: 'clearManual' })}
              disabled={state.sections.every((s) => s.elements.length === 0)}
            >
              Clear
            </button>
          </>
        ) : (
        <>
          <button className="primary" onClick={onImport}>
            Import graphics
          </button>
          <button onClick={onEdit} title="Every cue and its file: change, remove or place files by hand">
            Edit graphics
          </button>
          <button className={missing ? 'missing-button' : ''} onClick={onMissing} title="Just the graphics that still need a file">
            {missing ? `${missing} missing` : 'All files ✓'}
          </button>
        </>
        )
      }
    >
      <h3>
        On air
        {state.switcher.ddrPaused && <span className="paused-tag">⏸ Paused</span>}
        {manual && (
          <button className="fire" onClick={() => act({ kind: 'takeOff' })} disabled={!automation.onAir}>
            Take off <kbd>↓</kbd>
          </button>
        )}
      </h3>
      <OnAir state={state} />
      <h3>
        Up next
        <span className="hand-buttons">
          {manual && (
            <button
              className="fire"
              onClick={() => act({ kind: 'fireBack' })}
              disabled={!previous}
              title={previous ? `Puts ${previous.label} (${previous.sectionLabel}) up again` : 'Nothing to go back to'}
            >
              <kbd>←</kbd> Back
            </button>
          )}
          <button className="fire" onClick={() => act({ kind: 'fireNext' })} disabled={automation.upNext.length === 0}>
            Fire next <kbd>→</kbd>
          </button>
        </span>
      </h3>
      {state.manualSession ? (
        <ManualQueue state={state} />
      ) : (
      <ol className="queue">
        {automation.upNext.map((e, i) => (
          <li key={e.id} className={i === 0 ? 'first' : ''}>
            <Item element={e} musicTrack={state.musicTrack?.file} />
            <span className="actions">
              {i > 0 && <button onClick={() => act({ kind: 'chooseNext', elementId: e.id })}>Play next</button>}
              {automation.nextChoice === e.id && <button onClick={() => act({ kind: 'chooseNext', elementId: null })}>Back in order</button>}
              <button onClick={() => act({ kind: 'skip', elementId: e.id, skipped: true })}>Skip</button>
            </span>
          </li>
        ))}
        {automation.upNext.length === 0 && <li className="muted">Nothing left to fire.</li>}
      </ol>
      )}
      {!state.manualSession && <Skipped state={state} />}
    </Panel>
  );
}

/**
 * Manual Mode's Playlist (RG, Nov 2, 2026): every graphic, in the order imported, each with a handle at
 * its left to drag it up or down. → fires the one marked next.
 */
function ManualQueue({ state }: { state: AppState }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const all = state.sections.flatMap((s) => s.elements);
  const next = state.automation.upNext[0]?.id;
  const drop = (before: string | null) => {
    if (dragging) void act({ kind: 'moveManual', elementId: dragging, before });
    setDragging(null);
    setOver(null);
  };
  // Files dropped on the list from outside RiGster are imported, onto the end.
  const dropFiles = (e: DragEvent) => {
    e.preventDefault();
    if (dragging) return drop(null);
    const paths = droppedPaths(e);
    if (paths.length) void act({ kind: 'addFiles', paths });
  };
  if (all.length === 0) {
    return (
      <p className="muted queue-empty" onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
        No graphics yet. Click <strong>Import graphics</strong>, or drop files here.
      </p>
    );
  }
  return (
    <ol className="queue manual-queue" onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
      {all.map((e, i) => (
        <li
          key={e.id}
          className={`${e.id === next ? 'first' : ''}${e.id === state.automation.onAir?.id ? ' on-air-item' : ''}${over === e.id ? ' drop-before' : ''}${dragging === e.id ? ' dragging' : ''}`}
          onDragOver={(ev) => {
            if (!dragging) return;
            ev.preventDefault();
            ev.stopPropagation();
            setOver(e.id);
          }}
          onDrop={(ev) => {
            if (!dragging) return;
            ev.preventDefault();
            ev.stopPropagation();
            drop(e.id);
          }}
        >
          <span
            className="drag-handle"
            draggable
            role="button"
            aria-label={`Drag ${e.label} up or down`}
            title="Drag up or down to change the order"
            onDragStart={(ev) => {
              ev.dataTransfer.effectAllowed = 'move';
              ev.dataTransfer.setData('text/plain', e.id);
              setDragging(e.id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            ⠿
          </span>
          <span className="manual-number">{i + 1}</span>
          <Item element={e} />
          <span className="actions">
            {e.id !== next && <button onClick={() => act({ kind: 'chooseNext', elementId: e.id })}>Play next</button>}
            <button onClick={() => act({ kind: 'clearFile', elementId: e.id })} aria-label={`Remove ${e.label}`} title="Take it out of the Playlist">
              ✕
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One cue: its chip, its section, and the file that will play (RG, Oct 29, 2026), or the show's music track. */
/**
 * How far the clip on DSK 2 has played, while DDR 2 plays it: the share played, and the seconds left.
 * Null for a still, or when DDR 2 is playing something else.
 */
function clipProgress(state: AppState): { played: number; left: number; total: number } | null {
  const { onAir } = state.automation;
  const { ddrPlaying, ddrRemaining, ddrItem } = state.switcher;
  if (!onAir?.seconds || !ddrPlaying || ddrRemaining === null || ddrItem !== onAir.ddrItem) return null;
  const total = Math.max(onAir.seconds, ddrRemaining);
  return { played: 1 - ddrRemaining / total, left: ddrRemaining, total };
}

/** What's on DSK 2, with a see-through bar across it that fills as the clip plays (RG, Oct 29, 2026). */
function OnAir({ state }: { state: AppState }) {
  const onAir = state.automation.onAir;
  const progress = clipProgress(state);
  return (
    <div className="on-air">
      {onAir && progress && (
        <span
          key={onAir.id}
          className="clip-progress"
          style={{ width: `${progress.played * 100}%` }}
          role="progressbar"
          aria-label="Clip played"
          aria-valuemin={0}
          aria-valuemax={Math.round(progress.total)}
          aria-valuenow={Math.round(progress.total - progress.left)}
        />
      )}
      {onAir ? <Item element={onAir} musicTrack={state.musicTrack?.file} /> : <span className="muted">Nothing on DSK 2</span>}
      {progress && <span className="time-left">{duration(progress.left)} left</span>}
    </div>
  );
}

function Item({ element, musicTrack }: { element: ElementView; musicTrack?: string | null }) {
  const file = element.behavior === 'music' ? musicTrack : element.file;
  return (
    <span className="item">
      <span className={`chip ${elementKind(element.type)}`} title={element.label}>
        {element.label}
      </span>
      <span className="muted">{element.sectionLabel}</span>
      {file && (
        <span className="file-name" title={file}>
          {file}
        </span>
      )}
      {element.behavior !== 'music' && !element.file && <span className="missing">no file</span>}
      {element.file && !element.fileFound && (
        <span className="missing" title="The app can’t read its file right now (its drive is unplugged, or macOS isn’t letting the app read it), so it can’t play in the Program box">
          can’t read file
        </span>
      )}
      {element.behavior !== 'music' && element.file && element.ddrItem === null && (
        <span className="missing" title="Its file isn’t in DDR 2 yet. On the simulator, the app loads DDR 2 as soon as nothing is on air.">
          not in DDR 2
        </span>
      )}
    </span>
  );
}

function Skipped({ state }: { state: AppState }) {
  const skipped = state.sections.flatMap((s) => s.elements).filter((e) => e.skipped);
  if (skipped.length === 0) return null;
  return (
    <p className="muted small">
      Skipped:{' '}
      {skipped.map((e) => (
        <button key={e.id} className="link" onClick={() => act({ kind: 'skip', elementId: e.id, skipped: false })} title="Put it back">
          {e.label} ({e.sectionLabel}) ↺
        </button>
      ))}
    </p>
  );
}

/**
 * Record (live mode): saves the TC1's program, picture and sound, on the laptop, under the name and in the
 * folder the producer picks (RG, Oct 30, 2026).
 */
function RecordButton({ state }: { state: AppState }) {
  const recording = state.recording;
  if (state.mode !== 'live' || !recording) {
    return (
      <button className="record" disabled title="Recording saves the real TC1’s program, so it works in live mode">
        ● Record
      </button>
    );
  }
  const on = !!recording.file;
  return (
    <div className="record-row">
      <button className={`record${on ? ' on' : ''}`} onClick={() => act({ kind: 'record', on: !on })}>
        {on ? `■ Stop recording · ${duration(recording.seconds)}` : '● Record'}
      </button>
      {on && (
        <span className="small muted file-name" title={recording.file ?? ''}>
          {recording.file?.split(/[\\/]/).pop()}
        </span>
      )}
      {recording.error && (
        <span className="small error" role="alert">
          {recording.error}
        </span>
      )}
    </div>
  );
}

function Status({ state }: { state: AppState }) {
  const now = useNow();
  const { automation, clock, switcher, lastCue } = state;
  const playing = clipProgress(state) !== null;
  const ms = lastCue?.latencyMs ?? null;
  return (
    <section className="cell panel status">
      {state.manualSession ? (
        <button className="pause resume" disabled title="Manual Mode has no prompter, so there’s no automation to continue">
          Manual Mode
        </button>
      ) : (
        <button className={`pause${automation.manual ? ' resume' : ''}`} onClick={() => act({ kind: 'setManual', manual: !automation.manual })}>
          {automation.manual ? 'Continue automation' : 'Pause automation'} <kbd>P</kbd>
        </button>
      )}
      <RecordButton state={state} />
      <dl>
        <dt>Section</dt>
        <dd>{automation.sectionLabel ?? '—'}</dd>
        <dt>Elapsed</dt>
        <dd>{clock.startedAt ? duration((now - clock.startedAt) / 1000) : '0:00'}</dd>
        <dt>Time left on current GFX</dt>
        <dd>{playing ? duration(switcher.ddrRemaining) : '—'}</dd>
      </dl>
      {lastCue && (
        <p className="small muted last-cue">
          Last cue: {lastCue.label}
          {ms !== null && (
            <span className={`latency ${ms < 300 ? 'fast' : ms < 500 ? 'ok' : 'slow'}`} title="From the prompter’s reading line to the switcher (green under 0.3 s, amber up to 0.5 s)">
              {(ms / 1000).toFixed(2)} s
            </span>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * What the next cue will look like on air (RG, Oct 29, 2026): the camera it plays over, with the graphic
 * on top. Graphics keep their see-through parts, so an L3 or OTS sits over the camera; a VO, SOT or
 * package fills the screen, as it will on air.
 */
function Preview({ state }: { state: AppState }) {
  const next = state.automation.upNext[0];
  const section = state.sections.find((s) => s.id === next?.sectionId);
  const camera = state.cameras.find((c) => c.name === section?.camera);
  const note = !next ? 'Nothing up next' : next.behavior === 'music' ? `♪ ${next.label}` : !next.thumbnail ? (next.file ?? 'No file yet') : null;
  return (
    <Panel title="Up next preview" className="preview">
      <div className="thumb composite" aria-label={next ? `${next.label} over ${section?.camera ?? 'the camera'}` : 'Nothing up next'}>
        {next && <CameraPicture src={camera?.video ?? null} />}
        {next?.thumbnail && next.behavior !== 'music' && <img className="graphic-layer" src={next.thumbnail} alt="" />}
        {note && <span className="composite-note">{note}</span>}
      </div>
      {next && (
        <p>
          <strong>{next.label}</strong> ({next.sectionLabel}) <span className="muted">over {section?.camera ?? 'the section’s camera'}</span>
        </p>
      )}
    </Panel>
  );
}

/** A panel that takes dropped files. */
function DropPanel({ title, className, onFiles, children }: { title: string; className: string; onFiles: (paths: string[]) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`cell panel drop ${className}${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const paths = droppedPaths(e);
        if (paths.length) onFiles(paths);
      }}
    >
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function PermanentBox({ state }: { state: AppState }) {
  return (
    <DropPanel title="Permanent graphics" className="permanent" onFiles={(paths) => act({ kind: 'addPermanent', paths })}>
      <ProfileStatus state={state} />
      {/* Only while it's empty, to keep the box short. */}
      {state.permanent.every((g) => !g.file) && <p className="muted small">Drop the show’s permanent graphics here once; every episode, and every laptop, uses them.</p>}
      <ul className="perm-list">
        {state.permanent.map((g) => (
          <li key={g.name}>
            <span>★ {g.name}</span>
            {g.file ? (
              <span className="ready" title={`${g.file} ${g.seconds ? duration(g.seconds) : ''}`}>
                ✓
              </span>
            ) : (
              <span className="missing">missing</span>
            )}
            <button className="small-button" onClick={() => act({ kind: 'choosePermanent', name: g.name })}>
              {g.file ? 'Change' : 'Choose'}
            </button>
          </li>
        ))}
      </ul>
    </DropPanel>
  );
}

/**
 * The show's transitions (RG, Nov 2, 2026), saved in its profile like the permanent graphics: the Tease
 * Transition wipes between back-to-back teases, the LITES Transition into and out of a LITES layout.
 * A dropped file whose name says "tease" or "lites" goes there; others fill an empty one.
 */
function TransitionsBox({ state }: { state: AppState }) {
  const labels = { tease: 'Tease Transition', lites: 'LITES Transition' } as const;
  const help = { tease: 'Between back-to-back teases', lites: 'Into and out of a LITES' } as const;
  const drop = (paths: string[]) => {
    const empty = state.transitions.filter((t) => !t.file).map((t) => t.which);
    for (const file of paths) {
      const name = file.toLowerCase();
      const which = name.includes('lites') ? 'lites' : name.includes('tease') ? 'tease' : empty.shift();
      if (which) void act({ kind: 'setTransition', which, path: file });
    }
  };
  return (
    <DropPanel title="Transitions" className="transitions" onFiles={drop}>
      <ul className="transition-list">
        {state.transitions.map((t) => (
          <li key={t.which} title={help[t.which]}>
            <strong>{labels[t.which]}</strong>
            <div className="transition-file">
              <div className="thumb transition-thumb">{t.thumbnail ? <img src={t.thumbnail} alt="" /> : <span>{t.file ? '' : 'None'}</span>}</div>
              <button className="small-button" onClick={() => act({ kind: 'chooseTransition', which: t.which })}>
                {t.file ? 'Change' : 'Choose'}
              </button>
              {t.file && (
                <button className="small-button" onClick={() => act({ kind: 'clearTransition', which: t.which })}>
                  Remove
                </button>
              )}
            </div>
            {t.file && (
              <span className="small muted transition-name" title={t.file}>
                {t.file}
              </span>
            )}
          </li>
        ))}
      </ul>
    </DropPanel>
  );
}

function GreenScreenBox({ state }: { state: AppState }) {
  const g = state.greenScreen;
  return (
    <DropPanel title="Green screen" className="green" onFiles={(paths) => act({ kind: 'setGreenScreen', path: paths[0] })}>
      {state.mode === 'live' && (
        <p className="small muted">
          Goes to the TC1 as <strong>RIGSTER (Green Screen)</strong>. On the TC1, use it as the background behind the keyed cameras.
        </p>
      )}
      {/* What the background looks like (RG, Oct 30, 2026): a clip plays on a loop, without its sound. */}
      <div className="thumb small-thumb">
        {g?.playable && g.seconds ? (
          <video src={g.playable} poster={g.thumbnail ?? undefined} autoPlay loop muted playsInline />
        ) : g?.playable || g?.thumbnail ? (
          <img src={g.playable ?? g.thumbnail!} alt="" />
        ) : (
          <span>{g ? g.file : 'Drop the background here'}</span>
        )}
      </div>
      {g && <p className="small">{g.file}</p>}
      {/* Manual Mode (RG, Nov 2, 2026): any show's green screen. */}
      {state.manualSession && (
        <label className="green-pick">
          <span className="visually-hidden">Use a show’s green screen</span>
          <select value="" onChange={(e) => e.target.value && act({ kind: 'useShowGreenScreen', showId: e.target.value })} disabled={state.greenScreenChoices.length === 0}>
            <option value="">{state.greenScreenChoices.length ? 'Use a show’s green screen…' : 'No show has a green screen yet'}</option>
            {state.greenScreenChoices.map((c) => (
              <option key={c.showId} value={c.showId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <button className="small-button" onClick={() => act({ kind: 'chooseGreenScreen' })}>
          {g ? 'Change' : 'Choose'}
        </button>
        {g && (
          <button className="small-button" onClick={() => act({ kind: 'clearGreenScreen' })}>
            Remove
          </button>
        )}
      </div>
    </DropPanel>
  );
}

function Music({ state }: { state: AppState }) {
  const { music, musicTrack, switcher } = state;
  const inOptions = [{ id: 'default', label: `Default: ${music.defaults.in}` }, { id: 'none', label: 'Never by itself' }, ...music.points];
  // The music stops just before an out point.
  const outOptions = [{ id: 'default', label: `Default: ${music.defaults.out}` }, { id: 'none', label: 'Never by itself' }, ...music.points.map((p) => ({ ...p, label: `Just before ${p.label}` }))];
  return (
    <DropPanel title="Music" className="music" onFiles={(paths) => act({ kind: 'setMusicTrack', path: paths[0] })}>
      {/* The track the producer drops here is the one that plays (RG, Oct 29, 2026). */}
      {musicTrack ? (
        <div className={`track${switcher.musicPlaying ? ' playing' : ''}`}>
          <strong title={musicTrack.file}>♪ {musicTrack.file.replace(/\.[^.]+$/, '')}</strong>
          <span className="muted small">
            {musicTrack.seconds ? duration(musicTrack.seconds) : ''} {switcher.musicPlaying ? '· ▶ Playing' : ''}
          </span>
          {!musicTrack.inSoundPlayer && <span className="missing small">Not in the Sound player yet</span>}
        </div>
      ) : (
        <div className="track empty-track">Drop the music track here</div>
      )}
      <div className="row">
        <button className="small-button" onClick={() => act({ kind: 'chooseMusicTrack' })}>
          {musicTrack ? 'Change' : 'Choose'}
        </button>
        {musicTrack && (
          <button className="small-button" onClick={() => act({ kind: 'clearMusicTrack' })}>
            Remove
          </button>
        )}
      </div>
      <label>
        Music in
        <select value={music.in} onChange={(e) => act({ kind: 'setMusic', in: e.target.value, out: music.out })}>
          {inOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Music out
        <select value={music.out} onChange={(e) => act({ kind: 'setMusic', in: music.in, out: e.target.value })}>
          {outOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </DropPanel>
  );
}

// ---- The graphics windows ----

/**
 * Just the graphics that still need a file (RG, Oct 29, 2026), and ways to load them in: import a folder,
 * choose each one's file, or drop files on the window. A graphic leaves the list once it has its file.
 */
function MissingWindow({ state, onClose, onImport }: { state: AppState; onClose: () => void; onImport: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const missing = state.sections.flatMap((s) => s.elements.filter((e) => e.behavior !== 'music' && !e.file).map((e) => ({ section: s, element: e })));
  return (
    <div className="overlay" role="dialog" aria-label="Missing graphics" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="window small-window"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const paths = droppedPaths(e);
          if (paths.length) void act({ kind: 'addFiles', paths });
        }}
      >
        <h2>
          Missing graphics
          <span className="actions">
            {missing.length > 0 && <button onClick={onImport}>Import graphics</button>}
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </span>
        </h2>
        {state.problems.length > 0 && (
          <div className="problems">
            <h3>Files to place by hand</h3>
            {state.problems.map((p) => (
              <Problem key={p.path} problem={p} />
            ))}
          </div>
        )}
        {missing.length > 0 && <p className="muted">Import the graphics folder, choose each file, or drop files here.</p>}
        {missing.length === 0 ? (
          <p>Every graphic has its file.</p>
        ) : (
          <table className="elements">
            <tbody>
              {missing.map(({ section, element }) => (
                <tr key={element.id}>
                  <td className="muted">
                    {section.label} {section.slug}
                  </td>
                  <td>
                    <span className={`chip ${elementKind(element.type)}`}>{element.label}</span>
                  </td>
                  <td className="actions">
                    <button onClick={() => act({ kind: 'chooseFile', elementId: element.id })}>Choose file</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Edit graphics: every cue and its file.

function GraphicsWindow({ state, onClose, onImport }: { state: AppState; onClose: () => void; onImport: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-label="Graphics" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="window"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const paths = droppedPaths(e);
          if (paths.length) void act({ kind: 'addFiles', paths });
        }}
      >
        <h2>
          Graphics
          <span className="actions">
            <button onClick={onImport}>Import more</button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </span>
        </h2>
        {state.problems.length > 0 && (
          <div className="problems">
            <h3>Files to place by hand</h3>
            {state.problems.map((p) => (
              <Problem key={p.path} problem={p} />
            ))}
          </div>
        )}
        <table className="elements">
          <tbody>
            {state.sections.map((s) =>
              s.elements
                // Only this episode's own graphics: the show's permanent graphics (and its commercial
                // breaks) are in the Permanent graphics box (RG, Nov 2, 2026).
                .filter((e) => e.behavior !== 'music' && e.type !== 'PERM')
                .map((e, i) => (
                  <tr key={e.id}>
                    <td className="muted">{i === 0 ? `${s.label} ${s.slug}` : ''}</td>
                    <td>
                      <span className={`chip ${elementKind(e.type)}`}>{e.label}</span>
                    </td>
                    <td>{e.thumbnail ? <img className="mini" src={e.thumbnail} alt="" /> : null}</td>
                    <td>
                      {e.file ? (
                        <>
                          <span className="ready">✓</span> {e.file} <span className="muted">{e.seconds ? duration(e.seconds) : ''}</span>
                          {e.ddrItem === null && <span className="missing"> not in DDR 2</span>}
                        </>
                      ) : (
                        <span className="missing">Missing</span>
                      )}
                    </td>
                    <td className="actions">
                      <button onClick={() => act({ kind: 'chooseFile', elementId: e.id })}>{e.file ? 'Change' : 'Choose file'}</button>
                      {e.file && <button onClick={() => act({ kind: 'clearFile', elementId: e.id })}>Remove</button>}
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Problem({ problem }: { problem: AppState['problems'][number] }) {
  const [picked, setPicked] = useState(problem.candidates[0]?.id ?? '');
  // The menu shows the first choice when the one picked isn't in it any more, so that's the one used.
  const target = problem.candidates.some((c) => c.id === picked) ? picked : (problem.candidates[0]?.id ?? '');
  return (
    <div className="problem">
      <strong>{problem.name}</strong>
      <span className="muted">{problem.reason}</span>
      <span className="row">
        <select value={target} onChange={(e) => setPicked(e.target.value)} aria-label={`Put ${problem.name} on`}>
          {problem.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button className="primary" disabled={!target} onClick={() => act({ kind: 'assign', path: problem.path, elementId: target })}>
          Put it there
        </button>
        <button onClick={() => act({ kind: 'dismissProblem', path: problem.path })}>Ignore</button>
      </span>
    </div>
  );
}
