// The show app's link to the website: it follows one episode, picked by pasting the episode's key (RG,
// Oct 29, 2026). It receives the live rundown and the prompter's cues, and reports which elements have
// files. The key lets it follow the episode, not edit it.
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { normalizeShowSettings, rowsOf, type ShowSettings } from '@tstv/shared';

export interface EpisodeInfo {
  id: string;
  title: string;
  airDate: string;
  airTime: string;
}

export interface ShowInfo {
  id: string;
  name: string;
  settings: ShowSettings;
}

/** A section start or cue chip crossing the prompter's reading line, as the episode room passes it on. */
export interface CueEvent {
  kind: 'section' | 'cue';
  sectionId: string;
  elementId?: string;
  /** When the room received it. */
  at: number;
}

export interface PrompterStatus {
  sectionId: string | null;
  label: string;
  speed: number;
  paused: boolean;
}

export class WebsiteLink extends EventEmitter {
  status: 'off' | 'connecting' | 'connected' | 'error' = 'off';
  error: string | null = null;
  episode: EpisodeInfo | null = null;
  show: ShowInfo | null = null;
  doc: Y.Doc | null = null;
  prompter: PrompterStatus | null = null;
  private provider: YProvider | null = null;

  async connect(siteUrl: string, key: string): Promise<void> {
    this.close();
    this.status = 'connecting';
    this.error = null;
    this.emit('change');
    try {
      const response = await fetch(`${siteUrl.replace(/\/+$/, '')}/api/app/episode`, { headers: { Authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(8000) });
      const data = (await response.json()) as { error?: string; episode: EpisodeInfo; show: ShowInfo };
      if (!response.ok) throw new Error(data.error ?? `The website answered ${response.status}.`);
      this.episode = data.episode;
      this.show = { ...data.show, settings: normalizeShowSettings(data.show.settings) };
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof TypeError || (e as Error).name === 'TimeoutError' ? `Couldn’t reach ${siteUrl}. Check the Wi-Fi.` : (e as Error).message;
      this.emit('change');
      return;
    }

    const url = new URL(siteUrl);
    const doc = new Y.Doc();
    this.doc = doc;
    const provider = new YProvider(url.host, this.episode.id, doc, {
      party: 'episode-room',
      protocol: url.protocol === 'https:' ? 'wss' : 'ws',
      params: { key: key.trim() },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    this.provider = provider;
    provider.awareness.setLocalState({ name: 'Show app', color: '#0f766e', focus: null });
    provider.on('sync', (synced: boolean) => {
      if (synced) {
        this.status = 'connected';
        this.emit('change');
        this.emit('rundown');
      }
    });
    provider.on('status', ({ status }: { status: string }) => {
      if (status !== 'connected' && this.status === 'connected') {
        this.status = 'connecting';
        this.emit('change');
      }
    });
    provider.on('custom-message', (message: string) => {
      try {
        const event = JSON.parse(message) as { type?: string } & CueEvent;
        if (event.type === 'cue') this.emit('cue', { kind: event.kind, sectionId: event.sectionId, elementId: event.elementId, at: event.at } satisfies CueEvent);
        if (event.type === 'deleted') {
          this.status = 'error';
          this.error = 'This episode was deleted on the website.';
          this.emit('change');
        }
      } catch {
        // Not for the show app.
      }
    });
    provider.awareness.on('change', () => {
      let found: PrompterStatus | null = null;
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId !== doc.clientID && state?.prompter) found = state.prompter as PrompterStatus;
      });
      this.prompter = found;
      this.emit('change');
    });
    rowsOf(doc).observeDeep(() => this.emit('rundown'));
    doc.getMap('media').observe(() => this.emit('rundown'));
  }

  /** Tells everyone (the rundown page) how the app is doing. */
  setAppStatus(status: { mode: 'simulator' | 'live'; switcherConnected: boolean; paused: boolean }): void {
    this.provider?.awareness.setLocalStateField('app', status);
  }

  /** Reports elements' files and clip lengths, which the room writes into the episode for the rundown. */
  sendMedia(items: Record<string, { file: string; seconds: number | null } | null>): void {
    if (this.status === 'connected') this.provider?.sendMessage(JSON.stringify({ type: 'media', items }));
  }

  close(): void {
    this.provider?.destroy();
    this.doc?.destroy();
    this.provider = null;
    this.doc = null;
    this.prompter = null;
    this.status = 'off';
  }
}
