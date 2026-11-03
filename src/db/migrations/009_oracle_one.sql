-- Additive v2 migration: legacy readings, prices and receipts are preserved.
ALTER TABLE users ALTER COLUMN memory_enabled SET DEFAULT false;
ALTER TABLE users ALTER COLUMN rooms_enabled SET DEFAULT false;
ALTER TABLE orders ADD COLUMN voucher_inventory_id uuid REFERENCES inventory(id) ON DELETE SET NULL;

CREATE TABLE oracle_casts (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('wealth','love')),
  question text NOT NULL,
  context text NOT NULL DEFAULT '',
  private_mode boolean NOT NULL DEFAULT false,
  rounds jsonb NOT NULL DEFAULT '[]'::jsonb,
  basis_json jsonb,
  content_version text NOT NULL DEFAULT 'iching-editorial-1',
  note text NOT NULL DEFAULT '',
  favorite boolean NOT NULL DEFAULT false,
  order_id uuid UNIQUE REFERENCES orders(id),
  premium_status text NOT NULL DEFAULT 'free' CHECK (premium_status IN ('free','awaiting_payment','queued','generating','ready','failed','refunding','refunded')),
  premium_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT now() + interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oracle_casts_user_idx ON oracle_casts(user_id,created_at DESC);
CREATE INDEX oracle_casts_expiry_idx ON oracle_casts(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE oracle_followups (
  id uuid PRIMARY KEY,
  cast_id uuid NOT NULL REFERENCES oracle_casts(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('legacy','oracle','refund','followup')),
  subject_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,subject_id)
);
CREATE INDEX delivery_jobs_ready_idx ON delivery_jobs(state,available_at);

-- Recover already-paid legacy deliveries when deploying this migration.
INSERT INTO delivery_jobs(kind,subject_id)
SELECT 'legacy',r.id FROM readings r JOIN orders o ON o.id=r.order_id
WHERE o.status='paid' AND r.status IN ('awaiting_payment','generating')
ON CONFLICT DO NOTHING;
