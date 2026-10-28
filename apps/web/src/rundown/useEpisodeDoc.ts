// Connects the page to an episode's live room: the shared rundown, who else is here, and the
// connection status. Changes anyone makes show up for everyone within about a second.
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { readRows, rowsOf, type Row } from '@tstv/shared';
import type { User } from '../lib/api.ts';

export interface Presence {
  clientId: number;
  name: string;
  color: string;
  /** The cell they're editing, as "rowId:field". */
  focus: string | null;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const PRESENCE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];

function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

export function useEpisodeDoc(episodeId: string, user: User, onArchivedChange?: () => void) {
  const [room, setRoom] = useState<{ doc: Y.Doc; provider: YProvider } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [others, setOthers] = useState<Presence[]>([]);
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
    const onSync = (isSynced: boolean) => {
      setSynced(isSynced);
      if (isSynced) updateRows();
    };
    const onStatus = ({ status: s }: { status: ConnectionStatus }) => setStatus(s);
    const onAwareness = () => {
      const list: Presence[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID || !state?.name) return;
        list.push({ clientId, name: String(state.name), color: String(state.color), focus: (state.focus as string | null) ?? null });
      });
      setOthers(list);
    };
    const onCustom = (message: string) => {
      try {
        if ((JSON.parse(message) as { type?: string }).type === 'archived') archivedRef.current?.();
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
      provider.off('sync', onSync);
      provider.off('status', onStatus);
      provider.off('custom-message', onCustom);
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      doc.destroy();
    };
  }, [episodeId, user.id, user.name]);

  const setFocus = (focus: string | null) => room?.provider.awareness.setLocalStateField('focus', focus);

  return { doc: room?.doc ?? null, rows, synced: synced && room !== null, status, others, setFocus };
}
