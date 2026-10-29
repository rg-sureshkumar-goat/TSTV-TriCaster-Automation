-- Episodes start as drafts, visible only to whoever created them and admins, until the producer
-- clicks "Publish rundown".
ALTER TABLE episodes ADD COLUMN published_at INTEGER;
