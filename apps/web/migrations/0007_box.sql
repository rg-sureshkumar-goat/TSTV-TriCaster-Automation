-- Nov 17, 2026: the show graphics in Box (RG: UT Austin's Box first, Google Drive if UT doesn't allow it).
-- Step 1 connects the one Box account the website uses; the folders come next. Box gives a new refresh
-- token each time one is used, so the latest is kept here, with the hour's access it came with.
CREATE TABLE box_link (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  login TEXT NOT NULL,
  name TEXT,
  enterprise TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_until INTEGER NOT NULL,
  root_folder_id TEXT NOT NULL,
  connected_by TEXT,
  connected_at INTEGER NOT NULL
);
