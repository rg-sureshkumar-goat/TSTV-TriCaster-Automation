// The producer screen (Phase 4): camera buttons, what's on air and up next, a preview, Pause Automation,
// the show clock, and the episode's graphics and music. Keys: Space fires the next cue, P pauses.
import { useEffect, useState, type DragEvent } from 'react';
import type { Action, AppState, ElementView } from '../shared/api.ts';

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
  if (seconds === null) return '';
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

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => window.showApp.onState(setState), []);

  // Space fires the next cue; P pauses and resumes. Not while typing in a box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea') || !state?.episode) return;
      if (e.key === ' ') {
        e.preventDefault();
        void act({ kind: 'fireNext' });
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        void act({ kind: 'pause', paused: !state.automation.paused });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  if (!state) return <div className="loading">Starting…</div>;
  return (
    <div className={`app${state.automation.paused ? ' paused' : ''}`}>
      <TopBar state={state} />
      {!state.episode ? <Connect state={state} /> : <Show state={state} />}
    </div>
  );
}

function Light({ on, warn, label, detail }: { on: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <span className={`light ${on ? (warn ? 'warn' : 'on') : 'off'}`} title={detail}>
      <span className="dot" /> {label}
    </span>
  );
}

function TopBar({ state }: { state: AppState }) {
  const { website, switcher, prompter, episode } = state;
  return (
    <header className="topbar">
      <strong className="brand">TSTV Show App</strong>
      <span className="mode" title="Phase 4 runs the simulator only. Live mode for the real TC1 comes in Phase 5.">
        SIMULATOR
      </span>
      {episode && (
        <span className="episode">
          {episode.showName} · <strong>{episode.title}</strong>
        </span>
      )}
      <span className="lights">
        <Light on={website.status === 'connected'} warn={website.status === 'connecting'} label="Website" detail={website.error ?? website.status} />
        <Light on={prompter.connected} label="Prompter" detail={prompter.connected ? `On ${prompter.label || 'the top'}` : 'The prompter isn’t open on this episode'} />
        <Light on={switcher.status === 'connected'} warn={switcher.status === 'connecting'} label="Simulator" detail={switcher.error ?? `${switcher.address}: ${switcher.status}`} />
      </span>
    </header>
  );
}

function Connect({ state }: { state: AppState }) {
  const [key, setKey] = useState(state.website.key);
  const [siteUrl, setSiteUrl] = useState(state.website.siteUrl);
  return (
    <main className="connect">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void act({ kind: 'connect', siteUrl, key });
        }}
      >
        <h1>Connect to an episode</h1>
        <p>On the website, open the episode, click <strong>Show app key</strong>, copy the key and paste it here.</p>
        <label>
          Episode key
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="tstv-…" autoFocus required />
        </label>
        <details>
          <summary>Website address</summary>
          <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} />
        </details>
        {state.website.error && <p className="error">{state.website.error}</p>}
        <button className="primary" type="submit" disabled={state.website.status === 'connecting'}>
          {state.website.status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      <SimulatorBox state={state} />
    </main>
  );
}

function SimulatorBox({ state }: { state: AppState }) {
  const [address, setAddress] = useState(state.switcher.address);
  return (
    <form
      className="card small-card"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ kind: 'connectSwitcher', address });
      }}
    >
      <h2>Simulator</h2>
      <p className="muted">Start it with <code>npm run simulator</code>. The app only talks to the simulator in Phase 4.</p>
      <div className="row">
        <input value={address} onChange={(e) => setAddress(e.target.value)} aria-label="Simulator address" />
        <button type="submit">{state.switcher.status === 'connected' ? 'Reconnect' : 'Connect'}</button>
      </div>
      {state.switcher.error && <p className="error">{state.switcher.error}</p>}
    </form>
  );
}

