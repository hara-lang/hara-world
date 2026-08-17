import { createHmac, timingSafeEqual } from "node:crypto";

const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "stale",
  "timed_out",
]);
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyGitHubWebhookSignature(rawBody, signatureHeader, secret) {
  const key = String(secret ?? "");
  const signature = String(signatureHeader ?? "");
  if (key.length < 32) throw new Error("HARA_WORLD_GITHUB_WEBHOOK_SECRET must contain at least 32 characters.");
  if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac("sha256", key).update(String(rawBody ?? "")).digest("hex")}`;
  return safeEqual(expected, signature.toLowerCase());
}

function titleWithoutPrefix(value) {
  return String(value ?? "")
    .replace(/^(?:Post|Profile|Agent|Source):\s*/i, "")
    .trim()
    .slice(0, 240) || "Untitled proposal";
}

export function proposalDescriptorFromPullRequest(pullRequest) {
  const pull = pullRequest ?? {};
  const body = String(pull.body ?? "");
  const common = {
    resourceTitle: titleWithoutPrefix(pull.title),
    repository: String(pull.base?.repo?.full_name ?? pull.head?.repo?.full_name ?? ""),
    branch: String(pull.head?.ref ?? ""),
    baseBranch: String(pull.base?.ref ?? "main"),
    pullRequestNumber: Number(pull.number),
    pullRequestUrl: String(pull.html_url ?? ""),
    headSha: String(pull.head?.sha ?? "") || null,
    isDraft: pull.draft === true,
    submittedAt: pull.created_at ?? pull.updated_at ?? Date.now(),
  };

  const post = body.match(/<!--\s*hara-world-post:draft:([0-9a-f-]{36})\s*-->/i);
  const postAuthor = body.match(/<!--\s*hara-world-author:github:(\d+)\s*-->/i);
  if (body.includes("<!-- hara-world-post-proposal -->") && post && postAuthor) {
    return {
      ...common,
      proposalType: "post",
      ownerGithubUserId: postAuthor[1],
      resourceKey: post[1].toLowerCase(),
      publicPath: null,
    };
  }

  const profile = body.match(/<!--\s*hara-world-profile:github:(\d+)\s*-->/i);
  if (body.includes("<!-- hara-world-profile-proposal -->") && profile) {
    return {
      ...common,
      proposalType: "profile",
      ownerGithubUserId: profile[1],
      resourceKey: `github:${profile[1]}`,
      publicPath: null,
    };
  }

  const agent = body.match(/<!--\s*hara-world-agent:(agent:github:(\d+):([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?))\s*-->/i);
  if (body.includes("<!-- hara-world-agent-proposal -->") && agent) {
    return {
      ...common,
      proposalType: "agent",
      ownerGithubUserId: agent[2],
      resourceKey: agent[1].toLowerCase(),
      publicPath: `/agents/${agent[3].toLowerCase()}/`,
    };
  }

  const source = body.match(/<!--\s*hara-world-source:github:(\d+):([a-z0-9]+(?:-[a-z0-9]+)*)\s*-->/i);
  if (body.includes("<!-- hara-world-source-proposal -->") && source) {
    return {
      ...common,
      proposalType: "source",
      ownerGithubUserId: source[1],
      resourceKey: source[2].toLowerCase(),
      publicPath: "/sources",
    };
  }

  return null;
}

export function pullRequestLifecycle(pullRequest, action = "") {
  const pull = pullRequest ?? {};
  const merged = pull.merged === true || Boolean(pull.merged_at);
  const closed = pull.state === "closed" || action === "closed";
  if (merged) {
    return {
      state: "merged",
      reviewState: "approved",
      isDraft: false,
      mergedAt: pull.merged_at ?? new Date().toISOString(),
      closedAt: pull.closed_at ?? pull.merged_at ?? new Date().toISOString(),
    };
  }
  if (closed) {
    return {
      state: "closed",
      isDraft: pull.draft === true,
      closedAt: pull.closed_at ?? new Date().toISOString(),
    };
  }
  return {
    state: "submitted",
    isDraft: pull.draft === true,
  };
}

export function reviewLifecycle(review) {
  const state = String(review?.state ?? "").toUpperCase();
  if (state === "APPROVED") return { state: "approved", reviewState: "approved" };
  if (state === "CHANGES_REQUESTED") return { state: "changes-requested", reviewState: "changes-requested" };
  if (state === "DISMISSED") return { state: "submitted", reviewState: "dismissed" };
  return { state: null, reviewState: null };
}

export function reviewStateFromReviews(reviews = []) {
  const latestByReviewer = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = String(review?.user?.login ?? "").toLowerCase();
    const state = String(review?.state ?? "").toUpperCase();
    if (!login || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(state)) continue;
    const current = latestByReviewer.get(login);
    const timestamp = Date.parse(review?.submitted_at ?? review?.updated_at ?? 0) || 0;
    if (!current || timestamp >= current.timestamp) latestByReviewer.set(login, { state, timestamp });
  }
  const states = [...latestByReviewer.values()].map((item) => item.state);
  if (states.includes("CHANGES_REQUESTED")) return "changes-requested";
  if (states.includes("APPROVED")) return "approved";
  if (states.includes("DISMISSED")) return "dismissed";
  return "pending";
}

export function checksStateFromRuns(checkRuns = []) {
  const runs = Array.isArray(checkRuns) ? checkRuns : [];
  if (runs.length === 0) return "unknown";
  if (runs.some((run) => run?.status !== "completed")) return "pending";
  const conclusions = runs.map((run) => String(run?.conclusion ?? "").toLowerCase());
  if (conclusions.some((conclusion) => FAILURE_CONCLUSIONS.has(conclusion))) return "failing";
  if (conclusions.every((conclusion) => PASSING_CONCLUSIONS.has(conclusion))) return "passing";
  return "unknown";
}

export function checksStateFromWebhook(payload) {
  if (payload?.check_run) return checksStateFromRuns([payload.check_run]);
  const suite = payload?.check_suite;
  if (!suite) return "unknown";
  if (suite.status !== "completed") return "pending";
  const conclusion = String(suite.conclusion ?? "").toLowerCase();
  if (FAILURE_CONCLUSIONS.has(conclusion)) return "failing";
  if (PASSING_CONCLUSIONS.has(conclusion)) return "passing";
  return "unknown";
}

export function pullRequestNumberFromCheckPayload(payload) {
  const pulls = payload?.check_run?.pull_requests ?? payload?.check_suite?.pull_requests ?? [];
  const number = Number(Array.isArray(pulls) ? pulls[0]?.number : null);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
