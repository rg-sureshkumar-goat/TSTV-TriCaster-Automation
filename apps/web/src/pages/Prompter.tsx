// The prompter (Phase 3): a full-screen page for the prompter computer, run from the keyboard by the
// prompter operator. It reads the same live episode room as the editors, so script edits show up within
// about a second without moving the line the anchor is reading. When a section start or a cue chip
// crosses the reading line, it tells the episode room, which passes it on (to the show app from Phase 4).
//
// Keys: ↑ faster, ↓ slower and then backwards, Space pause, Page Down / → next section, Page Up / ← back a
// section, H (or Home) the top, F full screen, S settings, ? help. The Go to section list at the top jumps
// to any section.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Y from 'yjs';
import {
  colorForTalent,
  computeRundown,
  cueLabel,
  elementKind,
  formatDuration,
  prompterLines,
  scriptRuns,
  talentColors,
  readRows,
  rowsOf,
  scriptBodiesOf,
  type PrompterCue,
  type PrompterLine,
  type PrompterTextStyle,
  type ShowSettings,
} from '@tstv/shared';
import { useLoad, type User } from '../lib/api.ts';
import { useEpisodeDoc, type PrompterStatus } from '../rundown/useEpisodeDoc.ts';
import type { EpisodeListItem } from './Show.tsx';

interface EpisodeData {
  episode: EpisodeListItem;
  show: { id: string; name: string; settings: ShowSettings };
}

/** How one kind of text looks: regular words, or words in a kind of bracket. */
interface TextLook {
  /** In points, as in Rundown Creator. */
  fontSize: number;
  color: string;
  background: string;
  bold: boolean;
  italic: boolean;
  hide: boolean;
}

/** Saved on the prompter computer. */
export interface PrompterSettings {
  styles: Record<PrompterTextStyle, TextLook>;
  showPageNumbers: boolean;
  showStorySlugs: boolean;
  flipText: boolean;
  lineSpacing: number;
  /**
   * Space on each side that the prompter's hood hides, as a percentage of the screen's width. The arrows
   * sit just inside it, and the text just inside them.
   */
  margin: number;
  /** Where the reading line is, as a percentage of the screen's height from the top. */
  readingLine: number;
  /** Size of the reading-line arrows, as a percentage of the text size. */
  markerSize: number;
}

/** TSTV's settings in Rundown Creator, read from its prompter (RG, Nov 4, 2026). */
export const DEFAULT_PROMPTER_SETTINGS: PrompterSettings = {
  styles: {
    regular: { fontSize: 81, color: 'White', background: 'Black', bold: true, italic: false, hide: false },
    curly: { fontSize: 35, color: 'Red', background: 'Yellow', bold: true, italic: false, hide: false },
    square: { fontSize: 24, color: 'White', background: 'Black', bold: false, italic: false, hide: true },
    parentheses: { fontSize: 30, color: 'Green', background: 'Black', bold: true, italic: true, hide: false },
    carets: { fontSize: 24, color: 'White', background: 'Black', bold: false, italic: false, hide: true },
  },
  showPageNumbers: true,
  showStorySlugs: false,
  flipText: false,
  // The browser's normal spacing for this font, which is Rundown Creator's.
  lineSpacing: 1.15,
  margin: 8,
  readingLine: 30,
  // The same size as before the text grew to 81 points (70 pixels).
  markerSize: 65,
};

const SETTINGS_KEY = 'tstv-prompter-settings';
const copyKey = (episodeId: string) => `tstv-prompter-copy-${episodeId}`;
/** Arrow presses from stopped to the top speed, either way (20 until RG raised it, Nov 2, 2026). */
const MAX_SPEED = 40;

const TEXT_STYLES: { style: PrompterTextStyle; label: string }[] = [
  { style: 'regular', label: 'Regular Text' },
  { style: 'curly', label: '{Curly Brackets}' },
  { style: 'square', label: '[Square Brackets]' },
  { style: 'parentheses', label: '(Parentheses)' },
  { style: 'carets', label: '<Carets>' },
];
const COLORS = ['Black', 'White', 'Maroon', 'Green', 'Olive', 'Navy', 'Purple', 'Teal', 'Gray', 'Silver', 'Red', 'Lime', 'Yellow', 'Blue', 'Fuchsia', 'Aqua'];

