CREATE SCHEMA IF NOT EXISTS hara_world;

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS hara_world.mailing_list_subscribers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'unsubscribed', 'suppressed', 'paused', 'deleted', 'error')),
  provider text NOT NULL DEFAULT 'buttondown',
  provider_subscriber_id text,
  provider_type text,
  interests jsonb NOT NULL DEFAULT '["dispatch"]'::jsonb
    CHECK (jsonb_typeof(interests) = 'array'),
  consent_at timestamptz NOT NULL DEFAULT now(),
  consent_source text NOT NULL,
  consent_text_version text NOT NULL,
  consent_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(consent_evidence) = 'object'),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  suppressed_at timestamptz,
  deleted_at timestamptz,
  last_provider_event_at timestamptz,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provider_payload) = 'object'),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailing_list_subscribers_email_normalized_key UNIQUE (email_normalized)
);

-- statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mailing_list_subscribers_provider_id_key
  ON hara_world.mailing_list_subscribers (provider, provider_subscriber_id)
  WHERE provider_subscriber_id IS NOT NULL;

-- statement-breakpoint

CREATE INDEX IF NOT EXISTS mailing_list_subscribers_status_idx
  ON hara_world.mailing_list_subscribers (status, updated_at DESC);

-- statement-breakpoint

CREATE TABLE IF NOT EXISTS hara_world.mailing_list_provider_events (
  provider text NOT NULL,
  event_key text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  PRIMARY KEY (provider, event_key)
);

-- statement-breakpoint

CREATE OR REPLACE VIEW hara_world.mailing_list_active AS
SELECT
  id,
  email,
  interests,
  confirmed_at,
  provider,
  provider_subscriber_id,
  created_at,
  updated_at
FROM hara_world.mailing_list_subscribers
WHERE status = 'active' AND deleted_at IS NULL;

-- statement-breakpoint

COMMENT ON TABLE hara_world.mailing_list_subscribers IS
  'Hara World subscriber lifecycle and versioned consent ledger. Delivery remains delegated to the configured provider.';

-- statement-breakpoint

COMMENT ON COLUMN hara_world.mailing_list_subscribers.consent_evidence IS
  'Minimal consent evidence. Raw IP addresses and full user-agent strings are deliberately not retained.';
