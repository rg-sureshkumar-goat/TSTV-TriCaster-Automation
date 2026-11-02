-- Nov 2, 2026: each show's rundown template. It's kept as a special episode of the show (so it's edited
-- with the same rundown and script editor, live), hidden from the episode lists and search. New rundowns
-- for the show start as a copy of it (see packages/shared/src/template.ts).
ALTER TABLE episodes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
CREATE INDEX episodes_template ON episodes(show_id, is_template);
