import { createHash } from "node:crypto";
import koans from "../../../content/koans.json" with { type: "json" };
import { getDatabase } from "./neon-http.mjs";

export const koanById = (id) => koans.find((koan) => koan.id === String(id));

export function normalizeCompletion(body) {
  const koan = koanById(body?.koanId);
  if (!koan) throw new TypeError("Unknown koan.");
  if (body?.version !== koan.version) throw new TypeError("This koan has changed; run its current tests again.");
  if (body?.passed !== true) throw new TypeError("Only browser-verified solutions can be saved.");
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  if (!source || source.length > 12000) throw new TypeError("Accepted source must contain 1–12,000 characters.");
  return { koan, source, sha256: createHash("sha256").update(source).digest("hex") };
}

export async function completedKoans(githubUserId, { db = getDatabase() } = {}) {
  const result = await db.query(
    `SELECT koan_id, koan_version, completed_at, updated_at
       FROM hara_world.koan_completions
      WHERE github_user_id = $1::bigint
      ORDER BY koan_id`, [String(githubUserId)]);
  return result.rows;
}

export async function saveCompletion(githubUserId, completion, { db = getDatabase() } = {}) {
  const result = await db.query(
    `INSERT INTO hara_world.koan_completions
       (github_user_id, koan_id, koan_version, solution_source, source_sha256, completed_at, updated_at)
     VALUES ($1::bigint, $2, $3, $4, $5, now(), now())
     ON CONFLICT (github_user_id, koan_id, koan_version) DO UPDATE SET
       solution_source = EXCLUDED.solution_source,
       source_sha256 = EXCLUDED.source_sha256,
       updated_at = now()
     RETURNING koan_id, koan_version, completed_at, updated_at`,
    [String(githubUserId), completion.koan.id, completion.koan.version, completion.source, completion.sha256]);
  return result.rows[0];
}

export async function peerSolutions(githubUserId, koan, { db = getDatabase() } = {}) {
  const result = await db.query(
    `SELECT c.github_user_id::text AS github_user_id,
            a.github_login, a.display_name, a.avatar_url,
            c.solution_source, c.completed_at, c.updated_at
       FROM hara_world.koan_completions c
       JOIN hara_world.community_accounts a USING (github_user_id)
      WHERE c.koan_id = $2 AND c.koan_version = $3
        AND a.status = 'active'
        AND EXISTS (
          SELECT 1 FROM hara_world.koan_completions viewer
           WHERE viewer.github_user_id = $1::bigint
             AND viewer.koan_id = $2 AND viewer.koan_version = $3)
      ORDER BY c.completed_at, c.github_user_id
      LIMIT 100`, [String(githubUserId), koan.id, koan.version]);
  return result.rows;
}
