import { getEnv } from "./_shared/env.mjs";
import {
  checksStateFromWebhook,
  proposalDescriptorFromPullRequest,
  pullRequestLifecycle,
  pullRequestNumberFromCheckPayload,
  reviewLifecycle,
  verifyGitHubWebhookSignature,
} from "./_shared/github-proposals.mjs";
import {
  applyProposalLifecycleEvent,
  proposalForPullRequest,
  recordProposalSubmission,
} from "./_shared/proposals.mjs";

const WEBHOOK_PATH = "/api/github/events";
const MAXIMUM_BODY_BYTES = 2 * 1024 * 1024;

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  return String(getEnv(name, fallback) ?? fallback).trim();
}

function response(status, body) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function proposalStore(options) {
  return options.proposalStore ?? {
    recordSubmission: recordProposalSubmission,
    findByPullRequest: proposalForPullRequest,
    applyEvent: applyProposalLifecycleEvent,
  };
}

function expectedRepository(options, env) {
  return String(options.repository ?? envValue(env, "HARA_LEARN_GITHUB_REPOSITORY", "hara-lang/hara-learn"));
}

function repositoryFromPayload(payload) {
  return String(payload?.repository?.full_name
    ?? payload?.pull_request?.base?.repo?.full_name
    ?? payload?.check_run?.repository?.full_name
    ?? payload?.check_suite?.repository?.full_name
    ?? "");
}

function minimalPayload(eventName, payload, pullRequestNumber) {
  return {
    event: eventName,
    repository: repositoryFromPayload(payload),
    pullRequestNumber,
    sender: payload?.sender?.login ?? null,
    senderId: payload?.sender?.id ?? null,
  };
}

async function ensureProposal(store, descriptor, options) {
  if (!descriptor) return null;
  const current = await store.findByPullRequest(
    descriptor.repository,
    descriptor.pullRequestNumber,
    { db: options.db },
  );
  if (current) return current;
  return store.recordSubmission(descriptor, {
    db: options.db,
    now: options.now ?? Date.now(),
    recordEvent: false,
    resetState: false,
  });
}

async function processPullRequest(eventName, delivery, payload, store, options) {
  const pull = payload.pull_request;
  const descriptor = proposalDescriptorFromPullRequest(pull);
  if (!descriptor) return { ignored: true, reason: "unmanaged-pull-request" };
  const proposal = await ensureProposal(store, descriptor, options);
  const lifecycle = pullRequestLifecycle(pull, payload.action);
  const result = await store.applyEvent({
    proposalId: proposal.proposalId,
    provider: "github",
    deliveryKey: delivery,
    eventType: `github.${eventName}`,
    action: payload.action,
    actorGithubUserId: payload.sender?.id,
    actorLogin: payload.sender?.login,
    headSha: pull?.head?.sha,
    ...lifecycle,
    payload: minimalPayload(eventName, payload, pull?.number),
  }, { db: options.db, now: options.now ?? Date.now() });
  return { ignored: false, accepted: result.accepted, proposal: result.proposal };
}

async function processReview(eventName, delivery, payload, store, options) {
  const pull = payload.pull_request;
  const descriptor = proposalDescriptorFromPullRequest(pull);
  if (!descriptor) return { ignored: true, reason: "unmanaged-pull-request" };
  const proposal = await ensureProposal(store, descriptor, options);
  const lifecycle = reviewLifecycle(payload.review);
  const result = await store.applyEvent({
    proposalId: proposal.proposalId,
    provider: "github",
    deliveryKey: delivery,
    eventType: `github.${eventName}`,
    action: payload.action,
    actorGithubUserId: payload.review?.user?.id ?? payload.sender?.id,
    actorLogin: payload.review?.user?.login ?? payload.sender?.login,
    ...lifecycle,
    payload: {
      ...minimalPayload(eventName, payload, pull?.number),
      reviewState: payload.review?.state ?? null,
      reviewId: payload.review?.id ?? null,
    },
  }, { db: options.db, now: options.now ?? Date.now() });
  return { ignored: false, accepted: result.accepted, proposal: result.proposal };
}

async function processReviewComment(eventName, delivery, payload, store, options) {
  const pull = payload.pull_request;
  const descriptor = proposalDescriptorFromPullRequest(pull);
  if (!descriptor) return { ignored: true, reason: "unmanaged-pull-request" };
  const proposal = await ensureProposal(store, descriptor, options);
  const comment = payload.comment ?? {};
  const result = await store.applyEvent({
    proposalId: proposal.proposalId,
    provider: "github",
    deliveryKey: delivery,
    eventType: `github.${eventName}`,
    action: payload.action,
    actorGithubUserId: comment.user?.id ?? payload.sender?.id,
    actorLogin: comment.user?.login ?? payload.sender?.login,
    payload: {
      ...minimalPayload(eventName, payload, pull?.number),
      commentId: comment.id ?? null,
      path: comment.path ?? null,
      line: comment.line ?? comment.original_line ?? null,
    },
  }, { db: options.db, now: options.now ?? Date.now() });
  return { ignored: false, accepted: result.accepted, proposal: result.proposal };
}

