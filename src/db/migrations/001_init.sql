-- Fortune Muse — phase 1 schema (US launch). See MVP plan §5.3.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  password_hash    text,
  email_verified   boolean NOT NULL DEFAULT false,
  handle           text NOT NULL UNIQUE,
  role             text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','restricted','banned')),
  country          text NOT NULL DEFAULT 'US',
  language         text NOT NULL DEFAULT 'en',
  gender           text,
  age_range        text,
  timezone         text NOT NULL DEFAULT 'America/New_York',
  region           text NOT NULL DEFAULT 'us',
  memory_enabled   boolean NOT NULL DEFAULT true,
  rooms_enabled    boolean NOT NULL DEFAULT true,
  age_confirmed_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One-time tokens: email verification, password reset, magic-link login.
CREATE TABLE auth_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify','reset','magic')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE consents (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,            -- terms, privacy, age_18, digital_content
  version    text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type, version)
);

CREATE TABLE avatars (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_id            text NOT NULL,
  customization_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  mood               text NOT NULL DEFAULT 'calm' CHECK (mood IN ('happy','calm','low','surprised','hopeful')),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deities (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  title          text NOT NULL,
  theme          text NOT NULL,
  persona_prompt text NOT NULL,
  greeting       text NOT NULL,
  image_assets   jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  sort           int NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  provider              text NOT NULL CHECK (provider IN ('stripe','dev','voucher')),
  provider_session_id   text,
  stripe_payment_intent text,
  amount                int NOT NULL,          -- cents
  currency              text NOT NULL DEFAULT 'usd',
  tax                   int NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','failed','refund_requested','refunded','canceled')),
  refund_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders(user_id, created_at DESC);

CREATE TABLE readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  deity_id      text NOT NULL REFERENCES deities(id),
  topic         text NOT NULL CHECK (topic IN ('wealth','love')),
  tier          text NOT NULL CHECK (tier IN ('standard','detailed','deep')),
  question      text NOT NULL,
  topic_cluster text NOT NULL,
  result_json   jsonb,
  status        text NOT NULL DEFAULT 'awaiting_payment'
                CHECK (status IN ('awaiting_payment','generating','ready','failed','refunded')),
  attempts      int NOT NULL DEFAULT 0,
  price         int NOT NULL,
  order_id      uuid REFERENCES orders(id),
  local_date    date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX readings_user_idx ON readings(user_id, created_at DESC);

CREATE TABLE memories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source     text NOT NULL DEFAULT 'feedback' CHECK (source = 'feedback'),
  reading_id uuid REFERENCES readings(id) ON DELETE SET NULL,
  content    text NOT NULL,
  mood_tag   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Deletes are hard deletes so they take effect immediately (plan §M5).
CREATE INDEX memories_user_idx ON memories(user_id, created_at DESC);

CREATE TABLE rewards (
  id          text PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('free_reading','avatar_item','deity_skin','sticker')),
  name        text NOT NULL,
  description text NOT NULL,
  weight      int NOT NULL CHECK (weight >= 0),
  asset       text,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE daily_draws (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       date NOT NULL,
  reward_id  text NOT NULL REFERENCES rewards(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- Things a user owns: free reading vouchers, avatar items, skins, stickers.
CREATE TABLE inventory (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id  text NOT NULL REFERENCES rewards(id),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_user_idx ON inventory(user_id);

CREATE TABLE rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         text NOT NULL,
  topic_cluster text NOT NULL,
  label         text NOT NULL,
  local_date    date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE INDEX rooms_match_idx ON rooms(topic, topic_cluster, local_date) WHERE status = 'open';

CREATE TABLE room_members (
  room_id   uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz,
  muted     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_room_idx ON messages(room_id, created_at);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  message_id       uuid,
  room_id          uuid,
  -- Copy of the reported message, kept for moderation after the room is deleted.
  message_snapshot text,
  reason           text NOT NULL,
  details          text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  resolution_note  text,
  resolved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

-- US privacy rights requests (access / delete / do-not-sell) — plan §M9.
CREATE TABLE privacy_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text NOT NULL,
  type       text NOT NULL CHECK (type IN ('access','delete','do_not_sell','correct')),
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Content library the generator draws from (songs, foods, drinks, actions, outfits).
CREATE TABLE content_items (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind    text NOT NULL CHECK (kind IN ('song','food','drink','action','outfit','shoes','color','direction')),
  topic   text CHECK (topic IN ('wealth','love')),
  data    jsonb NOT NULL,
  active  boolean NOT NULL DEFAULT true
);
CREATE INDEX content_items_kind_idx ON content_items(kind) WHERE active;

-- Product analytics for the dashboard (first-party, no PII beyond user id).
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  name       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_name_idx ON events(name, created_at);
