// One section's script: a shared text box, a word counter and how long a typical anchor takes to read it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  computeRundown,
  countWords,
  elementLabel,
  EVERYONE_TALENT,
  formatDuration,
  noteScriptEdit,
  READING_SPEED,
  readScriptInfo,
  readTimeRange,
  scriptsOf,
  scriptText,
  talentColors,
  type SectionRow,
  type ShowSettings,
} from '@tstv/shared';
import { useLoad, type User } from '../lib/api.ts';
import { Link } from '../lib/router.tsx';
import { timeAgo } from '../lib/format.ts';
import { useEpisodeDoc } from '../rundown/useEpisodeDoc.ts';
import { useSharedTextarea } from '../rundown/useSharedTextarea.ts';
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
  const text = useScriptText(room.doc, sectionId);
  const me = { id: user.id, name: user.name };

  // Record who edited, at most every few seconds rather than on every keystroke.
  const lastNoted = useRef(0);
  const onLocalEdit = () => {
    if (!room.doc || Date.now() - lastNoted.current < 5000) return;
    lastNoted.current = Date.now();
    noteScriptEdit(room.doc, sectionId, me);
  };
  const box = useSharedTextarea(text, onLocalEdit);
  const info = useScriptInfo(room.doc, sectionId);

  const words = countWords(box.value);
  const { fastestSeconds, slowestSeconds } = readTimeRange(words);
  const readTime = fastestSeconds === slowestSeconds ? formatDuration(fastestSeconds) : `${formatDuration(fastestSeconds)}–${formatDuration(slowestSeconds)}`;
  const colors = talentColors(room.talent, show.settings.talent);
  const talentColor = section && colors.find((t) => t.name.toLowerCase() === section.talent.trim().toLowerCase())?.color;
  const camera = section ? section.camera || show.settings.defaultCamera : '';
  const everyone = section?.talent === EVERYONE_TALENT;
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
              <strong>
                {talentColor && <span className="dot inline" style={{ background: talentColor }} />}{' '}
                {everyone ? 'Everyone (cross talk)' : section.talent || 'Not picked yet'}
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
          {text ? (
            <textarea
              ref={box.ref}
              className="script"
              aria-label={`Script for ${current.label}`}
              placeholder="Type the script for this section…"
              readOnly={readOnly}
              spellCheck
              onFocus={() => room.setFocus(`${sectionId}:script`)}
              onBlur={() => room.setFocus(null)}
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
function useScriptText(doc: Y.Doc | null, sectionId: string): Y.Text | undefined {
  const [text, setText] = useState<Y.Text | undefined>(undefined);
  useEffect(() => {
    if (!doc) return;
    const update = () => setText(scriptText(doc, sectionId));
    update();
    scriptsOf(doc).observe(update);
    return () => scriptsOf(doc).unobserve(update);
  }, [doc, sectionId]);
  return text;
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
