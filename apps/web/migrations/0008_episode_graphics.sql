-- Nov 17, 2026 (RG): the show graphics in Google Drive, since UT Austin's Box doesn't allow the website
-- ("Disabled by Administrator"). The Drive keeps a tidy layout: TSTV Rundowns › show › Permanent (the show
-- profile: permanent graphics, green screen, transitions, tease music) and one folder per episode, with the
-- graphics attached to its rundown. An episode's folder is deleted two weeks after its air date.
DROP TABLE IF EXISTS box_link;

-- 1 once the Drive's top folder is named TSTV Rundowns and the profiles are in their Permanent folders.
ALTER TABLE drive_link ADD COLUMN layout INTEGER NOT NULL DEFAULT 0;

-- Each show's Permanent folder, inside its show folder.
ALTER TABLE show_drive_folders ADD COLUMN permanent_folder_id TEXT;

-- Each episode's folder, inside its show's folder.
CREATE TABLE episode_drive_folders (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The file attached to each graphic in a rundown (element_id is the graphic's id in the rundown).
CREATE TABLE episode_graphics (
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  email TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  md5 TEXT,
  uploaded_by TEXT,
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (episode_id, element_id)
);

-- When the episode's graphics folder was deleted, two weeks after it aired.
ALTER TABLE episodes ADD COLUMN graphics_deleted_at INTEGER;
