-- Account-owned presentation preference. Deleting a story clears its selection.
CREATE TABLE oracle_return_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_cast_id uuid REFERENCES oracle_casts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
