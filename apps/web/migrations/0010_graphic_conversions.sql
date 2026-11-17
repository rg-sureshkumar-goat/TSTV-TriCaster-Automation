-- Nov 17, 2026 (RG): L3, OTSL and OTSR graphics not in the right format (1080p, 29.97, ProRes 4444 with alpha,
-- QuickTime) are converted on GitHub's free machines after they're uploaded, and the converted copy replaces
-- the original in Google Drive and on the graphic.

-- A conversion under way: job_id is what the GitHub machine asks about; drive_file_id the original.
CREATE TABLE graphic_conversions (
  job_id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- What was wrong with the file, once it was converted (JSON list of plain-language reasons).
ALTER TABLE episode_graphics ADD COLUMN fixes TEXT;
-- Why it couldn't be converted, if it couldn't.
ALTER TABLE episode_graphics ADD COLUMN convert_error TEXT;
