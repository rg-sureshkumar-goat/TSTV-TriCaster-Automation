// An episode room: one Durable Object per episode, holding the episode's shared rundown (and, from
// Phase 2, its scripts) as a Yjs document. Everyone editing the episode connects here and sees each
// other's changes live. It saves itself every few seconds and sleeps when nobody is typing.
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import type { Connection, ConnectionContext } from 'partyserver';
import { allScriptText, computeRundown, ensureScripts, scriptWordCounts, sectionSecondsFrom, initEpisode, readRows, rowsOf, type Person } from '@tstv/shared';
import type { Env } from './env.ts';

interface ConnectionInfo {
  user?: Person;
  readOnly?: boolean;
}

/** Documents are saved in pieces under this size, well below Cloudflare's 2 MB row limit. */
const CHUNK_BYTES = 512 * 1024;

export class EpisodeRoom extends YServer<Env> {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 };

  private archived = false;

  private get episodeId(): string {
    return this.name;
  }

  async onLoad(): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS document_chunks (part INTEGER PRIMARY KEY, content BLOB NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS room_settings (key TEXT PRIMARY KEY, value TEXT)');
    this.archived = sql.exec<{ value: string }>("SELECT value FROM room_settings WHERE key = 'archived'").toArray()[0]?.value === '1';

    const chunks = sql.exec<{ content: ArrayBuffer }>('SELECT content FROM document_chunks ORDER BY part').toArray();
    if (chunks.length > 0) {
      const total = chunks.reduce((n, c) => n + c.content.byteLength, 0);
      const update = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        update.set(new Uint8Array(c.content), offset);
        offset += c.content.byteLength;
      }
      Y.applyUpdate(this.document, update);
      this.watchScripts();
      return;
    }
    // A brand-new episode: start it with block A and one section, credited to whoever created it.
    const creator = await this.env.DB.prepare(
      'SELECT u.id, u.name FROM episodes e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?',
    )
      .bind(this.episodeId)
      .first<{ id: string | null; name: string | null }>();
    initEpisode(this.document, { id: creator?.id ?? 'system', name: creator?.name ?? 'TSTV' });
    this.watchScripts();
  }

  /** Every section gets its script here, in one place, as soon as the section exists. */
  private watchScripts(): void {
    ensureScripts(this.document);
    rowsOf(this.document).observeDeep(() => ensureScripts(this.document));
  }

  async onSave(): Promise<void> {
    const update = Y.encodeStateAsUpdate(this.document);
    this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      sql.exec('DELETE FROM document_chunks');
      for (let part = 0, offset = 0; offset < update.length; part++, offset += CHUNK_BYTES) {
        const piece = update.slice(offset, offset + CHUNK_BYTES);
        sql.exec('INSERT INTO document_chunks (part, content) VALUES (?, ?)', part, piece.buffer);
      }
    });
    await this.saveSummary();
  }

  /** Keeps the episode list's summary and the archive search text up to date. */
  private async saveSummary(): Promise<void> {
    const rows = readRows(this.document);
    const timing = computeRundown(rows, 0, sectionSecondsFrom(scriptWordCounts(this.document)));
    const sections = rows.filter((r) => r.kind === 'section');
    const searchText = rows
      .map((r) => (r.kind === 'block' ? r.title : [r.slug, r.type, r.writer, ...r.talent, r.headline, r.notes, r.assignGraphics, ...r.elements.map((e) => `${e.type} ${e.name}`)].join(' ')))
      .join(' ')
      .concat(allScriptText(this.document))
      .replace(/\s+/g, ' ')
      .trim();
    const summary = JSON.stringify({ sections: sections.length, estSeconds: timing.totalSeconds });
    await this.env.DB.prepare('UPDATE episodes SET summary = ?, search_text = ?, updated_at = ? WHERE id = ?')
      .bind(summary, searchText, Date.now(), this.episodeId)
      .run();
  }

  onConnect(connection: Connection, ctx: ConnectionContext): void {
    // The Worker checked sign-in before letting this connection through, and passes who it is.
    const header = ctx.request.headers.get('x-tstv-user');
    const user = header ? (JSON.parse(header) as Person) : undefined;
    const readOnly = ctx.request.headers.get('x-tstv-readonly') === '1';
    connection.setState((prev: ConnectionInfo | null) => ({ ...(prev ?? {}), user, readOnly }));
    super.onConnect(connection, ctx);
  }

  isReadOnly(connection: Connection): boolean {
    return this.archived || Boolean((connection.state as ConnectionInfo | null)?.readOnly);
  }

  /** Requests from the Worker only (never from browsers): archive or un-archive this episode. */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/archived')) {
      const { archived } = await request.json<{ archived: boolean }>();
      this.archived = archived;
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room_settings (key, value) VALUES ('archived', ?)", archived ? '1' : '0');
      // Tell every open page, so nobody keeps typing into an episode that just became read-only.
      this.broadcastCustomMessage(JSON.stringify({ type: 'archived', archived }));
      return Response.json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }
}
