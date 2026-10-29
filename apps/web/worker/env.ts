import type { EpisodeRoom } from './room.ts';

/** What the Worker gets from Cloudflare: the database, episode rooms, website files and settings. */
export interface Env {
  DB: D1Database;
  EpisodeRoom: DurableObjectNamespace<EpisodeRoom>;
  ASSETS: Fetcher;
  /** From Google Cloud: the OAuth client for "Sign in with Google". */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated emails that are always allowed in and are admins (the TD). */
  ADMIN_EMAILS?: string;
  /** For the admin's Usage page: the Cloudflare account and a read-only analytics token. */
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  /** "true" only in local development, and only honoured on localhost. */
  DEV_LOGIN?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  isAdmin: boolean;
}
