// One section's script, in a window over the rundown (RG, Oct 29, 2026): a shared script editor with cue
// chips and speaker tags, a word counter and how long a typical anchor takes to read it. It uses the
// rundown page's live connection to the episode room.
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  colorForTalent,
  countWords,
  elementLabel,
  formatDuration,
  isCrossTalk,
  noteScriptEdit,
  READING_SPEED,
  readScriptInfo,
  readTimeRange,
  scriptBodiesOf,
  scriptBody,
  scriptCueCounts,
  scriptPlainText,
  speakerTag,
  talentColors,
  type Element,
  type RundownTiming,
  type SectionRow,
  type ShowSettings,
} from '@tstv/shared';
import type { User } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { timeAgo } from '../lib/format.ts';
import { colorFor, type EpisodeRoomView } from '../rundown/useEpisodeDoc.ts';
import { ScriptWriter } from '../script/ScriptWriter.tsx';
import { PresenceList } from '../components/RoomStatus.tsx';
import type { EpisodeListItem } from './Show.tsx';

interface Props {
  episode: EpisodeListItem;
  show: { id: string; name: string; settings: ShowSettings };
  room: EpisodeRoomView;
  timing: RundownTiming;
  sectionId: string;
  user: User;
  onClose: () => void;
}

export function ScriptWindow({ episode, show, room, timing, sectionId, user, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const readOnly = episode.status === 'archived';
  const sections = timing.rows.filter((c) => c.row.kind === 'section');
  const position = sections.findIndex((c) => c.row.id === sectionId);
  const current = sections[position];
  const section = current?.row as SectionRow | undefined;
  const me = { id: user.id, name: user.name };
  const body = useScriptBody(room.doc, sectionId);
  const lastNoted = useRef(0);
  const { text, cueCounts } = useScriptContent(body, () => {
    // Record who edited, at most every few seconds rather than on every keystroke.
    if (!room.doc || Date.now() - lastNoted.current < 5000) return;
    lastNoted.current = Date.now();
    noteScriptEdit(room.doc, sectionId, me);
  });
  const info = useScriptInfo(room.doc, sectionId);
  const elements = useMemo(() => new Map<string, Element>(room.rows.flatMap((r) => (r.kind === 'section' ? r.elements.map((e) => [e.id, e] as const) : []))), [room.rows]);

  const words = countWords(text);
  const { fastestSeconds, slowestSeconds } = readTimeRange(words);
  const readTime = fastestSeconds === slowestSeconds ? formatDuration(fastestSeconds) : `${formatDuration(fastestSeconds)}–${formatDuration(slowestSeconds)}`;
  const colors = useMemo(() => talentColors(room.talent, show.settings.talent), [room.talent, show.settings.talent]);
  const speakers = useMemo(() => new Map(colors.map((t) => [t.name.toLowerCase(), t.color] as const)), [colors]);
  const camera = section ? section.camera || show.settings.defaultCamera : '';
  const here = room.others.filter((o) => o.focus === `${sectionId}:script`);
  const link = (i: number) => `/episodes/${episode.id}/sections/${sections[i].row.id}`;

  return (
    <dialog
      ref={dialog}
      className="script-window"
      aria-labelledby="script-window-title"
      // Escape closes the window.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The script editor keeps Escape to itself, so the window listens for it there too. With a menu
      // open, Escape closes just the menu.
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.nativeEvent.defaultPrevented && (e.target as HTMLElement).closest('.script-editor') && !dialog.current?.querySelector('.popover')) onClose();
      }}
      // So does a click outside it, but not a text selection that ends outside it.
      onMouseDown={(e) => (pressedOutside.current = e.target === e.currentTarget)}
      onClick={(e) => pressedOutside.current && e.target === e.currentTarget && onClose()}
    >
      <div className="script-window-inner">
        <div className="script-head">
          <h2 id="script-window-title">
            {current ? `${current.label} · ${section?.slug || 'Untitled'}` : 'Script'} {readOnly && <span className="badge">Archived · read-only</span>}
          </h2>
          <PresenceList others={here} />
          <button className="close-button" onClick={onClose} aria-label="Close the script" title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="script-window-body">
          {!room.synced ? (
            <p className="muted">Loading the script…</p>
          ) : !section ? (
            <p className="error">This section isn’t in the rundown any more.</p>
          ) : (
            <>
              <div className="read-cue" role="note" aria-label="Who reads and which camera">
                <div>
                  <span className="muted small">Read by</span>
                  <strong className="read-by">
                    {section.talent.length === 0
                      ? 'Not picked yet'
                      : section.talent.map((name) => {
                          const color = colorForTalent(name, colors);
                          return (
                            <span key={name}>
                              {color && <span className="dot inline" style={{ background: color }} />} {name}
                            </span>
                          );
                        })}
                  </strong>
                </div>
                <div>
                  <span className="muted small">Look at</span>
                  <strong>{camera || 'Not picked yet'}</strong>
                </div>
                {section.headline && (
                  <div>
                    <span className="muted small">Headline</span>
                    <strong>{section.headline}</strong>
                  </div>
                )}
              </div>
              {isCrossTalk(section.talent) && (
                <p className="cross-talk-note" role="note">
                  <strong>Cross talk.</strong> Everyone talks and there’s no formal script, so the prompter will just say CROSS TALK. With no script to
                  time, type this section’s length in the rundown’s Est. column.
                </p>
              )}
              {section.talent.length > 1 && (
                <p className="muted small">Several people read this section. Each person’s part starts with their name in curly brackets on its own line, like {speakerTag(section.talent[0])}.</p>
              )}
              <p className="script-meta">
                {section.type && <span>Story type: {section.type}</span>}
                {section.writer && <span>Writer: {section.writer}</span>}
                {section.elements.length > 0 && <span>Graphics: {section.elements.map(elementLabel).join(', ')}</span>}
              </p>

              <div className="script-stats" aria-live="polite">
                <span>
                  <strong>{words}</strong> {words === 1 ? 'word' : 'words'}
                </span>
                <span title={`A typical anchor reads ${READING_SPEED.minWordsPerMinute} to ${READING_SPEED.maxWordsPerMinute} words a minute`}>
                  Read time about <strong>{readTime}</strong>{' '}
                  <span className="muted small">
                    at {READING_SPEED.minWordsPerMinute}–{READING_SPEED.maxWordsPerMinute} words a minute
                  </span>
                </span>
              </div>
              {body && room.doc ? (
                <ScriptWriter
                  body={body}
                  provider={room.provider}
                  doc={room.doc}
                  section={section}
                  label={current.label}
                  me={{ ...me, color: colorFor(user.id) }}
                  readOnly={readOnly}
                  elements={elements}
                  speakers={speakers}
                  cueCounts={cueCounts}
                  permanent={show.settings.permanentGraphics}
                  onFocusChange={(focused) => room.setFocus(focused ? `${sectionId}:script` : null)}
                />
              ) : (
                <p className="muted">Setting up this script…</p>
              )}
            </>
          )}
        </div>

        <div className="script-foot">
          <span className="muted small">
            {info.updatedBy
              ? `Edited by ${info.editors.map((p) => p.name).join(', ')} · last edit by ${info.updatedBy.name} ${timeAgo(info.updatedAt)}`
              : 'Nobody has written this script yet.'}
          </span>
          <span className="buttons">
            {position > 0 && (
              <Link to={link(position - 1)} keepScroll>
                ← {sections[position - 1].label}
              </Link>
            )}{' '}
            {position >= 0 && position < sections.length - 1 && (
              <Link to={link(position + 1)} keepScroll>
                {sections[position + 1].label} →
              </Link>
            )}
          </span>
        </div>
      </div>
    </dialog>
  );
}

