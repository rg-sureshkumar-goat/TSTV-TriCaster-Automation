-- People who can sign in. Google provides the name and email.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  picture TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

-- Emails the TD has invited who haven't signed in yet.
CREATE TABLE invites (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  invited_by TEXT,
  created_at INTEGER NOT NULL
);

-- Signed-in browsers. Only a hash of each session token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE shows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Each episode's rundown and scripts live in its episode room (a Durable Object). This table keeps
-- the list, the air date and time, archive status, and a summary and search text the room updates.
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES shows(id),
  title TEXT NOT NULL,
  air_date TEXT,
  air_time TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  search_text TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX episodes_show ON episodes(show_id, air_date DESC);
