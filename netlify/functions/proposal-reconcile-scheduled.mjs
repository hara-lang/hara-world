import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { getDatabase } from "./_shared/neon-http.mjs";
import {
  discoverManagedProposals,
  reconcileProposals,
} from "./_shared/proposal-reconcile.mjs";
import { listReviewProposals } from "./_shared/proposals.mjs";

const TERMINAL_STATES = new Set(["merged", "closed", "withdrawn"]);

export async function reconcileScheduledProposals(options = {}) {
  const now = options.now ?? Date.now();
  const db = options.db ?? getDatabase();
  const client = options.githubClient ?? await createGitHubAppClient({
    env: options.env ?? {},
    fetchImpl: options.fetchImpl ?? fetch,
    now,
  });
  const discovered = await (options.discoverManagedProposalsImpl ?? discoverManagedProposals)(client, {
    proposalStore: options.proposalLifecycleStore,
    db,
    now,
  });
  const proposals = await (options.listReviewProposalsImpl ?? listReviewProposals)({ db, limit: 300 });
  const open = proposals.filter((proposal) => !TERMINAL_STATES.has(proposal.state)).slice(0, 200);
  const reconciled = await (options.reconcileProposalsImpl ?? reconcileProposals)(open, client, {
    proposalStore: options.proposalLifecycleStore,
    db,
    now,
  });
  return {
    discovered,
    reconciled,
    discoveredCount: discovered.filter((item) => item.ok).length,
    reconciledCount: reconciled.filter((item) => item.ok).length,
    failureCount: [...discovered, ...reconciled].filter((item) => !item.ok).length,
  };
}

export default async function scheduledProposalReconciliation() {
  try {
    const result = await reconcileScheduledProposals();
    console.log("Hara World proposal reconciliation", {
      discoveredCount: result.discoveredCount,
      reconciledCount: result.reconciledCount,
      failureCount: result.failureCount,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Hara World scheduled proposal reconciliation failed", { name: error?.name });
    return new Response(null, { status: 500 });
  }
}

export const config = {
  schedule: "17 * * * *",
};
