// The prompter (Phase 3): a full-screen page for the prompter computer, run from the keyboard by the
// prompter operator. It reads the same live episode room as the editors, so script edits show up within
// about a second without moving the line the anchor is reading. When a section start or a cue chip
// crosses the reading line, it tells the episode room, which passes it on (to the show app from Phase 4).
//
// Keys: ↑ faster, ↓ slower and then backwards, Space pause, Page Down / → next section, Page Up / ← back a
// section, Home the top, F full screen, S settings, ? help.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Y from 'yjs';
import {
  colorForTalent,
  computeRundown,
  cueLabel,
  elementKind,
  formatDuration,
  prompterLines,
  readRows,
  rowsOf,
  scriptBodiesOf,
  talentColors,
  type PrompterLine,
  type ShowSettings,
} from '@tstv/shared';
import { useLoad, type User } from '../lib/api.ts';
import { useEpisodeDoc, type PrompterStatus } from '../rundown/useEpisodeDoc.ts';
import type { EpisodeListItem } from './Show.tsx';

interface EpisodeData {
  episode: EpisodeListItem;
  show: { id: string; name: string; settings: ShowSettings };
}

/** Saved on the prompter computer (decided in the brief: no mirror setting is needed). */
export interface PrompterSettings {
  /** Text size, in pixels. */
  fontSize: number;
  lineSpacing: number;
  /** Space on each side, as a percentage of the screen's width. */
  margin: number;
  textColor: string;
  background: string;
  /** Where the reading line is, as a percentage of the screen's height from the top. */
  readingLine: number;
  /** How much each arrow press changes the speed, from 1 (gentle) to 10. */
  speedStep: number;
}

export const DEFAULT_PROMPTER_SETTINGS: PrompterSettings = {
  fontSize: 64,
  lineSpacing: 1.35,
  margin: 8,
  textColor: '#ffffff',
  background: '#000000',
  readingLine: 30,
  speedStep: 5,
};

const SETTINGS_KEY = 'tstv-prompter-settings';
const copyKey = (episodeId: string) => `tstv-prompter-copy-${episodeId}`;
/** Arrow presses from stopped to the top speed, either way. */
const MAX_SPEED = 20;

function loadSettings(): PrompterSettings {
  try {
    return { ...DEFAULT_PROMPTER_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PrompterSettings>) };
  } catch {
    return DEFAULT_PROMPTER_SETTINGS;
  }
}

export function PrompterPage({ episodeId, user }: { episodeId: string; user: User }) {
  const { data, error, reload } = useLoad<EpisodeData>(`/episodes/${episodeId}`);
  if (error) return <div className="prompter-message">{error}</div>;
  if (!data) return <div className="prompter-message">Loading…</div>;
  return <PrompterView data={data} user={user} reload={reload} />;
}

interface Marker {
  top: number;
  kind: 'section' | 'cue';
  sectionId: string;
  elementId?: string;
  label: string;
}

