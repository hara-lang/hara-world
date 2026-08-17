CREATE TABLE IF NOT EXISTS hara_world.community_proposals (
  proposal_id text PRIMARY KEY
    CHECK (proposal_id ~ '^proposal:(post|profile|agent|source):[0-9a-f]{24}$'),
  proposal_type text NOT NULL
    CHECK (proposal_type IN ('post', 'profile', 'agent', 'source')),
  owner_github_user_id bigint NOT NULL
    REFERENCES hara_world.community_accounts (github_user_id)
    ON DELETE CASCADE,
  resource_key text NOT NULL CHECK (char_length(resource_key) BETWEEN 1 AND 240),
  resource_title text NOT NULL CHECK (char_length(resource_title) BETWEEN 1 AND 240),
  repository text NOT NULL CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  branch text NOT NULL CHECK (char_length(branch) BETWEEN 1 AND 240),
  base_branch text NOT NULL CHECK (char_length(base_branch) BETWEEN 1 AND 240),
  pull_request_number integer NOT NULL CHECK (pull_request_number > 0),
  pull_request_url text NOT NULL CHECK (pull_request_url ~ '^https://github\.com/'),
  public_path text CHECK (public_path IS NULL OR public_path ~ '^/'),
  head_sha text CHECK (head_sha IS NULL OR head_sha ~ '^[0-9a-f]{40}$'),
  state text NOT NULL DEFAULT 'submitted'
    CHECK (state IN (
      'draft',
      'submitted',
      'changes-requested',
      'approved',
      'merged',
      'closed',
      'withdrawn',
      'error'
    )),
  review_state text NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'changes-requested', 'approved', 'dismissed')),
  checks_state text NOT NULL DEFAULT 'unknown'
    CHECK (checks_state IN ('unknown', 'pending', 'passing', 'failing')),
  is_draft boolean NOT NULL DEFAULT true,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  merged_at timestamptz,
  closed_at timestamptz,
  last_reconciled_at timestamptz,
  UNIQUE (proposal_type, resource_key),
  UNIQUE (repository, pull_request_number)
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_proposals_owner_state_idx
  ON hara_world.community_proposals (owner_github_user_id, state, updated_at DESC);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_proposals_review_queue_idx
  ON hara_world.community_proposals (state, review_state, checks_state, updated_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS hara_world.community_proposal_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id text NOT NULL
    REFERENCES hara_world.community_proposals (proposal_id)
    ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'world'
    CHECK (provider IN ('world', 'github', 'reconcile')),
  provider_delivery_key text,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 100),
  action text CHECK (action IS NULL OR char_length(action) BETWEEN 1 AND 100),
  actor_github_user_id bigint,
  actor_login text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_delivery_key)
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_proposal_events_proposal_idx
  ON hara_world.community_proposal_events (proposal_id, created_at DESC, id DESC);

-- statement-breakpoint

COMMENT ON TABLE hara_world.community_proposals IS
  'Unified lifecycle state for Hara World post, profile, agent, and source pull-request proposals. Git merge remains the publication or registration authority.';

-- statement-breakpoint

COMMENT ON TABLE hara_world.community_proposal_events IS
  'Append-only local, webhook, and reconciliation events. Provider delivery keys make repeated GitHub webhook delivery harmless.';
