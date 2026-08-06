import { getDatabase } from "./neon-http.mjs";

export async function recordIdentityHandoff(identity, { db = getDatabase() } = {}) {
  if (
    typeof identity?.handoffId !== "string"
    || !identity.handoffId
    || typeof identity?.id !== "string"
    || !/^\d+$/.test(identity.id)
  ) {
    throw new TypeError("A verified identity handoff is required.");
  }

  const result = await db.query(
    `WITH permitted AS (
       SELECT NOT EXISTS (
         SELECT 1
         FROM hara_world.community_accounts
         WHERE github_user_id = $2::bigint AND status <> 'active'
       ) AS allowed
     ), accepted AS (
       INSERT INTO hara_world.community_identity_handoffs (
         handoff_id, github_user_id, issuer, audience, expires_at, consumed_at
       )
       SELECT $1, $2::bigint, $3, $4, $5::timestamptz, now()
       FROM permitted
       WHERE allowed
       ON CONFLICT (handoff_id) DO NOTHING
       RETURNING handoff_id
     ), account_upsert AS (
       INSERT INTO hara_world.community_accounts (
         github_user_id, github_login, display_name, avatar_url, profile_url,
         status, created_at, last_seen_at, updated_at
       )
       SELECT $2::bigint, $6, $7, $8, $9, 'active', now(), now(), now()
       FROM accepted
       ON CONFLICT (github_user_id) DO UPDATE SET
         github_login = EXCLUDED.github_login,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         profile_url = EXCLUDED.profile_url,
         last_seen_at = now(),
         updated_at = now()
       WHERE hara_world.community_accounts.status = 'active'
       RETURNING github_user_id
     )
     SELECT EXISTS (SELECT 1 FROM accepted) AS accepted`,
    [
      identity.handoffId,
      identity.id,
      identity.handoffIssuer,
      identity.handoffAudience,
      identity.handoffExpiresAt,
      identity.login,
      identity.name,
      identity.avatarUrl,
      identity.profileUrl,
    ],
  );

  return result.rows[0]?.accepted === true;
}
