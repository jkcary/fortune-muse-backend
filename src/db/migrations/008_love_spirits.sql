-- Existing characters remain the wealth deck. seed() adds the three love spirits.
ALTER TABLE deities ADD COLUMN topic text NOT NULL DEFAULT 'wealth'
  CHECK (topic IN ('wealth', 'love'));
