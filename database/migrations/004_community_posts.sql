CREATE TABLE IF NOT EXISTS hara_learn.community_post_drafts (
  id uuid PRIMARY KEY,
  github_user_id bigint NOT NULL
    REFERENCES hara_learn.community_accounts (github_user_id)
    ON DELETE CASCADE,
  slug text NOT NULL
    CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  post_type text NOT NULL
    CHECK (post_type IN ('note', 'question', 'showcase', 'release', 'lesson')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 320),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  topics jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(topics) = 'array' AND jsonb_array_length(topics) <= 8),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'submitted',
      'changes-requested',
      'merged',
      'withdrawn',
      'rejected',
      'error'
    )),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_content_sha256 text CHECK (proposal_content_sha256 ~ '^[0-9a-f]{64}$'),
  proposal_branch text,
  proposal_path text,
  pull_request_number integer CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  pull_request_url text,
  base_sha text CHECK (base_sha IS NULL OR base_sha ~ '^[0-9a-f]{40}$'),
  submitted_at timestamptz,
  merged_at timestamptz,
  withdrawn_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_user_id, slug)
);

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS community_post_drafts_branch_key
  ON hara_learn.community_post_drafts (proposal_branch)
  WHERE proposal_branch IS NOT NULL;

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS community_post_drafts_pull_request_key
  ON hara_learn.community_post_drafts (pull_request_number)
  WHERE pull_request_number IS NOT NULL;

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_post_drafts_owner_status_idx
  ON hara_learn.community_post_drafts (github_user_id, status, updated_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS hara_learn.community_post_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id uuid NOT NULL
    REFERENCES hara_learn.community_post_drafts (id)
    ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN (
      'draft.created',
      'draft.updated',
      'proposal.submitted',
      'proposal.resubmitted',
      'proposal.withdrawn',
      'proposal.error',
      'proposal.merged',
      'proposal.rejected'
    )),
  actor_github_user_id bigint
    REFERENCES hara_learn.community_accounts (github_user_id)
    ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS community_post_events_draft_idx
  ON hara_learn.community_post_events (draft_id, created_at DESC, id DESC);

-- statement-breakpoint

COMMENT ON TABLE hara_learn.community_post_drafts IS
  'Private Hara Learn post drafts and their Git-reviewed proposal state. Merged public Markdown remains the publication source of truth.';

-- statement-breakpoint

COMMENT ON TABLE hara_learn.community_post_events IS
  'Append-only lifecycle events for private drafts and GitHub proposal reconciliation.';
