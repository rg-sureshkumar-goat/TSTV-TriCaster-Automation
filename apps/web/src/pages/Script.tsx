// One section's script: a shared script editor with cue chips and speaker tags, a word counter and how
// long a typical anchor takes to read it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  colorForTalent,
  computeRundown,
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
  talentColors,
  type Element,
  type SectionRow,
  type ShowSettings,
} from '@tstv/shared';
import { useLoad, type User } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { timeAgo } from '../lib/format.ts';
import { colorFor, useEpisodeDoc } from '../rundown/useEpisodeDoc.ts';
import { ScriptWriter } from '../script/ScriptWriter.tsx';
import { ConnectionBadge, PresenceList } from '../components/RoomStatus.tsx';
import type { EpisodeListItem } from './Show.tsx';

interface EpisodeData {
  episode: EpisodeListItem;
  show: { id: string; name: string; settings: ShowSettings };
}

export function ScriptPage({ episodeId, sectionId, user }: { episodeId: string; sectionId: string; user: User }) {
  const { data, error, reload } = useLoad<EpisodeData>(`/episodes/${episodeId}`);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  return <ScriptView data={data} sectionId={sectionId} user={user} reload={reload} />;
}

function ScriptView({ data, sectionId, user, reload }: { data: EpisodeData; sectionId: string; user: User; reload: () => void }) {
  const { episode, show } = data;
  const readOnly = episode.status === 'archived';
  const room = useEpisodeDoc(episode.id, user, reload);
  const timing = useMemo(() => computeRundown(room.rows, show.settings.targetSeconds), [room.rows, show.settings.targetSeconds]);
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
    <div className="page">
      <p className="crumbs">
        <Link to="/">Shows</Link> › <Link to={`/shows/${show.id}`}>{show.name}</Link> › <Link to={`/episodes/${episode.id}`}>{episode.title}</Link> ›
      </p>
      {!room.synced ? (
        <p className="muted">Loading the script…</p>
      ) : !section ? (
        <p className="error">This section isn’t in the rundown any more.</p>
      ) : (
        <>
          <div className="script-head">
            <h1>
              {current.label} · {section.slug || 'Untitled'} {readOnly && <span className="badge">Archived · read-only</span>}
            </h1>
            <div className="episode-actions">
              <ConnectionBadge status={room.status} synced={room.synced} />
              <PresenceList others={here} />
            </div>
          </div>
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
              <strong>Cross talk.</strong> Everyone talks and there’s no formal script, so the prompter will just say CROSS TALK. With no script to time,
              type this section’s length in the rundown’s Est. column.
            </p>
          )}
          {section.talent.length > 1 && (
            <p className="muted small">Several people read this section. Start each person’s part with their name in curly brackets on its own line, like {'{'}{section.talent[0]}{'}'}.</p>
          )}
          <p className="script-meta">
            {section.type && <span>Type: {section.type}</span>}
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

          <div className="script-foot">
            <span className="muted small">
              {info.updatedBy
                ? `Edited by ${info.editors.map((p) => p.name).join(', ')} · last edit by ${info.updatedBy.name} ${timeAgo(info.updatedAt)}`
                : 'Nobody has written this script yet.'}
            </span>
            <span className="buttons">
              {position > 0 && <Link to={link(position - 1)}>← {sections[position - 1].label}</Link>}{' '}
              <Link to={`/episodes/${episode.id}`}>Back to the rundown</Link>{' '}
              {position < sections.length - 1 && <Link to={link(position + 1)}>{sections[position + 1].label} →</Link>}
            </span>
          </div>
        </>
      )}
    </div>
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
