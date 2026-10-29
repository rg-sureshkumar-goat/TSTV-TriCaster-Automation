// Connects the page to an episode's live room: the shared rundown, who else is here, and the
// connection status. Changes anyone makes show up for everyone within about a second.
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { cuedElementIds, mediaOf, observeBroadcast, readBroadcast, readEpisodeTalent, readMedia, readRows, rowsOf, scriptBodiesOf, scriptWordCounts, type Broadcast, type EpisodeTalent, type MediaStatus, type Row } from '@tstv/shared';
import type { User } from '../lib/api.ts';

export interface Presence {
  clientId: number;
  name: string;
  color: string;
  /** The cell they're editing, as "rowId:field". */
  focus: string | null;
  /** Set when this is a prompter: where it is and how fast it's going. */
  prompter?: PrompterStatus;
  /** Set when this is the show app (Phase 4). */
  app?: ShowAppStatus;
}

/** What the show app tells everyone. */
export interface ShowAppStatus {
  /** Practicing against the simulator, or running the real TC1. */
  mode: 'simulator' | 'live';
  switcherConnected: boolean;
  paused: boolean;
}

/** What a prompter tells everyone a few times a second. */
export interface PrompterStatus {
  sectionId: string | null;
  label: string;
  /** Arrow-key speed steps; below zero runs backwards. */
  speed: number;
  paused: boolean;
}

/** A section start or cue chip that just crossed the prompter's reading line. */
export interface CueEvent {
  kind: 'section' | 'cue';
  sectionId: string;
  elementId?: string;
  at: number;
  from: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const PRESENCE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];

/** Each person's color for their initials, cell outlines and cursor. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

export function useEpisodeDoc(episodeId: string, user: User, onArchivedChange?: () => void) {
  const [room, setRoom] = useState<{ doc: Y.Doc; provider: YProvider } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scriptWords, setScriptWords] = useState<Record<string, number>>({});
  const [cued, setCued] = useState<Set<string>>(() => new Set());
  const [media, setMedia] = useState<Record<string, MediaStatus>>({});
  const [broadcast, setBroadcast] = useState<Broadcast>({ live: false, startedAt: null, endedAt: null, by: null });
  const [talent, setTalent] = useState<EpisodeTalent[]>([]);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [others, setOthers] = useState<Presence[]>([]);
  const [lastCue, setLastCue] = useState<CueEvent | null>(null);
  const archivedRef = useRef(onArchivedChange);
  archivedRef.current = onArchivedChange;

  useEffect(() => {
    // A fresh document for every connection, so nothing is reused after it's been closed.
    const doc = new Y.Doc();
    const provider = new YProvider(location.host, episodeId, doc, {
      party: 'episode-room',
      protocol: location.protocol === 'https:' ? 'wss' : 'ws',
    });
    provider.awareness.setLocalState({ name: user.name, color: colorFor(user.id), focus: null });
    setRoom({ doc, provider });
    setSynced(false);

    const updateRows = () => setRows(readRows(doc));
    rowsOf(doc).observeDeep(updateRows);
    // Script word counts drive the rundown's estimated lengths; cue chips show which graphics are in a script.
    const updateWords = () => {
      setScriptWords(scriptWordCounts(doc));
      setCued(cuedElementIds(doc));
    };
    scriptBodiesOf(doc).observeDeep(updateWords);
    const updateTalent = () => setTalent(readEpisodeTalent(doc));
    doc.getArray('talent').observe(updateTalent);
    const updateMedia = () => setMedia(readMedia(doc));
    mediaOf(doc).observe(updateMedia);
    const updateBroadcast = () => setBroadcast(readBroadcast(doc));
    const stopBroadcast = observeBroadcast(doc, updateBroadcast);
    const onSync = (isSynced: boolean) => {
      setSynced(isSynced);
      if (isSynced) {
        updateRows();
        updateWords();
        updateTalent();
        updateMedia();
        updateBroadcast();
      }
    };
    const onStatus = ({ status: s }: { status: ConnectionStatus }) => setStatus(s);
    const onAwareness = () => {
      const list: Presence[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID || !state?.name) return;
        list.push({
          clientId,
          name: String(state.name),
          color: String(state.color),
          focus: (state.focus as string | null) ?? null,
          prompter: (state.prompter as PrompterStatus | undefined) ?? undefined,
          app: (state.app as ShowAppStatus | undefined) ?? undefined,
        });
      });
      setOthers(list);
    };
    const onCustom = (message: string) => {
      try {
        // Archived or deleted by someone else: reload the page's details (a deleted one then says so).
        const event = JSON.parse(message) as { type?: string } & CueEvent;
        if (event.type === 'archived' || event.type === 'deleted') archivedRef.current?.();
        if (event.type === 'cue') setLastCue({ kind: event.kind, sectionId: event.sectionId, elementId: event.elementId, at: event.at, from: event.from });
      } catch {
        // Not a message for us.
      }
    };
    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('custom-message', onCustom);
    provider.awareness.on('change', onAwareness);

    return () => {
      rowsOf(doc).unobserveDeep(updateRows);
      scriptBodiesOf(doc).unobserveDeep(updateWords);
      doc.getArray('talent').unobserve(updateTalent);
      mediaOf(doc).unobserve(updateMedia);
      stopBroadcast();
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      provider.off('custom-message', onCustom);
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      doc.destroy();
    };
  }, [episodeId, user.id, user.name]);

  const setFocus = (focus: string | null) => room?.provider.awareness.setLocalStateField('focus', focus);

  return { doc: room?.doc ?? null, provider: room?.provider ?? null, rows, scriptWords, cued, media, broadcast, talent, synced: synced && room !== null, status, others, setFocus, lastCue };
}

/** An episode's live room, as the rundown page and its script window see it. */
export type EpisodeRoomView = ReturnType<typeof useEpisodeDoc>;
