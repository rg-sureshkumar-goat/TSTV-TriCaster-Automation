-- Nov 2, 2026: RiGster's show profiles. Each show's permanent graphics, green screen and tease music are
-- kept in a Google Drive (RG's for now, TSTV's later), in a RiGster folder with a folder per show, so any
-- laptop with RiGster gets them. The files go straight between RiGster and Google; this database keeps
-- only the Drive connection and which file is which.

-- The one Google Drive connected (by an admin). Its refresh token lets the website get short-lived access
-- to the files RiGster put there, and nothing else in that Drive.
CREATE TABLE drive_link (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  connected_by TEXT,
  connected_at INTEGER NOT NULL
);

-- Each show's folder in that Drive.
CREATE TABLE show_drive_folders (
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  PRIMARY KEY (show_id, email)
);

-- Each show's files: slot is "greenScreen", "music" or "permanent:<name>" (one of the show's permanent
-- graphics). email is the Drive account it's in: after a move to another account, RiGster uploads each
-- file again from a laptop that has it.
CREATE TABLE show_profile_files (
  show_id TEXT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  email TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  md5 TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (show_id, slot)
);
