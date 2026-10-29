-- Oct 29, 2026: each episode's key for the show app. Pasting it into the app lets that app follow the
-- episode's rundown and cues; making a new key cuts off the old one.
ALTER TABLE episodes ADD COLUMN app_key TEXT;
CREATE UNIQUE INDEX episodes_app_key ON episodes(app_key);
