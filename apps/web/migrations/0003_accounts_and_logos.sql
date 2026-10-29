-- Oct 29, 2026: people type their first and last name the first time they sign in, since a Gmail
-- account's name may not be their real one. Until they do, name is the one Google gave.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
-- An invite can give admin access (ticked "Give Admin Access"); otherwise the person is a contributor.
ALTER TABLE invites ADD COLUMN as_admin INTEGER NOT NULL DEFAULT 0;
-- Each show's small logo, as a data: URL of an image no bigger than 128 pixels, resized in the browser.
ALTER TABLE shows ADD COLUMN logo TEXT;
