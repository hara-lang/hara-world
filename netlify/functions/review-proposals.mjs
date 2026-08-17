import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { reconcileProposals } from "./_shared/proposal-reconcile.mjs";
import { groupProposalCounts, listReviewProposals } from "./_shared/proposals.mjs";
import { reviewAccess } from "./_shared/review-access.mjs";
import {
  clearWorldSessionCookie,
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const REVIEW_PATH = "/api/review/proposals";
const TERMINAL_STATES = new Set(["merged", "closed", "withdrawn"]);

function error(status, code, message, headers) {
  return json(status, { error: { code, message } }, headers);
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

function reviewStore(options) {
  return options.reviewStore ?? {
    list: listReviewProposals,
  };
}

function inactiveResponse(request, status) {
  return error(403, "WORLD_ACCOUNT_INACTIVE", "This Hara World account is not active.", {
    "Set-Cookie": clearWorldSessionCookie(request.url),
    "X-Hara-World-Account-Status": String(status),
  });
}

export async function handle(request, options = {}) {
  if (new URL(request.url).pathname !== REVIEW_PATH) return error(404, "NOT_FOUND", "Unknown review endpoint.");
  if (!["GET", "POST"].includes(request.method)) return error(405, "METHOD_NOT_ALLOWED", "Only GET and POST are supported.");

  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  const identity = readWorldSession(request, env, now);
  if (!identity) return error(401, "WORLD_SESSION_REQUIRED", "Establish a Hara World session before opening the review queue.");
  if (request.method === "POST" && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "review-reconcile")) {
    return error(403, "REVIEW_REQUEST_REJECTED", "Review reconciliation must come from Hara World.");
  }

  let accountStatus;
  try {
    accountStatus = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id, { db: options.db });
  } catch {
    return error(503, "WORLD_ACCOUNT_CHECK_FAILED", "World could not verify the community account.");
  }
  if (accountStatus !== "active") return inactiveResponse(request, accountStatus);

  let client;
  try { client = await resolveClient(options, env, now); }
  catch { return error(503, "REVIEW_AUTHORITY_UNAVAILABLE", "The GitHub review authority is not configured."); }

  let access;
  try { access = await (options.reviewAccessImpl ?? reviewAccess)(identity, client); }
  catch (cause) {
    console.error("World review access check failed", { name: cause?.name });
    return error(503, "REVIEW_AUTHORITY_UNAVAILABLE", "World could not verify review authority.");
  }
  if (!access.allowed) return error(403, "REVIEW_ACCESS_REQUIRED", "A reviewed World role or repository write permission is required.");

  const store = reviewStore(options);
  let proposals;
  try { proposals = await store.list({ db: options.db, limit: 300 }); }
  catch (cause) {
    console.error("World review queue failed", { name: cause?.name });
    return error(503, "PROPOSAL_LEDGER_UNAVAILABLE", "The proposal lifecycle ledger is not available.");
  }

  if (request.method === "POST") {
    const open = proposals.filter((proposal) => !TERMINAL_STATES.has(proposal.state)).slice(0, 100);
    const reconciled = await (options.reconcileProposalsImpl ?? reconcileProposals)(open, client, {
      proposalStore: options.proposalLifecycleStore,
      db: options.db,
      now,
    });
    try { proposals = await store.list({ db: options.db, limit: 300 }); } catch {}
    return json(200, {
      ok: true,
      reviewer: access,
      reconciled,
      proposals,
      counts: groupProposalCounts(proposals),
    });
  }

  return json(200, {
    ok: true,
    reviewer: access,
    proposals,
    counts: groupProposalCounts(proposals),
  });
}

export default async (request) => handle(request);

export const config = {
  path: "/api/review/proposals",
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
