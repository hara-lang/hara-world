import { getDatabase } from "./neon-http.mjs";

function assertGitHubId(value) {
  const id = String(value ?? "");
  if (!/^\d+$/.test(id)) throw new TypeError("A stable numeric GitHub identity is required.");
  return id;
}

export async function recordIdentityHandoff(identity, { db = getDatabase() } = {}) {
  if (
    typeof identity?.handoffId !== "string"
    || identity.handoffId.length < 20
    || identity.handoffId.length > 200
  ) {
    throw new TypeError("A verified identity handoff is required.");
  }
  const githubId = assertGitHubId(identity.id);

  const result = await db.query(
    `WITH account_upsert AS (
       INSERT INTO hara_learn.community_accounts (
         github_user_id, github_login, display_name, avatar_url, profile_url,
         status, created_at, last_seen_at, updated_at
       ) VALUES ($2::bigint, $6, $7, $8, $9, 'active', now(), now(), now())
       ON CONFLICT (github_user_id) DO UPDATE SET
         github_login = EXCLUDED.github_login,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         profile_url = EXCLUDED.profile_url,
         last_seen_at = now(),
         updated_at = now()
       WHERE hara_learn.community_accounts.status = 'active'
       RETURNING github_user_id
     ), accepted AS (
       INSERT INTO hara_learn.community_identity_handoffs (
         handoff_id, github_user_id, issuer, audience, expires_at, consumed_at
       )
       SELECT $1, github_user_id, $3, $4, $5::timestamptz, now()
       FROM account_upsert
       ON CONFLICT (handoff_id) DO NOTHING
       RETURNING handoff_id
     )
     SELECT EXISTS (SELECT 1 FROM accepted) AS accepted`,
    [
      identity.handoffId,
      githubId,
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

export async function communityAccountStatus(githubUserId, { db = getDatabase() } = {}) {
  const id = assertGitHubId(githubUserId);
  const result = await db.query(
    `SELECT status
       FROM hara_learn.community_accounts
      WHERE github_user_id = $1::bigint`,
    [id],
  );
  return result.rows[0]?.status ?? "missing";
}

export async function isCommunityAccountActive(githubUserId, options = {}) {
  return await communityAccountStatus(githubUserId, options) === "active";
}
