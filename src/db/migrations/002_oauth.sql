-- Sign in with Google / Microsoft / Apple.

CREATE TABLE oauth_identities (
  provider   text NOT NULL CHECK (provider IN ('google','microsoft','apple')),
  subject    text NOT NULL,            -- the provider's stable user id ("sub")
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX oauth_identities_user_idx ON oauth_identities(user_id);

-- One-time tickets handed to the app after the provider callback; the app trades one for a session.
CREATE TABLE oauth_tickets (
  ticket_hash    text PRIMARY KEY,
  provider       text NOT NULL,
  subject        text NOT NULL,
  email          text NOT NULL,
  email_verified boolean NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
