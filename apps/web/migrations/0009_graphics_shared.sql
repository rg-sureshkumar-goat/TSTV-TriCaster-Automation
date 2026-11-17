-- Nov 17, 2026 (RG): Chrome can't play Apple ProRes, so a graphic's preview can show Google Drive's own
-- player instead, as Drive does (without the see-through parts). That needs the file shared as "anyone
-- with the link can view"; only people signed in to the website see the link. 1 once it's shared.
ALTER TABLE episode_graphics ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
