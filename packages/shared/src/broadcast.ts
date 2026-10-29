// Going live (RG, Oct 29, 2026): the producer presses Start live broadcast on the episode's page when
// the show goes on air, and the show app's automation follows the prompter from then until End live
// broadcast. Before that, the app does only what the producer does by hand. Only the episode room writes
// this, when the website asks it to.
import * as Y from 'yjs';
import type { Person } from './rundown.ts';

export interface Broadcast {
  live: boolean;
  /** When the current (or last) broadcast started. */
  startedAt: number | null;
  endedAt: number | null;
  by: Person | null;
}

const NOT_LIVE: Broadcast = { live: false, startedAt: null, endedAt: null, by: null };

function broadcastOf(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('broadcast');
}

export function readBroadcast(doc: Y.Doc): Broadcast {
  const map = broadcastOf(doc);
  if (!map.has('live')) return NOT_LIVE;
  const number = (key: string) => (typeof map.get(key) === 'number' ? (map.get(key) as number) : null);
  return { live: map.get('live') === true, startedAt: number('startedAt'), endedAt: number('endedAt'), by: (map.get('by') as Person | undefined) ?? null };
}

/** Starts or ends the live broadcast. Returns false if it was already that way. */
export function setBroadcast(doc: Y.Doc, live: boolean, by: Person, now = Date.now()): boolean {
  const map = broadcastOf(doc);
  if (readBroadcast(doc).live === live) return false;
  doc.transact(() => {
    map.set('live', live);
    map.set('by', by);
    if (live) {
      map.set('startedAt', now);
      map.delete('endedAt');
    } else {
      map.set('endedAt', now);
    }
  });
  return true;
}

/** Called for every change to the broadcast. */
export function observeBroadcast(doc: Y.Doc, listener: () => void): () => void {
  const map = broadcastOf(doc);
  map.observe(listener);
  return () => map.unobserve(listener);
}
