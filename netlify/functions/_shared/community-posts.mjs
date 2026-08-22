import { randomUUID } from "node:crypto";
import { getDatabase } from "./neon-http.mjs";
import {
  assertDraftId,
  assertPostIdentity,
  normalizePostDraft,
  postContentSha256,
} from "./post-proposal.mjs";

const TERMINAL_STATUSES = new Set(["merged", "withdrawn", "rejected"]);

export class PostDraftConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "PostDraftConflictError";
  }
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function mapPostDraft(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    githubUserId: String(row.github_user_id),
    slug: String(row.slug),
    postType: String(row.post_type),
    title: String(row.title),
    description: String(row.description),
    body: String(row.body),
    topics: jsonValue(row.topics, []),
    status: String(row.status),
    contentSha256: String(row.content_sha256),
    proposalContentSha256: row.proposal_content_sha256 ? String(row.proposal_content_sha256) : null,
    proposalBranch: row.proposal_branch ? String(row.proposal_branch) : null,
    proposalPath: row.proposal_path ? String(row.proposal_path) : null,
    pullRequestNumber: numberValue(row.pull_request_number),
    pullRequestUrl: row.pull_request_url ? String(row.pull_request_url) : null,
    baseSha: row.base_sha ? String(row.base_sha) : null,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    mergedAt: row.merged_at ? String(row.merged_at) : null,
    withdrawnAt: row.withdrawn_at ? String(row.withdrawn_at) : null,
    revision: numberValue(row.revision) ?? 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const DRAFT_COLUMNS = `
  id, github_user_id, slug, post_type, title, description, body, topics, status,
  content_sha256, proposal_content_sha256, proposal_branch, proposal_path,
  pull_request_number, pull_request_url, base_sha, submitted_at, merged_at,
  withdrawn_at, revision, created_at, updated_at`;

export async function listPostDrafts(githubUserId, { db = getDatabase(), limit = 50 } = {}) {
  const identity = assertPostIdentity({ id: githubUserId, login: "placeholder" });
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const result = await db.query(
    `SELECT ${DRAFT_COLUMNS}
       FROM hara_learn.community_post_drafts
      WHERE github_user_id = $1::bigint
      ORDER BY updated_at DESC, id DESC
      LIMIT $2::integer`,
    [identity.id, safeLimit],
  );
  return result.rows.map(mapPostDraft);
}

export async function getPostDraft(githubUserId, draftId, { db = getDatabase() } = {}) {
  const identity = assertPostIdentity({ id: githubUserId, login: "placeholder" });
  const id = assertDraftId(draftId);
  const result = await db.query(
    `SELECT ${DRAFT_COLUMNS}
       FROM hara_learn.community_post_drafts
      WHERE id = $1::uuid AND github_user_id = $2::bigint`,
    [id, identity.id],
  );
  return mapPostDraft(result.rows[0]);
}

export async function createPostDraft(identity, input, {
  db = getDatabase(),
  now = Date.now(),
  randomUUIDImpl = randomUUID,
} = {}) {
  const author = assertPostIdentity(identity);
  const draft = normalizePostDraft(input);
  const id = assertDraftId(randomUUIDImpl());
  const fingerprint = postContentSha256(draft);
  const timestamp = new Date(now).toISOString();
  const payload = JSON.stringify({ contentSha256: fingerprint, postType: draft.postType });
  const result = await db.query(
    `WITH inserted AS (
       INSERT INTO hara_learn.community_post_drafts (
         id, github_user_id, slug, post_type, title, description, body, topics,
         status, content_sha256, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::bigint, $3, $4, $5, $6, $7, $8::jsonb,
         'draft', $9, $10::timestamptz, $10::timestamptz
       )
       RETURNING ${DRAFT_COLUMNS}
     ), recorded AS (
       INSERT INTO hara_learn.community_post_events (
         draft_id, event_type, actor_github_user_id, payload, created_at
       )
       SELECT id, 'draft.created', github_user_id, $11::jsonb, $10::timestamptz
       FROM inserted
     )
     SELECT * FROM inserted`,
    [
      id,
      author.id,
      draft.slug,
      draft.postType,
      draft.title,
      draft.description,
      draft.body,
      JSON.stringify(draft.topics),
      fingerprint,
      timestamp,
      payload,
    ],
  );
  return mapPostDraft(result.rows[0]);
}

export async function updatePostDraft(identity, draftId, input, {
  db = getDatabase(),
  now = Date.now(),
} = {}) {
  const author = assertPostIdentity(identity);
  const current = await getPostDraft(author.id, draftId, { db });
  if (!current) return null;
  if (TERMINAL_STATUSES.has(current.status)) {
    throw new PostDraftConflictError(`A ${current.status} post draft cannot be edited.`);
  }
  const draft = normalizePostDraft(input, current);
  if (current.proposalPath && draft.slug !== current.slug) {
    throw new PostDraftConflictError("A submitted post slug cannot be changed.");
  }
  const fingerprint = postContentSha256(draft);
  if (fingerprint === current.contentSha256) return current;
  const timestamp = new Date(now).toISOString();
  const payload = JSON.stringify({
    previousContentSha256: current.contentSha256,
    contentSha256: fingerprint,
    previousStatus: current.status,
  });
  const result = await db.query(
    `WITH updated AS (
       UPDATE hara_learn.community_post_drafts
          SET slug = $3,
              post_type = $4,
              title = $5,
              description = $6,
              body = $7,
              topics = $8::jsonb,
              status = 'draft',
              content_sha256 = $9,
              revision = revision + 1,
              updated_at = $10::timestamptz
        WHERE id = $1::uuid AND github_user_id = $2::bigint
        RETURNING ${DRAFT_COLUMNS}
     ), recorded AS (
       INSERT INTO hara_learn.community_post_events (
         draft_id, event_type, actor_github_user_id, payload, created_at
       )
       SELECT id, 'draft.updated', github_user_id, $11::jsonb, $10::timestamptz
       FROM updated
     )
     SELECT * FROM updated`,
    [
      current.id,
      author.id,
      draft.slug,
      draft.postType,
      draft.title,
      draft.description,
      draft.body,
      JSON.stringify(draft.topics),
      fingerprint,
      timestamp,
      payload,
    ],
  );
  return mapPostDraft(result.rows[0]);
}

export async function deletePostDraft(identity, draftId, { db = getDatabase() } = {}) {
  const author = assertPostIdentity(identity);
  const id = assertDraftId(draftId);
  const result = await db.query(
    `DELETE FROM hara_learn.community_post_drafts
      WHERE id = $1::uuid
        AND github_user_id = $2::bigint
        AND status = 'draft'
        AND pull_request_number IS NULL
      RETURNING id`,
    [id, author.id],
  );
  return result.rows.length > 0;
}

export async function markPostSubmitted(identity, draftId, proposal, {
  db = getDatabase(),
  now = Date.now(),
} = {}) {
  const author = assertPostIdentity(identity);
  const id = assertDraftId(draftId);
  const timestamp = new Date(now).toISOString();
  const eventType = proposal.reused ? "proposal.resubmitted" : "proposal.submitted";
  const payload = JSON.stringify({
    pullRequestNumber: proposal.number,
    pullRequestUrl: proposal.pullRequestUrl,
    branch: proposal.branch,
    path: proposal.path,
    baseSha: proposal.baseSha,
    contentSha256: proposal.contentSha256,
  });
  const result = await db.query(
    `WITH updated AS (
       UPDATE hara_learn.community_post_drafts
          SET status = 'submitted',
              proposal_content_sha256 = $3,
              proposal_branch = $4,
              proposal_path = $5,
              pull_request_number = $6::integer,
              pull_request_url = $7,
              base_sha = $8,
              submitted_at = COALESCE(submitted_at, $9::timestamptz),
              withdrawn_at = NULL,
              revision = revision + 1,
              updated_at = $9::timestamptz
        WHERE id = $1::uuid AND github_user_id = $2::bigint
        RETURNING ${DRAFT_COLUMNS}
     ), recorded AS (
       INSERT INTO hara_learn.community_post_events (
         draft_id, event_type, actor_github_user_id, payload, created_at
       )
       SELECT id, $10, github_user_id, $11::jsonb, $9::timestamptz
       FROM updated
     )
     SELECT * FROM updated`,
    [
      id,
      author.id,
      proposal.contentSha256,
      proposal.branch,
      proposal.path,
      proposal.number,
      proposal.pullRequestUrl,
      proposal.baseSha,
      timestamp,
      eventType,
      payload,
    ],
  );
  return mapPostDraft(result.rows[0]);
}

export async function markPostProposalError(identity, draftId, message, {
  db = getDatabase(),
  now = Date.now(),
} = {}) {
  const author = assertPostIdentity(identity);
  const id = assertDraftId(draftId);
  const timestamp = new Date(now).toISOString();
  const payload = JSON.stringify({ message: String(message ?? "Proposal publication failed.").slice(0, 500) });
  const result = await db.query(
    `WITH updated AS (
       UPDATE hara_learn.community_post_drafts
          SET status = 'error', revision = revision + 1, updated_at = $3::timestamptz
        WHERE id = $1::uuid AND github_user_id = $2::bigint
        RETURNING ${DRAFT_COLUMNS}
     ), recorded AS (
       INSERT INTO hara_learn.community_post_events (
         draft_id, event_type, actor_github_user_id, payload, created_at
       )
       SELECT id, 'proposal.error', github_user_id, $4::jsonb, $3::timestamptz
       FROM updated
     )
     SELECT * FROM updated`,
    [id, author.id, timestamp, payload],
  );
  return mapPostDraft(result.rows[0]);
}

export async function markPostWithdrawn(identity, draftId, {
  db = getDatabase(),
  now = Date.now(),
} = {}) {
  const author = assertPostIdentity(identity);
  const id = assertDraftId(draftId);
  const timestamp = new Date(now).toISOString();
  const result = await db.query(
    `WITH updated AS (
       UPDATE hara_learn.community_post_drafts
          SET status = 'withdrawn',
              withdrawn_at = $3::timestamptz,
              revision = revision + 1,
              updated_at = $3::timestamptz
        WHERE id = $1::uuid
          AND github_user_id = $2::bigint
          AND status IN ('draft', 'submitted', 'changes-requested', 'error')
        RETURNING ${DRAFT_COLUMNS}
     ), recorded AS (
       INSERT INTO hara_learn.community_post_events (
         draft_id, event_type, actor_github_user_id, payload, created_at
       )
       SELECT id, 'proposal.withdrawn', github_user_id, '{}'::jsonb, $3::timestamptz
       FROM updated
     )
     SELECT * FROM updated`,
    [id, author.id, timestamp],
  );
  return mapPostDraft(result.rows[0]);
}
