import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import { createGitHubAppClient } from "./_shared/github-app.mjs";
import {
  discoverManagedProposals,
  reconcileProposals,
} from "./_shared/proposal-reconcile.mjs";
import {
  groupProposalCounts,
  listProposalsForOwner,
} from "./_shared/proposals.mjs";
import {
  clearWorldSessionCookie,
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const PROPOSALS_PATH = "/api/proposals";
const RECONCILE_PATH = "/api/proposals/reconcile";
const TERMINAL_STATES = new Set(["merged", "closed", "withdrawn"]);

function error(status, code, message, headers) {
  return json(status, { error: { code, message } }, headers);
}

function proposalStore(options) {
  return options.proposalStore ?? {
    listForOwner: listProposalsForOwner,
  };
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

function inactiveResponse(request, status) {
  return error(403, "WORLD_ACCOUNT_INACTIVE", "This Hara World account is not active.", {
    "Set-Cookie": clearWorldSessionCookie(request.url),
    "X-Hara-World-Account-Status": String(status),
  });
}

export async function handle(request, options = {}) {
  const path = new URL(request.url).pathname;
  if (![PROPOSALS_PATH, RECONCILE_PATH].includes(path)) {
    return error(404, "NOT_FOUND", "Unknown proposal endpoint.");
  }
  if ((path === PROPOSALS_PATH && request.method !== "GET") || (path === RECONCILE_PATH && request.method !== "POST")) {
    return error(405, "METHOD_NOT_ALLOWED", "Unsupported proposal operation.");
  }

  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  const identity = readWorldSession(request, env, now);
  if (!identity) return error(401, "WORLD_SESSION_REQUIRED", "Establish a Hara World session before viewing proposal activity.");
  if (request.method === "POST" && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "proposal-reconcile")) {
    return error(403, "PROPOSAL_REQUEST_REJECTED", "Proposal reconciliation must come from Hara World.");
  }

  let accountStatus;
  try {
    accountStatus = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id, { db: options.db });
  } catch {
    return error(503, "WORLD_ACCOUNT_CHECK_FAILED", "World could not verify the community account.");
  }
  if (accountStatus !== "active") return inactiveResponse(request, accountStatus);

  const store = proposalStore(options);
  let proposals;
  try {
    proposals = await store.listForOwner(identity.id, { db: options.db, limit: 200 });
  } catch (cause) {
    console.error("World proposal list failed", { name: cause?.name });
    return error(503, "PROPOSAL_LEDGER_UNAVAILABLE", "The proposal lifecycle ledger is not available.");
  }

  if (request.method === "GET") {
    return json(200, {
      ok: true,
      proposals,
      counts: groupProposalCounts(proposals),
    });
  }

  let client;
  try { client = await resolveClient(options, env, now); }
  catch { return error(503, "PROPOSAL_RECONCILER_UNAVAILABLE", "The GitHub proposal reconciler is not configured."); }

  let discovered;
  try {
    discovered = await (options.discoverManagedProposalsImpl ?? discoverManagedProposals)(client, {
      ownerGithubUserId: identity.id,
      proposalStore: options.proposalLifecycleStore,
      db: options.db,
      now,
    });
  } catch (cause) {
    discovered = [{
      ok: false,
      error: {
        code: "PROPOSAL_DISCOVERY_FAILED",
        message: cause?.message || "Managed pull requests could not be discovered.",
      },
    }];
  }

  try { proposals = await store.listForOwner(identity.id, { db: options.db, limit: 200 }); } catch {}
  const open = proposals.filter((proposal) => !TERMINAL_STATES.has(proposal.state)).slice(0, 50);
  const reconciled = await (options.reconcileProposalsImpl ?? reconcileProposals)(open, client, {
    proposalStore: options.proposalLifecycleStore,
    db: options.db,
    now,
  });
  let refreshed = proposals;
  try { refreshed = await store.listForOwner(identity.id, { db: options.db, limit: 200 }); } catch {}
  return json(200, {
    ok: true,
    discovered,
    reconciled,
    proposals: refreshed,
    counts: groupProposalCounts(refreshed),
  });
}

export default async (request) => handle(request);

export const config = {
  path: ["/api/proposals", "/api/proposals/reconcile"],
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
