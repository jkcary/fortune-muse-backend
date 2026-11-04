CREATE TABLE garden_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed integer[] NOT NULL DEFAULT '{}',
  decor text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE garden_moments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('joy','discovery','question')),
  PRIMARY KEY(user_id,date)
);