function PrompterView({ data, user, reload }: { data: EpisodeData; user: User; reload: () => void }) {
  const { episode, show } = data;
  const room = useEpisodeDoc(episode.id, user, reload);
  const [settings, setSettingsState] = useState(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [lines, setLines] = useState<PrompterLine[]>([]);
  const [hud, setHud] = useState({ speed: 0, paused: false, section: '' });
  const [panel, setPanel] = useState<'help' | 'settings' | null>('help');
  const [controlsVisible, setControlsVisible] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The scroll engine lives outside React, so scrolling never re-draws the page.
  const engine = useRef({ pos: 0, speed: 0, paused: false, lastTime: 0, markers: [] as Marker[], anchor: null as { key: string; offset: number } | null });
  const colors = useMemo(() => talentColors(room.talent, show.settings.talent), [room.talent, show.settings.talent]);

  const readingY = () => (viewport.current?.clientHeight ?? 0) * (settingsRef.current.readingLine / 100);
  const maxPos = () => Math.max(0, (content.current?.scrollHeight ?? 0) - (viewport.current?.clientHeight ?? 0));
  const draw = () => {
    if (content.current) content.current.style.transform = `translate3d(0, ${-engine.current.pos}px, 0)`;
  };

  /** Remembers which line is on the reading line, before the text changes. */
  const rememberLine = () => {
    const box = content.current;
    if (!box || engine.current.anchor) return;
    const lineY = engine.current.pos + readingY();
    let found: HTMLElement | null = null;
    for (const child of Array.from(box.children) as HTMLElement[]) {
      if (child.offsetTop > lineY) break;
      found = child;
    }
    if (found?.dataset.key) engine.current.anchor = { key: found.dataset.key, offset: found.offsetTop - engine.current.pos };
  };

  /** Puts that line back where it was, so edits above it don't move what the anchor is reading. */
  const keepLine = () => {
    const e = engine.current;
    const anchor = e.anchor;
    e.anchor = null;
    const el = anchor && content.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(anchor.key)}"]`);
    if (el) e.pos = Math.min(maxPos(), Math.max(0, el.offsetTop - anchor.offset));
    draw();
  };

  const measureMarkers = () => {
    const box = content.current;
    if (!box) return;
    engine.current.markers = Array.from(box.querySelectorAll<HTMLElement>('[data-marker]')).map((el) => ({
      top: el.offsetTop,
      kind: el.dataset.marker as 'section' | 'cue',
      sectionId: el.dataset.section!,
      elementId: el.dataset.element,
      label: el.dataset.label ?? '',
    }));
  };

  const sendCue = (m: Marker) => room.provider?.sendMessage(JSON.stringify({ type: 'cue', kind: m.kind, sectionId: m.sectionId, elementId: m.elementId }));

  /** Fires every section start and cue that crossed the reading line while moving forward. */
  const fireCrossings = (from: number, to: number) => {
    const y = readingY();
    for (const m of engine.current.markers) if (m.top > from + y && m.top <= to + y) sendCue(m);
  };

  const moveBy = (delta: number) => {
    const e = engine.current;
    const before = e.pos;
    e.pos = Math.min(maxPos(), Math.max(0, e.pos + delta));
    if (e.pos > before) fireCrossings(before, e.pos);
    draw();
  };

  const showHud = () => setHud((h) => ({ ...h, speed: engine.current.speed, paused: engine.current.paused }));

  // The episode's lines, rebuilt whenever the rundown or a script changes.
  useEffect(() => {
    const doc = room.doc;
    if (!doc) return;
    // The last copy saved on this computer, so the prompter works even if the internet is down.
    try {
      const saved = localStorage.getItem(copyKey(episode.id));
      if (saved) Y.applyUpdate(doc, Uint8Array.from(atob(saved), (ch) => ch.charCodeAt(0)));
    } catch {
      // No saved copy, or it couldn't be read: the live one arrives in a moment.
    }
    const rebuild = () => {
      rememberLine();
      const timing = computeRundown(readRows(doc), show.settings.targetSeconds, undefined, show.settings.breakSeconds);
      setLines(prompterLines(doc, timing, show.settings.defaultCamera));
    };
    rebuild();
    rowsOf(doc).observeDeep(rebuild);
    scriptBodiesOf(doc).observeDeep(rebuild);
    return () => {
      rowsOf(doc).unobserveDeep(rebuild);
      scriptBodiesOf(doc).unobserveDeep(rebuild);
    };
  }, [room.doc, episode.id, show.settings]);

  // Keep a copy of the episode on this computer, a few seconds behind.
  useEffect(() => {
    const doc = room.doc;
    if (!doc || !room.synced) return;
    const save = () => {
      try {
        const update = Y.encodeStateAsUpdate(doc);
        let text = '';
        for (let i = 0; i < update.length; i += 0x8000) text += String.fromCharCode(...update.subarray(i, i + 0x8000));
        localStorage.setItem(copyKey(episode.id), btoa(text));
      } catch {
        // Out of room on this computer: the prompter still works while it's online.
      }
    };
    save();
    const timer = setInterval(save, 5000);
    return () => clearInterval(timer);
  }, [room.doc, room.synced, episode.id]);

  useLayoutEffect(() => {
    keepLine();
    measureMarkers();
  }, [lines, settings, colors]);

  // Scrolling, about 60 times a second.
  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      const e = engine.current;
      const seconds = e.lastTime ? Math.min(0.1, (time - e.lastTime) / 1000) : 0;
      e.lastTime = time;
      if (!e.paused && e.speed !== 0) {
        const s = settingsRef.current;
        // Each arrow press adds speedStep × 0.016 lines a second: at the default, 4 presses is about a
        // typical anchor's reading pace.
        const pixelsPerSecond = e.speed * s.speedStep * 0.016 * s.fontSize * s.lineSpacing;
        moveBy(pixelsPerSecond * seconds);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [room.provider]);

  // Where the prompter is, for the rundown page (and the show app from Phase 4), a few times a second.
  useEffect(() => {
    let last = '';
    const timer = setInterval(() => {
      const e = engine.current;
      const lineY = e.pos + readingY();
      const current = [...e.markers].reverse().find((m) => m.kind === 'section' && m.top <= lineY + 1);
      const status: PrompterStatus = { sectionId: current?.sectionId ?? null, label: current?.label ?? '', speed: e.speed, paused: e.paused };
      const text = JSON.stringify(status);
      if (text === last) return;
      last = text;
      room.provider?.awareness.setLocalStateField('prompter', status);
      setHud({ speed: e.speed, paused: e.paused, section: status.label });
    }, 250);
    return () => clearInterval(timer);
  }, [room.provider]);

  // The operator's keys.
  useEffect(() => {
    const jumpToSection = (direction: 1 | -1) => {
      const e = engine.current;
      const lineY = e.pos + readingY();
      const sections = e.markers.filter((m) => m.kind === 'section');
      let target: Marker | undefined;
      if (direction === 1) target = sections.find((m) => m.top > lineY + 1);
      else {
        const current = [...sections].reverse().find((m) => m.top <= lineY + 1);
        // Back to the start of this section, or to the one before if already at its start.
        target = current && lineY - current.top > 40 ? current : [...sections].reverse().find((m) => m.top < (current?.top ?? lineY) - 1);
      }
      if (!target) return;
      e.pos = Math.min(maxPos(), Math.max(0, target.top - readingY()));
      draw();
      // A jump starts that section, but doesn't fire the cues it skipped.
      if (direction === 1) sendCue(target);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, textarea')) return;
      const e = engine.current;
      let handled = true;
      switch (event.key) {
        case 'ArrowUp':
          e.speed = Math.min(MAX_SPEED, e.speed + 1);
          e.paused = false;
          break;
        case 'ArrowDown':
          e.speed = Math.max(-MAX_SPEED, e.speed - 1);
          e.paused = false;
          break;
        case ' ':
          e.paused = !e.paused;
          break;
        case 'PageDown':
        case 'ArrowRight':
          jumpToSection(1);
          break;
        case 'PageUp':
        case 'ArrowLeft':
          jumpToSection(-1);
          break;
        case 'Home':
          e.pos = 0;
          e.speed = 0;
          draw();
          break;
        case 'f':
        case 'F':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.();
          break;
        case 's':
        case 'S':
          setPanel((p) => (p === 'settings' ? null : 'settings'));
          break;
        case '?':
        case 'h':
        case 'H':
          setPanel((p) => (p === 'help' ? null : 'help'));
          break;
        case 'Escape':
          setPanel(null);
          handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        showHud();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [room.provider]);

  // The help goes away by itself after a few seconds, and the buttons hide while the mouse is still.
  useEffect(() => {
    const timer = setTimeout(() => setPanel((p) => (p === 'help' ? null : p)), 8000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    let timer = setTimeout(() => setControlsVisible(false), 2500);
    const move = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setControlsVisible(false), 2500);
    };
    window.addEventListener('mousemove', move);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', move);
    };
  }, []);
  useEffect(() => {
    const onResize = () => {
      rememberLine();
      keepLine();
      measureMarkers();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setSettings = (next: PrompterSettings) => {
    rememberLine();
    setSettingsState(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Lasts until the page closes.
    }
  };

  const style = {
    '--p-size': `${settings.fontSize}px`,
    '--p-spacing': settings.lineSpacing,
    '--p-margin': `${settings.margin}vw`,
    '--p-text': settings.textColor,
    '--p-bg': settings.background,
    '--p-line': `${settings.readingLine}vh`,
  } as CSSProperties;

  return (
    <div className={`prompter${controlsVisible ? '' : ' idle'}`} style={style} aria-label={`Prompter for ${episode.title}`}>
      <div
        className="prompter-viewport"
        ref={viewport}
        onWheel={(event) => {
          moveBy(event.deltaY);
        }}
      >
        <div className="prompter-content" ref={content}>
          {lines.map((line) => (
            <Line key={line.key} line={line} colors={colors} />
          ))}
        </div>
      </div>
      <div className="prompter-reading-line" aria-hidden="true">
        <span>▶</span>
        <span>◀</span>
      </div>

      <div className="prompter-hud" role="status">
        <span>{hud.paused ? '❚❚ Paused' : hud.speed === 0 ? '■ Stopped' : hud.speed > 0 ? `▶ ${hud.speed}` : `◀ ${-hud.speed} backwards`}</span>
        {hud.section && <span>{hud.section}</span>}
        {(room.status !== 'connected' || !room.synced) && (
          <span className="prompter-offline">{lines.length > 1 ? 'Offline: showing the last copy. Cues aren’t reaching the show.' : 'Connecting…'}</span>
        )}
      </div>

      <div className="prompter-controls">
        <button onClick={() => setPanel(panel === 'help' ? null : 'help')}>Keys (?)</button>
        <button onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>Settings (S)</button>
        <button onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.())}>Full screen (F)</button>
      </div>

      {panel === 'help' && (
        <div className="prompter-panel" role="dialog" aria-label="Prompter keys">
          <h2>Prompter keys</h2>
          <dl>
            <dt>↑</dt>
            <dd>Faster</dd>
            <dt>↓</dt>
            <dd>Slower; below a stop it runs backwards</dd>
            <dt>Space</dt>
            <dd>Pause and resume</dd>
            <dt>Page Down or →</dt>
            <dd>Next section</dd>
            <dt>Page Up or ←</dt>
            <dd>Back to the start of this section, then the one before</dd>
            <dt>Home</dt>
            <dd>Back to the top, stopped</dd>
            <dt>F</dt>
            <dd>Full screen</dd>
            <dt>S</dt>
            <dd>Settings</dd>
          </dl>
          <p>The mouse wheel nudges the text. Cues fire as they cross the reading line (the arrows at the side).</p>
          <button onClick={() => setPanel(null)}>Close</button>
        </div>
      )}
      {panel === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Line({ line, colors }: { line: PrompterLine; colors: ReturnType<typeof talentColors> }) {
  switch (line.kind) {
    case 'block':
      return (
        <div className="p-block" data-key={line.key}>
          BLOCK {line.label}
          {line.title ? `: ${line.title.toUpperCase()}` : ''}
        </div>
      );
    case 'break':
      return (
        <div className="p-break" data-key={line.key}>
          COMMERCIAL BREAK{line.seconds > 0 ? ` · ${formatDuration(line.seconds)}` : ''}
        </div>
      );
    case 'section':
      return (
        <div className="p-section" data-key={line.key} data-marker="section" data-section={line.sectionId} data-label={line.label}>
          {/* Just the number and the camera; the script's speaker markers say who reads (RG, Oct 29, 2026). */}
          <span className="p-label">{line.label}</span>
          <span className="p-camera">{line.camera.toUpperCase()}</span>
        </div>
      );
    case 'crossTalk':
      return (
        <div className="p-cross-talk" data-key={line.key}>
          CROSS TALK
        </div>
      );
    case 'speaker':
      return (
        <div className="p-speaker" data-key={line.key} style={{ color: colorForTalent(line.name, colors) }}>
          {line.name}
        </div>
      );
    case 'cue':
      return (
        <div className={`p-cue ${elementKind(line.element.type)}`} data-key={line.key} data-marker="cue" data-section={line.sectionId} data-element={line.element.id}>
          <span>{cueLabel(line.element).toUpperCase()}</span>
        </div>
      );
    case 'text':
      return (
        <p className="p-text" data-key={line.key}>
          {line.text || ' '}
        </p>
      );
    case 'end':
      return (
        <div className="p-end" data-key={line.key}>
          END OF SHOW
        </div>
      );
  }
}

function SettingsPanel({ settings, onChange, onClose }: { settings: PrompterSettings; onChange: (s: PrompterSettings) => void; onClose: () => void }) {
  const number = (key: keyof PrompterSettings, label: string, min: number, max: number, step: number, unit = '') => (
    <label>
      {label}
      <span className="row">
        <input type="range" min={min} max={max} step={step} value={settings[key] as number} onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })} />
        <output>
          {settings[key]}
          {unit}
        </output>
      </span>
    </label>
  );
  return (
    <div className="prompter-panel settings-panel" role="dialog" aria-label="Prompter settings">
      <h2>Prompter settings</h2>
      <p className="small">Saved on this computer.</p>
      {number('fontSize', 'Text size', 24, 160, 2, ' px')}
      {number('lineSpacing', 'Line spacing', 1, 2.2, 0.05)}
      {number('margin', 'Side margins', 0, 30, 1, '%')}
      {number('readingLine', 'Reading line, from the top', 10, 70, 1, '%')}
      {number('speedStep', 'Speed change per arrow press', 1, 10, 1)}
      <label>
        Text color
        <input type="color" value={settings.textColor} onChange={(e) => onChange({ ...settings, textColor: e.target.value })} />
      </label>
      <label>
        Background color
        <input type="color" value={settings.background} onChange={(e) => onChange({ ...settings, background: e.target.value })} />
      </label>
      <div className="row">
        <button onClick={() => onChange(DEFAULT_PROMPTER_SETTINGS)}>Back to the defaults</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
