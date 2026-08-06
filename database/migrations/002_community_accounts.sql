CREATE TABLE IF NOT EXISTS hara_world.community_accounts (
  github_user_id bigint PRIMARY KEY,
  github_login text NOT NULL CHECK (github_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  display_name text,
  avatar_url text,
  profile_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS hara_world.community_identity_handoffs (
  handoff_id text PRIMARY KEY CHECK (char_length(handoff_id) BETWEEN 20 AND 200),
  github_user_id bigint NOT NULL REFERENCES hara_world.community_accounts (github_user_id) DEFERRABLE INITIALLY DEFERRED,
  issuer text NOT NULL,
  audience text NOT NULL CHECK (audience = 'world'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_identity_handoffs_consumed_idx
  ON hara_world.community_identity_handoffs (consumed_at DESC);

-- statement-breakpoint

COMMENT ON TABLE hara_world.community_accounts IS
  'Server-verified GitHub identities that have completed an audience-bound Hara Identity handoff.';

-- statement-breakpoint

COMMENT ON TABLE hara_world.community_identity_handoffs IS
  'One-time Hara Identity handoff consumption ledger. The primary key prevents replay from creating multiple World sessions.';
