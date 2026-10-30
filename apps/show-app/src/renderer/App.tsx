// The producer screen, laid out from RG's sketch (docs/show-app-sketch.pdf, Oct 29, 2026):
//   top:    Program with the cameras under it · the Playlist (on air, up next) · Pause/Continue, section, elapsed, time left
//   bottom: Up next preview · Permanent graphics drop box · Green screen drop box · Music
// The episode key is at the top right. Import graphics opens a window that matches files to cues.
// Keys: Space fires the next cue, and P switches between manual mode and automation. In manual mode only,
// → fires the next graphic too, ← goes back one, and ↓ takes it off (RG, Oct 29, 2026).
import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { elementKind } from '@tstv/shared';
import type { Action, AppState, ElementView } from '../shared/api.ts';
import { useTheme } from './theme.ts';

declare global {
  interface Window {
    showApp: {
      onState(listener: (state: AppState) => void): () => void;
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

  // The show's keys (see the top of this file). Not while typing in a box or with a window open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea') || !state?.episode || graphicsOpen) return;
      // The arrows work only in manual mode, so a stray press can't upset the automation.
      const manual = state.automation.manual;
      const action: Action | null =
        e.key === ' ' || (manual && e.key === 'ArrowRight')
          ? { kind: 'fireNext' }
          : manual && e.key === 'ArrowLeft'
            ? { kind: 'fireBack' }
            : manual && e.key === 'ArrowDown'
              ? { kind: 'takeOff' }
              : e.key === 'p' || e.key === 'P'
                ? { kind: 'setManual', manual: !state.automation.manual }
                : null;
      if (!action) return;
      e.preventDefault();
      // The button clicked last still has the keyboard; let go of it, so Space doesn't press it as well.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      void act(action);
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
  return (
    <div className={`app${state.automation.manual ? ' manual' : ''}`}>
      <Header state={state} />
      {!state.episode ? (
        <main className="empty">
          <p>
            Click <strong>Episode key</strong> at the top right, and paste the key from the episode’s <strong>Show app key</strong> button on the website.
          </p>
        </main>
      ) : (
        <Show state={state} onImport={() => importGraphics()} onEdit={() => setGraphicsOpen('edit')} onMissing={() => setGraphicsOpen('missing')} />
      )}
      {graphicsOpen === 'edit' && state.episode && <GraphicsWindow state={state} onClose={() => setGraphicsOpen(false)} onImport={() => importGraphics('edit')} />}
      {graphicsOpen === 'missing' && state.episode && <MissingWindow state={state} onClose={() => setGraphicsOpen(false)} onImport={() => importGraphics('missing')} />}
    </div>
  );
}

// ---- Header: show and episode at the left; status lights and the episode key at the right ----

function Header({ state }: { state: AppState }) {
  const { website, switcher, prompter, episode } = state;
  const [open, setOpen] = useState<'key' | 'simulator' | null>(episode ? null : 'key');
  useEffect(() => {
    if (episode) setOpen(null);
  }, [episode?.id]);
  return (
    <header className="topbar">
      <ThemeSwitch />
      <span className="title">{episode ? `${episode.showName} · ${episode.title}` : 'TSTV Show App'}</span>
      <span className="mode" title="Phase 4 runs the simulator only. Live mode for the real TC1 comes in Phase 5.">
        SIMULATOR
      </span>
      <span className="lights">
        <Light on={website.status === 'connected'} warn={website.status === 'connecting'} label="Website" detail={website.error ?? website.status} />
        <Light on={prompter.connected} label="Prompter" detail={prompter.connected ? `On ${prompter.label || 'the top'}` : 'The prompter isn’t open on this episode'} />
        <button className="light-button" onClick={() => setOpen(open === 'simulator' ? null : 'simulator')} title="Click to change the simulator’s address">
          <Light on={switcher.status === 'connected'} warn={switcher.status === 'connecting'} label="Simulator" detail={switcher.error ?? `${switcher.address}: ${switcher.status}`} />
        </button>
      </span>
      <button className={episode ? '' : 'primary'} onClick={() => setOpen(open === 'key' ? null : 'key')} aria-expanded={open === 'key'}>
        Episode key
      </button>
      {open === 'key' && <KeyPanel state={state} onDone={() => setOpen(null)} />}
      {open === 'simulator' && <SimulatorPanel state={state} />}
    </header>
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
      <p>On the website, open the episode, click <strong>Show app key</strong> and <strong>Copy</strong>, then paste it here.</p>
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
      {automation.manual ? (
        <div className="banner manual-banner" role="alert">
          Manual mode: the prompter fires nothing. <kbd>Space</kbd> or <kbd>→</kbd> fires the next graphic, <kbd>←</kbd> goes back one, and <kbd>↓</kbd> takes it off. Click a camera to take it.{' '}
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
            The prompter isn’t connected. Keep the show going by firing each cue with the <kbd>Space</kbd> bar.
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
        </div>
        <Playlist state={state} onImport={onImport} onEdit={onEdit} onMissing={onMissing} />
        <Status state={state} />
        <Preview state={state} />
        <PermanentBox state={state} />
        <GreenScreenBox state={state} />
        <Music state={state} />
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
  const keyed = state.switcher.dskOn ? onAir?.playable : null;
  // Until its clip can play (being made, or its drive isn't plugged in), a graphic shows as its still.
  const still = state.switcher.dskOn && onAir && !onAir.playable ? onAir.thumbnail : null;
  // The laptop's sound takes over a second to wake for the first clip, which held that clip back. A silent
  // sound kept playing keeps it awake.
  useEffect(() => {
    const audio = new AudioContext();
    const gain = audio.createGain();
    gain.gain.value = 0;
    const silence = audio.createOscillator();
    silence.connect(gain).connect(audio.destination);
    silence.start();
    return () => void audio.close();
  }, []);
  return (
    <div className="program" aria-label="Program">
      {camera?.video ? (
        <CameraPicture src={`${camera.video}?size=large`} />
      ) : (
        <span className="program-note">Live video from the TriCaster will show here in a later version.</span>
      )}
      {keyed && <ProgramClip key={onAir!.id} src={keyed} />}
      {still && <img className="program-clip" src={still} alt="" />}
      <span className={`live-dot${state.live.on ? ' on' : ''}`}>{state.live.on ? '● LIVE' : '○ Not live'}</span>
      <span className="program-caption">
        <strong>{camera?.name ?? (state.switcher.programInput ? `Input ${state.switcher.programInput}` : 'No camera')}</strong>
        {onAir && <> + {onAir.label}</>}
        {still && <span className="muted"> (still: {onAir!.fileFound ? 'getting its clip ready' : 'the app can’t read its file'})</span>}
        {state.switcher.musicPlaying && <> + ♪ music</>}
      </span>
    </div>
  );
}

/** The clip on DSK 2, playing from its start with its sound; a still is shown as it is. */
function ProgramClip({ src }: { src: string }) {
  return src.endsWith('.png') ? <img className="program-clip" src={src} alt="" /> : <video className="program-clip" src={src} autoPlay playsInline />;
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

function CameraPicture({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return <span className="camera-picture none">No picture</span>;
  return <img className="camera-picture" src={src} alt="" onError={() => setBroken(true)} />;
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
      }
    >
      <h3>
        On air
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
            Fire next <kbd>{manual ? 'Space / →' : 'Space'}</kbd>
          </button>
        </span>
      </h3>
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
      <Skipped state={state} />
    </Panel>
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
      <span className={`chip ${elementKind(element.type)}`}>{element.label}</span>
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

function Status({ state }: { state: AppState }) {
  const now = useNow();
  const { automation, clock, switcher, lastCue } = state;
  const playing = clipProgress(state) !== null;
  const ms = lastCue?.latencyMs ?? null;
  return (
    <section className="cell panel status">
      <button className={`pause${automation.manual ? ' resume' : ''}`} onClick={() => act({ kind: 'setManual', manual: !automation.manual })}>
        {automation.manual ? 'Continue automation' : 'Pause automation'} <kbd>P</kbd>
      </button>
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
      <p className="muted small">Drop the show’s permanent graphics here once; every episode uses them.</p>
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

function GreenScreenBox({ state }: { state: AppState }) {
  const g = state.greenScreen;
  return (
    <DropPanel title="Green screen" className="green" onFiles={(paths) => act({ kind: 'setGreenScreen', path: paths[0] })}>
      <div className="thumb small-thumb">{g?.thumbnail ? <img src={g.thumbnail} alt="" /> : <span>{g ? g.file : 'Drop the background here'}</span>}</div>
      {g && <p className="small">{g.file}</p>}
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
  const outOptions = [{ id: 'default', label: `Default: ${music.defaults.out}` }, ...inOptions.slice(1)];
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
        Music out (just before)
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
                .filter((e) => e.behavior !== 'music')
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
  const [target, setTarget] = useState(problem.candidates[0]?.id ?? '');
  return (
    <div className="problem">
      <strong>{problem.name}</strong>
      <span className="muted">{problem.reason}</span>
      <span className="row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`Put ${problem.name} on`}>
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
