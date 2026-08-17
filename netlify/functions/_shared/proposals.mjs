import { createHash } from "node:crypto";
import { getDatabase } from "./neon-http.mjs";

export const PROPOSAL_TYPES = Object.freeze(["post", "profile", "agent", "source"]);
export const PROPOSAL_STATES = Object.freeze([
  "draft",
  "submitted",
  "changes-requested",
  "approved",
  "merged",
  "closed",
  "withdrawn",
  "error",
]);
export const REVIEW_STATES = Object.freeze(["pending", "changes-requested", "approved", "dismissed"]);
export const CHECK_STATES = Object.freeze(["unknown", "pending", "passing", "failing"]);

const TYPE_SET = new Set(PROPOSAL_TYPES);
const STATE_SET = new Set(PROPOSAL_STATES);
const REVIEW_SET = new Set(REVIEW_STATES);
const CHECK_SET = new Set(CHECK_STATES);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function text(value, maximum, label, { required = true } = {}) {
  const output = String(value ?? "").replace(/\0/g, "").trim();
  if (required && !output) throw new TypeError(`${label} is required.`);
  if (output.length > maximum) throw new TypeError(`${label} exceeds ${maximum} characters.`);
  return output;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer.`);
  return number;
}

function githubUserId(value, label = "GitHub user ID") {
  const id = String(value ?? "");
  if (!/^\d+$/.test(id)) throw new TypeError(`${label} must be numeric.`);
  return id;
}

function isoTime(value, fallback = Date.now()) {
  const date = new Date(value ?? fallback);
  if (!Number.isFinite(date.valueOf())) throw new TypeError("A valid proposal time is required.");
  return date.toISOString();
}

function optionalSha(value) {
  if (value === undefined || value === null || value === "") return null;
  const sha = String(value).toLowerCase();
  if (!SHA_PATTERN.test(sha)) throw new TypeError("Proposal head SHA must contain forty hexadecimal characters.");
  return sha;
}

function databaseBoolean(value) {
  return value === true || String(value).toLowerCase() === "true";
}

export function proposalIdFor(proposalType, resourceKey) {
  const type = text(proposalType, 20, "Proposal type").toLowerCase();
  if (!TYPE_SET.has(type)) throw new TypeError(`Proposal type must be one of: ${PROPOSAL_TYPES.join(", ")}.`);
  const key = text(resourceKey, 240, "Proposal resource key");
  const digest = createHash("sha256").update(`${type}\n${key}`).digest("hex").slice(0, 24);
  return `proposal:${type}:${digest}`;
}

export function normalizeProposalSubmission(input, { now = Date.now() } = {}) {
  const proposalType = text(input?.proposalType, 20, "Proposal type").toLowerCase();
  if (!TYPE_SET.has(proposalType)) throw new TypeError(`Proposal type must be one of: ${PROPOSAL_TYPES.join(", ")}.`);
  const resourceKey = text(input?.resourceKey, 240, "Proposal resource key");
  const repository = text(input?.repository, 200, "Proposal repository");
  if (!REPOSITORY_PATTERN.test(repository)) throw new TypeError("Proposal repository must use owner/name syntax.");
  const pullRequestUrl = text(input?.pullRequestUrl, 500, "Pull-request URL");
  let parsedUrl;
  try { parsedUrl = new URL(pullRequestUrl); } catch { throw new TypeError("Pull-request URL must be a valid GitHub URL."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    throw new TypeError("Pull-request URL must use https://github.com/.");
  }
  const publicPath = text(input?.publicPath, 500, "Public path", { required: false }) || null;
  if (publicPath && !publicPath.startsWith("/")) throw new TypeError("Public path must begin with a slash.");
  return {
    proposalId: proposalIdFor(proposalType, resourceKey),
    proposalType,
    ownerGithubUserId: githubUserId(input?.ownerGithubUserId, "Proposal owner GitHub user ID"),
    resourceKey,
    resourceTitle: text(input?.resourceTitle, 240, "Proposal resource title"),
    repository,
    branch: text(input?.branch, 240, "Proposal branch"),
    baseBranch: text(input?.baseBranch || "main", 240, "Proposal base branch"),
    pullRequestNumber: positiveInteger(input?.pullRequestNumber, "Pull-request number"),
    pullRequestUrl,
    publicPath,
    headSha: optionalSha(input?.headSha),
    isDraft: input?.isDraft !== false,
    submittedAt: isoTime(input?.submittedAt, now),
  };
}

function mapProposal(row) {
  if (!row || typeof row !== "object") return null;
  return {
    proposalId: row.proposal_id,
    proposalType: row.proposal_type,
    ownerGithubUserId: String(row.owner_github_user_id ?? ""),
    resourceKey: row.resource_key,
    resourceTitle: row.resource_title,
    repository: row.repository,
    branch: row.branch,
    baseBranch: row.base_branch,
    pullRequestNumber: Number(row.pull_request_number),
    pullRequestUrl: row.pull_request_url,
    publicPath: row.public_path ?? null,
    headSha: row.head_sha ?? null,
    state: row.state,
    reviewState: row.review_state,
    checksState: row.checks_state,
    isDraft: databaseBoolean(row.is_draft),
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    mergedAt: row.merged_at ?? null,
    closedAt: row.closed_at ?? null,
    lastReconciledAt: row.last_reconciled_at ?? null,
  };
}

const RETURNING = `
  proposal_id, proposal_type, owner_github_user_id, resource_key, resource_title,
  repository, branch, base_branch, pull_request_number, pull_request_url,
  public_path, head_sha, state, review_state, checks_state, is_draft,
  submitted_at, updated_at, merged_at, closed_at, last_reconciled_at`;

export async function recordProposalSubmission(input, {
  db = getDatabase(),
  now = Date.now(),
  actorGithubUserId,
  actorLogin,
  eventType = "proposal.submitted",
  recordEvent = true,
  resetState = true,
} = {}) {
  const proposal = normalizeProposalSubmission(input, { now });
  const timestamp = isoTime(now);
  const upsert = {
    text: `INSERT INTO hara_world.community_proposals (
      proposal_id, proposal_type, owner_github_user_id, resource_key, resource_title,
      repository, branch, base_branch, pull_request_number, pull_request_url,
      public_path, head_sha, state, review_state, checks_state, is_draft,
      submitted_at, updated_at
    ) VALUES (
      $1, $2, $3::bigint, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, 'submitted', 'pending', 'unknown', $13::boolean,
      $14::timestamptz, $15::timestamptz
    )
    ON CONFLICT (proposal_type, resource_key) DO UPDATE SET
      resource_title = EXCLUDED.resource_title,
      repository = EXCLUDED.repository,
      branch = EXCLUDED.branch,
      base_branch = EXCLUDED.base_branch,
      pull_request_number = EXCLUDED.pull_request_number,
      pull_request_url = EXCLUDED.pull_request_url,
      public_path = COALESCE(EXCLUDED.public_path, hara_world.community_proposals.public_path),
      head_sha = COALESCE(EXCLUDED.head_sha, hara_world.community_proposals.head_sha),
      state = CASE WHEN $16::boolean THEN 'submitted' ELSE hara_world.community_proposals.state END,
      review_state = CASE WHEN $16::boolean THEN 'pending' ELSE hara_world.community_proposals.review_state END,
      checks_state = CASE WHEN $16::boolean THEN 'unknown' ELSE hara_world.community_proposals.checks_state END,
      is_draft = EXCLUDED.is_draft,
      submitted_at = CASE
        WHEN hara_world.community_proposals.pull_request_number = EXCLUDED.pull_request_number
          THEN hara_world.community_proposals.submitted_at
        ELSE EXCLUDED.submitted_at
      END,
      updated_at = EXCLUDED.updated_at,
      merged_at = CASE WHEN $16::boolean THEN NULL ELSE hara_world.community_proposals.merged_at END,
      closed_at = CASE WHEN $16::boolean THEN NULL ELSE hara_world.community_proposals.closed_at END
    WHERE hara_world.community_proposals.owner_github_user_id = EXCLUDED.owner_github_user_id
    RETURNING ${RETURNING}`,
    params: [
      proposal.proposalId,
      proposal.proposalType,
      proposal.ownerGithubUserId,
      proposal.resourceKey,
      proposal.resourceTitle,
      proposal.repository,
      proposal.branch,
      proposal.baseBranch,
      proposal.pullRequestNumber,
      proposal.pullRequestUrl,
      proposal.publicPath,
      proposal.headSha,
      proposal.isDraft,
      proposal.submittedAt,
      timestamp,
      resetState,
    ],
  };

  if (!recordEvent) {
    const result = await db.query(upsert.text, upsert.params);
    const recorded = mapProposal(result.rows[0]);
    if (!recorded) throw new Error("Proposal lifecycle owner does not match the existing resource record.");
    return recorded;
  }

  const actorId = actorGithubUserId === undefined || actorGithubUserId === null
    ? proposal.ownerGithubUserId
    : githubUserId(actorGithubUserId, "Proposal actor GitHub user ID");
  const event = {
    text: `INSERT INTO hara_world.community_proposal_events (
      proposal_id, provider, event_type, actor_github_user_id, actor_login, payload, created_at
    )
    SELECT $1, 'world', $2, $3::bigint, $4, $5::jsonb, $6::timestamptz
     WHERE EXISTS (
       SELECT 1
         FROM hara_world.community_proposals
        WHERE proposal_id = $1
          AND owner_github_user_id = $3::bigint
     )`,
    params: [
      proposal.proposalId,
      text(eventType, 100, "Proposal event type"),
      actorId,
      text(actorLogin, 100, "Proposal actor login", { required: false }) || null,
      {
        pullRequestNumber: proposal.pullRequestNumber,
        branch: proposal.branch,
        reused: eventType === "proposal.resubmitted",
      },
      timestamp,
    ],
  };
  const results = await db.transaction([upsert, event]);
  const recorded = mapProposal(results[0].rows[0]);
  if (!recorded) throw new Error("Proposal lifecycle owner does not match the existing resource record.");
  return recorded;
}

export async function listProposalsForOwner(ownerGithubUserId, {
  db = getDatabase(),
  limit = 100,
} = {}) {
  const owner = githubUserId(ownerGithubUserId, "Proposal owner GitHub user ID");
  const bounded = Math.max(1, Math.min(200, Number(limit) || 100));
  const result = await db.query(
    `SELECT ${RETURNING}
       FROM hara_world.community_proposals
      WHERE owner_github_user_id = $1::bigint
      ORDER BY updated_at DESC, proposal_id
      LIMIT $2`,
    [owner, bounded],
  );
  return result.rows.map(mapProposal);
}

export async function listReviewProposals({
  db = getDatabase(),
  limit = 200,
} = {}) {
  const bounded = Math.max(1, Math.min(300, Number(limit) || 200));
  const result = await db.query(
    `SELECT ${RETURNING}
       FROM hara_world.community_proposals
      ORDER BY
        CASE state
          WHEN 'changes-requested' THEN 0
          WHEN 'submitted' THEN 1
          WHEN 'approved' THEN 2
          WHEN 'error' THEN 3
          WHEN 'merged' THEN 4
          ELSE 5
        END,
        updated_at DESC,
        proposal_id
      LIMIT $1`,
    [bounded],
  );
  return result.rows.map(mapProposal);
}

export async function proposalForPullRequest(repository, pullRequestNumber, {
  db = getDatabase(),
} = {}) {
  const repo = text(repository, 200, "Proposal repository");
  if (!REPOSITORY_PATTERN.test(repo)) throw new TypeError("Proposal repository must use owner/name syntax.");
  const number = positiveInteger(pullRequestNumber, "Pull-request number");
  const result = await db.query(
    `SELECT ${RETURNING}
       FROM hara_world.community_proposals
      WHERE repository = $1 AND pull_request_number = $2`,
    [repo, number],
  );
  return mapProposal(result.rows[0]);
}

function optionalState(value, allowed, label) {
  if (value === undefined || value === null || value === "") return null;
  const state = String(value);
  if (!allowed.has(state)) throw new TypeError(`${label} is invalid.`);
  return state;
}

export async function applyProposalLifecycleEvent(input, {
  db = getDatabase(),
  now = Date.now(),
} = {}) {
  const proposalId = text(input?.proposalId, 80, "Proposal ID");
  if (!/^proposal:(post|profile|agent|source):[0-9a-f]{24}$/.test(proposalId)) {
    throw new TypeError("Proposal ID is invalid.");
  }
  const provider = text(input?.provider || "github", 20, "Proposal event provider");
  if (!new Set(["world", "github", "reconcile"]).has(provider)) throw new TypeError("Proposal event provider is invalid.");
  const deliveryKey = text(input?.deliveryKey, 240, "Provider delivery key", { required: false }) || null;
  const eventType = text(input?.eventType, 100, "Proposal event type");
  const action = text(input?.action, 100, "Proposal event action", { required: false }) || null;
  const state = optionalState(input?.state, STATE_SET, "Proposal state");
  const reviewState = optionalState(input?.reviewState, REVIEW_SET, "Proposal review state");
  const checksState = optionalState(input?.checksState, CHECK_SET, "Proposal checks state");
  const actorId = input?.actorGithubUserId === undefined || input?.actorGithubUserId === null
    ? null
    : githubUserId(input.actorGithubUserId, "Proposal event actor GitHub user ID");
  const actorLogin = text(input?.actorLogin, 100, "Proposal event actor login", { required: false }) || null;
  const headSha = optionalSha(input?.headSha);
  const timestamp = isoTime(now);
  const mergedAt = input?.mergedAt ? isoTime(input.mergedAt) : null;
  const closedAt = input?.closedAt ? isoTime(input.closedAt) : null;
  const reconciledAt = provider === "reconcile" ? timestamp : null;
  const payload = input?.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload
    : {};

  const result = await db.query(
    `WITH accepted AS (
       INSERT INTO hara_world.community_proposal_events (
         proposal_id, provider, provider_delivery_key, event_type, action,
         actor_github_user_id, actor_login, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::bigint, $7, $8::jsonb, $9::timestamptz)
       ON CONFLICT (provider, provider_delivery_key) DO NOTHING
       RETURNING proposal_id
     )
     UPDATE hara_world.community_proposals AS proposal SET
       state = COALESCE($10, proposal.state),
       review_state = COALESCE($11, proposal.review_state),
       checks_state = COALESCE($12, proposal.checks_state),
       head_sha = COALESCE($13, proposal.head_sha),
       is_draft = COALESCE($14::boolean, proposal.is_draft),
       updated_at = $9::timestamptz,
       merged_at = COALESCE($15::timestamptz, proposal.merged_at),
       closed_at = COALESCE($16::timestamptz, proposal.closed_at),
       last_reconciled_at = COALESCE($17::timestamptz, proposal.last_reconciled_at)
     WHERE proposal.proposal_id = $1
       AND EXISTS (SELECT 1 FROM accepted)
     RETURNING ${RETURNING}`,
    [
      proposalId,
      provider,
      deliveryKey,
      eventType,
      action,
      actorId,
      actorLogin,
      payload,
      timestamp,
      state,
      reviewState,
      checksState,
      headSha,
      input?.isDraft === undefined ? null : Boolean(input.isDraft),
      mergedAt,
      closedAt,
      reconciledAt,
    ],
  );
  if (result.rows[0]) return { accepted: true, proposal: mapProposal(result.rows[0]) };
  const existing = await db.query(
    `SELECT ${RETURNING}
       FROM hara_world.community_proposals
      WHERE proposal_id = $1`,
    [proposalId],
  );
  return { accepted: false, proposal: mapProposal(existing.rows[0]) };
}

export async function markProposalWithdrawn(proposalType, resourceKey, {
  db = getDatabase(),
  now = Date.now(),
  actorGithubUserId,
  actorLogin,
} = {}) {
  const proposalId = proposalIdFor(proposalType, resourceKey);
  return applyProposalLifecycleEvent({
    proposalId,
    provider: "world",
    eventType: "proposal.withdrawn",
    action: "withdraw",
    actorGithubUserId,
    actorLogin,
    state: "withdrawn",
    closedAt: isoTime(now),
  }, { db, now });
}

export function groupProposalCounts(proposals = []) {
  const counts = {
    total: 0,
    open: 0,
    changesRequested: 0,
    approved: 0,
    merged: 0,
    closed: 0,
    failing: 0,
  };
  for (const proposal of proposals) {
    counts.total += 1;
    if (["draft", "submitted", "changes-requested", "approved", "error"].includes(proposal.state)) counts.open += 1;
    if (proposal.state === "changes-requested" || proposal.reviewState === "changes-requested") counts.changesRequested += 1;
    if (proposal.state === "approved" || proposal.reviewState === "approved") counts.approved += 1;
    if (proposal.state === "merged") counts.merged += 1;
    if (["closed", "withdrawn"].includes(proposal.state)) counts.closed += 1;
    if (proposal.checksState === "failing") counts.failing += 1;
  }
  return counts;
}