function Show({ state }: { state: AppState }) {
  const { automation, switcher, cameras, prompter, website } = state;
  const next = automation.upNext[0];
  const nextSection = state.sections.find((s) => s.id === next?.sectionId);
  return (
    <main className="show">
      {website.status === 'connected' && !prompter.connected && (
        <div className="banner" role="alert">
          The prompter isn’t connected. Keep the show going by firing each cue with the <kbd>Space</kbd> bar.
        </div>
      )}
      {automation.paused && (
        <div className="banner paused-banner" role="alert">
          Automation is paused. The app sends nothing; the TD runs the switcher. Press <kbd>P</kbd> or Resume to pick up from the prompter.
        </div>
      )}
      <section className="cameras" aria-label="Cameras">
        {cameras.map((c) => (
          <button key={c.name} className={`camera${switcher.programInput === c.input ? ' on-air' : ''}`} onClick={() => act({ kind: 'takeCamera', input: c.input })} disabled={automation.paused}>
            <strong>{c.name}</strong>
            <span>Input {c.input}</span>
          </button>
        ))}
      </section>

      <div className="columns">
        <section className="panel">
          <h2>On air</h2>
          <OnAir element={automation.onAir} state={state} />
          <h2>
            Up next
            <button className="primary fire" onClick={() => act({ kind: 'fireNext' })} disabled={!next || automation.paused}>
              Fire next <kbd>Space</kbd>
            </button>
          </h2>
          <ol className="queue">
            {automation.upNext.map((e, i) => (
              <li key={e.id} className={i === 0 ? 'first' : ''}>
                <span className={`chip ${e.behavior}`}>{e.label}</span>
                <span className="muted">{e.sectionLabel}</span>
                {e.ddrItem === null && e.behavior !== 'music' && <span className="missing">no file in DDR 2</span>}
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
        </section>

        <section className="panel preview">
          <h2>Preview</h2>
          {next ? (
            <>
              <div className="thumb">{next.thumbnail ? <img src={next.thumbnail} alt="" /> : <span>{next.file ?? 'No file yet'}</span>}</div>
              <p>
                <strong>{next.label}</strong> ({next.sectionLabel})
                <br />
                <span className="muted">over {nextSection?.camera ?? 'the section’s camera'}</span>
              </p>
            </>
          ) : (
            <p className="muted">Nothing up next.</p>
          )}
        </section>

        <section className="panel side">
          <button className={`pause${automation.paused ? ' resume' : ''}`} onClick={() => act({ kind: 'pause', paused: !automation.paused })}>
            {automation.paused ? 'Resume automation' : 'Pause automation'} <kbd>P</kbd>
          </button>
          <Clock state={state} />
          <LastCue state={state} />
          <h2>Activity</h2>
          <ul className="log">
            {state.log.map((l) => (
              <li key={`${l.at}-${l.text}`}>
                <span className="muted">{new Date(l.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span> {l.text}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Graphics state={state} />
      <Music state={state} />
      <div className="footer-row">
        <SimulatorBox state={state} />
        <button className="link" onClick={() => act({ kind: 'disconnect' })}>
          Connect to a different episode
        </button>
      </div>
    </main>
  );
}

function OnAir({ element, state }: { element: ElementView | null; state: AppState }) {
  const camera = state.cameras.find((c) => c.input === state.switcher.programInput);
  return (
    <div className="on-air-card">
      <span className="tally">ON AIR</span>
      <span>
        <strong>{camera?.name ?? (state.switcher.programInput ? `Input ${state.switcher.programInput}` : 'No camera')}</strong>
        {element ? (
          <>
            {' '}
            + <span className={`chip ${element.behavior}`}>{element.label}</span> <span className="muted">{element.sectionLabel}</span>
            {state.switcher.ddrPlaying && element.behavior !== 'graphic' && <span className="muted"> · playing</span>}
          </>
        ) : (
          <span className="muted"> · nothing on DSK 2</span>
        )}
        {state.switcher.musicPlaying && <span className="chip music"> ♪ music</span>}
      </span>
    </div>
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

function Clock({ state }: { state: AppState }) {
  const now = useNow();
  const { clock, automation } = state;
  const over = clock.overUnderSeconds;
  return (
    <div className="clock">
      <div>
        <span className="muted">Elapsed</span>
        <strong>{clock.startedAt ? duration((now - clock.startedAt) / 1000) : '0:00'}</strong>
      </div>
      <div>
        <span className="muted">Section</span>
        <strong>{automation.sectionLabel ?? '—'}</strong>
      </div>
      <div>
        <span className="muted">Over/under</span>
        <strong className={over === null ? '' : over > 0 ? 'over' : 'under'}>{over === null ? '—' : `${over > 0 ? '+' : over < 0 ? '−' : ''}${duration(Math.abs(over))}`}</strong>
      </div>
    </div>
  );
}

function LastCue({ state }: { state: AppState }) {
  const cue = state.lastCue;
  if (!cue) return <p className="muted small">No cues yet.</p>;
  const ms = cue.latencyMs;
  const speed = ms === null ? '' : ms < 300 ? 'fast' : ms < 500 ? 'ok' : 'slow';
  return (
    <p className="last-cue">
      Last cue: <strong>{cue.label}</strong>
      {ms !== null && (
        <span className={`latency ${speed}`} title="From the prompter’s reading line to the switcher command (green under 0.3 s, amber up to 0.5 s)">
          {(ms / 1000).toFixed(2)} s
        </span>
      )}
    </p>
  );
}

function Graphics({ state }: { state: AppState }) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => window.showApp.pathOf(f)).filter(Boolean);
    if (paths.length) void act({ kind: 'addFiles', paths });
  };
  const missing = state.sections.flatMap((s) => s.elements).filter((e) => e.behavior !== 'music' && !e.file).length;
  return (
    <section
      className={`panel graphics${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <h2>
        Graphics
        <span className="muted small">{missing === 0 ? 'Every element has its file.' : `${missing} element${missing === 1 ? '' : 's'} still need a file.`}</span>
        <span className="actions">
          <button className="primary" onClick={() => act({ kind: 'importFiles' })}>
            Import graphics
          </button>
          <button onClick={() => act({ kind: 'loadSimulator' })} title="Puts the show’s files in the simulator’s DDR 2, in rundown order (Send to TriCaster does this on the real TC1 in Phase 5)">
            Load into the simulator
          </button>
        </span>
      </h2>
      <p className="muted small">Import picks files or a folder, like the graphics team’s USB drive, and matches names like B5_VO_Basketball to the rundown. You can also drop files here.</p>
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
                    <span className={`chip ${e.behavior}`}>{e.label}</span>
                  </td>
                  <td>{e.thumbnail ? <img className="mini" src={e.thumbnail} alt="" /> : null}</td>
                  <td>
                    {e.file ? (
                      <>
                        <span className="ready">✓</span> {e.file} <span className="muted">{duration(e.seconds)}</span>
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
    </section>
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

function Music({ state }: { state: AppState }) {
  const { music } = state;
  const options = [
    { id: 'default', label: `Default: ${music.defaults.in}` },
    { id: 'none', label: 'Never by itself' },
    ...music.points,
  ];
  const outOptions = [{ id: 'default', label: `Default: ${music.defaults.out}` }, ...options.slice(1)];
  return (
    <section className="panel music">
      <h2>Music</h2>
      <p className="muted small">When the Sound player’s music starts and stops for this show. By default it starts with the first Tease in block A and stops just before the Show Intro.</p>
      <div className="row">
        <label>
          Music in
          <select value={music.in} onChange={(e) => act({ kind: 'setMusic', in: e.target.value, out: music.out })}>
            {options.map((o) => (
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
      </div>
    </section>
  );
}
