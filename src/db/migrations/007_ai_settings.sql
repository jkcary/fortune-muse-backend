-- Which AI model the intake conversation and reading generation use, chosen in the admin console.
CREATE TABLE ai_settings (
  task        text PRIMARY KEY CHECK (task IN ('intake','reading')),
  provider    text NOT NULL,
  model       text NOT NULL DEFAULT '',
  base_url    text,
  temperature real,
  max_tokens  int,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Provider API keys entered in the console, AES-256-GCM encrypted with SETTINGS_ENCRYPTION_KEY.
CREATE TABLE ai_keys (
  provider    text PRIMARY KEY,
  ciphertext  text NOT NULL,
  last4       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

-- What admins changed in settings (never secrets).
CREATE TABLE admin_audit (
  id         bigserial PRIMARY KEY,
  admin_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit(created_at DESC);
