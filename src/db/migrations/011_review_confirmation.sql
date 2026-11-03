-- Existing readings retain their original content. New reading creation records explicit review confirmation.
ALTER TABLE oracle_casts ADD COLUMN information_confirmed_at timestamptz;