async function processChecks(eventName, delivery, payload, store, options, repository) {
  const pullRequestNumber = pullRequestNumberFromCheckPayload(payload);
  if (!pullRequestNumber) return { ignored: true, reason: "check-without-pull-request" };
  const proposal = await store.findByPullRequest(repository, pullRequestNumber, { db: options.db });
  if (!proposal) return { ignored: true, reason: "unmanaged-pull-request" };
  const check = payload.check_run ?? payload.check_suite;
  const result = await store.applyEvent({
    proposalId: proposal.proposalId,
    provider: "github",
    deliveryKey: delivery,
    eventType: `github.${eventName}`,
    action: payload.action,
    actorGithubUserId: payload.sender?.id,
    actorLogin: payload.sender?.login,
    checksState: checksStateFromWebhook(payload),
    headSha: check?.head_sha,
    payload: {
      ...minimalPayload(eventName, payload, pullRequestNumber),
      checkName: payload.check_run?.name ?? null,
      checkStatus: check?.status ?? null,
      checkConclusion: check?.conclusion ?? null,
    },
  }, { db: options.db, now: options.now ?? Date.now() });
  return { ignored: false, accepted: result.accepted, proposal: result.proposal };
}

export async function handle(request, options = {}) {
  if (new URL(request.url).pathname !== WEBHOOK_PATH) {
    return response(404, { error: { code: "NOT_FOUND", message: "Unknown GitHub webhook endpoint." } });
  }
  if (request.method !== "POST") {
    return response(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only POST is supported." } });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    return response(413, { error: { code: "WEBHOOK_TOO_LARGE", message: "GitHub webhook payload is too large." } });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAXIMUM_BODY_BYTES) {
    return response(413, { error: { code: "WEBHOOK_TOO_LARGE", message: "GitHub webhook payload is too large." } });
  }

  const env = options.env ?? {};
  const secret = String(options.secret ?? envValue(env, "HARA_LEARN_GITHUB_WEBHOOK_SECRET"));
  let verified = false;
  try {
    verified = verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), secret);
  } catch {
    return response(503, { error: { code: "WEBHOOK_NOT_CONFIGURED", message: "The GitHub webhook secret is not configured." } });
  }
  if (!verified) return response(401, { error: { code: "WEBHOOK_SIGNATURE_INVALID", message: "GitHub webhook signature is invalid." } });

  const eventName = String(request.headers.get("x-github-event") ?? "").trim();
  const delivery = String(request.headers.get("x-github-delivery") ?? "").trim();
  if (!eventName || !delivery || delivery.length > 240) {
    return response(400, { error: { code: "WEBHOOK_HEADERS_INVALID", message: "GitHub event and delivery headers are required." } });
  }
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { return response(400, { error: { code: "WEBHOOK_JSON_INVALID", message: "GitHub webhook body must be valid JSON." } }); }

  if (eventName === "ping") return response(200, { ok: true, event: "ping" });
  const repository = repositoryFromPayload(payload);
  if (repository !== expectedRepository(options, env)) {
    return response(202, { ok: true, ignored: true, reason: "repository-mismatch" });
  }

  const store = proposalStore(options);
  let result;
  try {
    if (eventName === "pull_request") {
      result = await processPullRequest(eventName, delivery, payload, store, options);
    } else if (eventName === "pull_request_review") {
      result = await processReview(eventName, delivery, payload, store, options);
    } else if (eventName === "pull_request_review_comment") {
      result = await processReviewComment(eventName, delivery, payload, store, options);
    } else if (eventName === "check_run" || eventName === "check_suite") {
      result = await processChecks(eventName, delivery, payload, store, options, repository);
    } else {
      result = { ignored: true, reason: "unsupported-event" };
    }
  } catch (error) {
    console.error("Hara Learn GitHub webhook failed", { eventName, name: error?.name });
    return response(500, { error: { code: "WEBHOOK_PROCESSING_FAILED", message: "The GitHub lifecycle event could not be recorded." } });
  }

  return response(result.ignored ? 202 : 200, { ok: true, event: eventName, ...result });
}

export default async (request) => handle(request);

export const config = {
  path: "/api/github/events",
  method: ["POST"],
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ["domain"],
  },
};