function textLook(look: TextLook, showBackground = true): CSSProperties {
  return { fontSize: `${look.fontSize}pt`, color: look.color, background: showBackground ? look.background : undefined, fontWeight: look.bold ? 700 : 400, fontStyle: look.italic ? 'italic' : 'normal' };
}

/** Whether a line has anything to show: a line of only hidden text takes up no room. */
function lineShows(line: PrompterLine, settings: PrompterSettings): boolean {
  if (line.kind === 'speaker') return !settings.styles.curly.hide || line.cues.length > 0;
  if (line.kind !== 'text' || !line.text.trim()) return true;
  return scriptRuns(line.text).some((run) => !settings.styles[run.style].hide && run.text.trim());
}

function loadSettings(): PrompterSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PrompterSettings>;
    return { ...DEFAULT_PROMPTER_SETTINGS, ...saved, styles: { ...DEFAULT_PROMPTER_SETTINGS.styles, ...saved.styles } };
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
  const engine = useRef({ pos: 0, speed: 0, paused: false, markers: [] as Marker[], anchor: null as { key: string; offset: number } | null });

  const readingY = () => (viewport.current?.clientHeight ?? 0) * (settingsRef.current.readingLine / 100);
  const maxPos = () => Math.max(0, (content.current?.scrollHeight ?? 0) - (viewport.current?.clientHeight ?? 0));
  const colors = useMemo(() => talentColors(room.talent, show.settings.talent), [room.talent, show.settings.talent]);

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

  /** Jumps to a section and starts it, without firing the cues it skipped. */
  const goToSection = (target: Marker) => {
    engine.current.pos = Math.min(maxPos(), Math.max(0, target.top - readingY()));
    draw();
    sendCue(target);
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

  // Scrolling, once per screen refresh. Each arrow press adds a pixel per refresh, as in Rundown Creator, so
  // the same presses give the same speed on the same screen (RG, Nov 4, 2026).
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const e = engine.current;
      if (!e.paused && e.speed !== 0) moveBy(e.speed);
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
      if (direction === 1) goToSection(target);
      else {
        e.pos = Math.min(maxPos(), Math.max(0, target.top - readingY()));
        draw();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      // Escape closes the settings and gives the keys back to the prompter, even from a slider.
      if (event.key === 'Escape') {
        setPanel(null);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
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
        // Back to the top (RG, Oct 29, 2026: H, as well as Home).
        case 'h':
        case 'H':
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
          setPanel((p) => (p === 'help' ? null : 'help'));
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
    '--p-size': `${settings.styles.regular.fontSize}pt`,
    '--p-cue-size': `${settings.styles.curly.fontSize}pt`,
    '--p-spacing': settings.lineSpacing,
    '--p-margin': `${settings.margin}vw`,
    '--p-text': settings.styles.regular.color,
    '--p-bg': settings.styles.regular.background,
    '--p-line': `${settings.readingLine}vh`,
    '--p-marker': settings.markerSize / 100,
  } as CSSProperties;

  return (
    <div className={`prompter${controlsVisible ? '' : ' idle'}${settings.flipText ? ' flipped' : ''}`} style={style} aria-label={`Prompter for ${episode.title}`}>
      <div
        className="prompter-viewport"
        ref={viewport}
        onWheel={(event) => {
          moveBy(event.deltaY);
        }}
      >
        <div className="prompter-content" ref={content}>
          {lines.filter((line) => lineShows(line, settings)).map((line) => (
            <Line key={line.key} line={line} settings={settings} colors={colors} />
          ))}
        </div>
      </div>
      <div className="prompter-reading-line" aria-hidden="true">
        {/* Drawn as text, never as an emoji. */}
        <span>{'\u25B6\uFE0E'}</span>
        <span>{'\u25C0\uFE0E'}</span>
      </div>

      <div className="prompter-hud" role="status">
        <span>{hud.paused ? '❚❚ Paused' : hud.speed === 0 ? '■ Stopped' : hud.speed > 0 ? `▶ ${hud.speed}` : `◀ ${-hud.speed} backwards`}</span>
        {hud.section && <span>{hud.section}</span>}
        {(room.status !== 'connected' || !room.synced) && (
          <span className="prompter-offline">{lines.length > 1 ? 'Offline: showing the last copy. Cues aren’t reaching the show.' : 'Connecting…'}</span>
        )}
      </div>

      <div className="prompter-controls">
        <select
          aria-label="Go to section"
          value=""
          onChange={(event) => {
            const target = engine.current.markers.find((m) => m.kind === 'section' && m.sectionId === event.target.value);
            if (target) goToSection(target);
            // Back to the keys, so the arrows run the prompter again.
            event.target.blur();
          }}
        >
          <option value="">Go to section…</option>
          {lines.map((line) =>
            line.kind === 'section' ? (
              <option key={line.key} value={line.sectionId}>
                {line.label} · {line.slug || 'Untitled'}
              </option>
            ) : null,
          )}
        </select>
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
            <dt>H or Home</dt>
            <dd>Back to the top, stopped</dd>
            <dt>F</dt>
            <dd>Full screen</dd>
            <dt>S</dt>
            <dd>Settings</dd>
          </dl>
          <p>The Go to section list at the top jumps to any section. The mouse wheel nudges the text. Cues fire as they cross the reading line (the arrows at the side).</p>
          <button onClick={() => setPanel(null)}>Close</button>
        </div>
      )}
      {panel === 'settings' && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Cue({ line }: { line: PrompterCue }) {
  // A camera cue fires like a graphic's: the show app takes the camera (RG, Oct 30, 2026).
  return line.kind === 'camera' ? (
    <span className="p-cue camera" data-marker="cue" data-section={line.sectionId} data-element={line.cueId}>
      <span>TAKE {line.camera.toUpperCase()}</span>
    </span>
  ) : (
    <span className={`p-cue ${elementKind(line.element.type)}`} data-marker="cue" data-section={line.sectionId} data-element={line.element.id}>
      <span>{cueLabel(line.element).toUpperCase()}</span>
    </span>
  );
}

function Line({ line, settings, colors }: { line: PrompterLine; settings: PrompterSettings; colors: ReturnType<typeof talentColors> }) {
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
        // The break's line fires its cue, so the show app plays the show's break graphic (RG, Oct 29, 2026).
        <div className="p-break" data-key={line.key} data-marker="cue" data-section="" data-element={line.key} data-label="Commercial break">
          COMMERCIAL BREAK{line.seconds > 0 ? ` · ${formatDuration(line.seconds)}` : ''}
        </div>
      );
    case 'section':
      return (
        <div className="p-section" data-key={line.key} data-marker="section" data-section={line.sectionId} data-label={line.label}>
          {/* Just the number and the camera; the script's speaker markers say who reads (RG, Oct 29, 2026). */}
          {settings.showPageNumbers && <span className="p-label">{line.label}</span>}
          {settings.showStorySlugs && line.slug && <span className="p-slug">{line.slug.toUpperCase()}</span>}
          <span className="p-camera">{line.camera.toUpperCase()}</span>
        </div>
      );
    case 'crossTalk':
      return (
        // With the asterisks showing, as TSTV marks it (RG, Oct 29, 2026).
        <div className="p-cross-talk" data-key={line.key}>
          **CROSS TALK**
        </div>
      );
    case 'speaker':
      return (
        <div className="p-speaker-line" data-key={line.key}>
          {!settings.styles.curly.hide && (
            // In the color assigned to that speaker, not the curly brackets' colors (RG, Nov 4, 2026).
            <span className="p-speaker" style={{ ...textLook(settings.styles.curly, false), color: colorForTalent(line.name, colors) }}>
              {line.name}
            </span>
          )}
          {/* The cues at the top of this reader's part, on the line with their name (RG, Nov 4, 2026). */}
          {line.cues.map((cue) => (
            <Cue key={cue.key} line={cue} />
          ))}
        </div>
      );
    case 'cue':
    case 'camera':
      return (
        <div data-key={line.key}>
          <Cue line={line} />
        </div>
      );
    case 'text':
      return (
        <p className="p-text" data-key={line.key}>
          {line.text.trim()
            ? scriptRuns(line.text)
                .filter((run) => !settings.styles[run.style].hide)
                .map((run, i) => (
                  <span key={i} style={textLook(settings.styles[run.style], run.style !== 'regular')}>
                    {run.text}
                  </span>
                ))
            : line.text || ' '}
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
  const number = (key: 'lineSpacing' | 'margin' | 'readingLine' | 'markerSize', label: string, min: number, max: number, step: number, unit = '') => (
    <label>
      {label}
      <span className="row">
        <input type="range" min={min} max={max} step={step} value={settings[key]} onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })} />
        <output>
          {settings[key]}
          {unit}
        </output>
      </span>
    </label>
  );
  const close = () => {
    // Give the keys back to the prompter, so the arrows don't keep moving a slider.
    (document.activeElement as HTMLElement | null)?.blur();
    onClose();
  };
  return (
    <div className="prompter-panel settings-panel" role="dialog" aria-label="Prompter settings">
      <h2>Prompter settings</h2>
      <p className="small">Saved on this computer.</p>
      <table className="prompter-looks">
        <thead>
          <tr>
            <th />
            <th>Font Size</th>
            <th>Text Color</th>
            <th>Background Color</th>
            <th>Bold</th>
            <th>Italic</th>
            <th>Hide</th>
          </tr>
        </thead>
        <tbody>
          {TEXT_STYLES.map(({ style, label }) => {
            const look = settings.styles[style];
            const change = (patch: Partial<TextLook>) => onChange({ ...settings, styles: { ...settings.styles, [style]: { ...look, ...patch } } });
            const colorMenu = (name: string, value: string, key: 'color' | 'background') => (
              <select aria-label={`${label} ${name}`} value={value} onChange={(e) => change({ [key]: e.target.value })}>
                {COLORS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            );
            return (
              <tr key={style}>
                <th scope="row">{label}</th>
                <td>
                  <input aria-label={`${label} font size`} type="number" min={8} max={200} value={look.fontSize} onChange={(e) => e.target.value && change({ fontSize: Number(e.target.value) })} />
                </td>
                <td>{colorMenu('text color', look.color, 'color')}</td>
                <td>{colorMenu('background color', look.background, 'background')}</td>
                <td>
                  <input aria-label={`${label} bold`} type="checkbox" checked={look.bold} onChange={(e) => change({ bold: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={`${label} italic`} type="checkbox" checked={look.italic} onChange={(e) => change({ italic: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={`${label} hide`} type="checkbox" checked={look.hide} disabled={style === 'regular'} onChange={(e) => change({ hide: e.target.checked })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <label className="row">
        <input type="checkbox" checked={settings.showPageNumbers} onChange={(e) => onChange({ ...settings, showPageNumbers: e.target.checked })} />
        Show page numbers
      </label>
      <label className="row">
        <input type="checkbox" checked={settings.showStorySlugs} onChange={(e) => onChange({ ...settings, showStorySlugs: e.target.checked })} />
        Show story slugs
      </label>
      <label className="row">
        <input type="checkbox" checked={settings.flipText} onChange={(e) => onChange({ ...settings, flipText: e.target.checked })} />
        Flip text
      </label>
      {number('lineSpacing', 'Line spacing', 1, 2.2, 0.05)}
      {number('margin', 'Side margins (hidden by the hood)', 0, 30, 1, '%')}
      {number('readingLine', 'Reading line, from the top', 10, 70, 1, '%')}
      {number('markerSize', 'Marker Size', 30, 250, 5, '%')}
      <div className="row">
        <button onClick={() => onChange(DEFAULT_PROMPTER_SETTINGS)}>Back to the defaults</button>
        <button onClick={close}>Close (Esc)</button>
      </div>
    </div>
  );
}
