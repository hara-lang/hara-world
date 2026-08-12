CREATE TABLE IF NOT EXISTS hara_world.koan_completions (
  github_user_id bigint NOT NULL REFERENCES hara_world.community_accounts (github_user_id) ON DELETE CASCADE,
  koan_id text NOT NULL CHECK (koan_id ~ '^[0-9]{3}$'),
  koan_version integer NOT NULL CHECK (koan_version > 0),
  solution_source text NOT NULL CHECK (char_length(solution_source) BETWEEN 1 AND 12000),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_user_id, koan_id, koan_version)
);

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS koan_completions_koan_idx
  ON hara_world.koan_completions (koan_id, koan_version, completed_at);

-- statement-breakpoint

COMMENT ON TABLE hara_world.koan_completions IS
  'Browser-verified accepted Hara Koan source. Failed attempts are never stored.';