/** The section's shared script, once the episode room has created it. */
function useScriptBody(doc: Y.Doc | null, sectionId: string): Y.XmlFragment | undefined {
  const [body, setBody] = useState<Y.XmlFragment | undefined>(undefined);
  useEffect(() => {
    if (!doc) return;
    const update = () => setBody(scriptBody(doc, sectionId));
    update();
    scriptBodiesOf(doc).observe(update);
    return () => scriptBodiesOf(doc).unobserve(update);
  }, [doc, sectionId]);
  return body;
}

/**
 * The script's words and cue chips, kept up to date as anyone types. onLocalEdit runs when your own typing
 * changes them (not when the editor merely connects).
 */
function useScriptContent(body: Y.XmlFragment | undefined, onLocalEdit: () => void) {
  const [content, setContent] = useState({ text: '', cueCounts: new Map<string, number>() });
  const editRef = useRef(onLocalEdit);
  editRef.current = onLocalEdit;
  useEffect(() => {
    if (!body) return;
    let last = '';
    const update = (_events?: unknown, transaction?: Y.Transaction) => {
      const next = { text: scriptPlainText(body), cueCounts: scriptCueCounts(body) };
      const signature = `${next.text}\u0000${[...next.cueCounts].join()}`;
      if (transaction?.local && signature !== last) editRef.current();
      last = signature;
      setContent(next);
    };
    update();
    body.observeDeep(update);
    return () => body.unobserveDeep(update);
  }, [body]);
  return content;
}

function useScriptInfo(doc: Y.Doc | null, sectionId: string) {
  const [info, setInfo] = useState(() => (doc ? readScriptInfo(doc, sectionId) : { editors: [] }));
  useEffect(() => {
    if (!doc) return;
    const map = doc.getMap('scriptInfo');
    const update = () => setInfo(readScriptInfo(doc, sectionId));
    update();
    map.observe(update);
    return () => map.unobserve(update);
  }, [doc, sectionId]);
  return info;
}
