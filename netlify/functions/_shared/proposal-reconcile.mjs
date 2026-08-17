import {
  checksStateFromRuns,
  proposalDescriptorFromPullRequest,
  pullRequestLifecycle,
  reviewStateFromReviews,
} from "./github-proposals.mjs";
import { applyProposalLifecycleEvent } from "./proposals.mjs";

function stateFromPullAndReview(pullLifecycle, reviewState) {
  if (["merged", "closed"].includes(pullLifecycle.state)) return pullLifecycle.state;
  if (reviewState === "changes-requested") return "changes-requested";
  if (reviewState === "approved") return "approved";
  return "submitted";
}

function reconciliationKey(proposal, pull, reviewState, checksState) {
  const parts = [
    proposal.repository,
    proposal.pullRequestNumber,
    pull.updated_at ?? "",
    pull.state ?? "",
    pull.merged_at ?? "",
    pull.draft === true ? "draft" : "ready",
    reviewState,
    checksState,
  ];
  return `proposal:${parts.join(":")}`.slice(0, 240);
}

async function optionalGitHubRead(operation, fallback) {
  try {
    return await operation();
  } catch (error) {
    if ([403, 404].includes(error?.status)) return fallback;
    throw error;
  }
}

export async function reconcileProposal(proposal, client, {
  proposalStore,
  db,
  now = Date.now(),
} = {}) {
  if (!proposal?.pullRequestNumber || !proposal?.repository) throw new TypeError("A recorded proposal is required for reconciliation.");
  if (!client?.repository || typeof client.request !== "function") throw new TypeError("A GitHub App client is required for reconciliation.");
  if (proposal.repository !== client.repository) throw new Error("Proposal repository does not match the configured GitHub App repository.");

  const pull = await client.request(`/repos/${client.repository}/pulls/${proposal.pullRequestNumber}`);
  const descriptor = proposalDescriptorFromPullRequest(pull);
  if (!descriptor
    || descriptor.proposalType !== proposal.proposalType
    || descriptor.resourceKey !== proposal.resourceKey
    || descriptor.ownerGithubUserId !== proposal.ownerGithubUserId) {
    throw new Error("Pull-request proposal markers do not match the recorded lifecycle owner and resource.");
  }

  const [reviewsPayload, checksPayload] = await Promise.all([
    optionalGitHubRead(
      () => client.request(`/repos/${client.repository}/pulls/${proposal.pullRequestNumber}/reviews?per_page=100`),
      [],
    ),
    pull.head?.sha
      ? optionalGitHubRead(
          () => client.request(`/repos/${client.repository}/commits/${pull.head.sha}/check-runs?per_page=100`),
          { check_runs: [] },
        )
      : Promise.resolve({ check_runs: [] }),
  ]);
  const reviewState = reviewStateFromReviews(reviewsPayload);
  const checksState = checksStateFromRuns(checksPayload?.check_runs);
  const pullLifecycle = pullRequestLifecycle(pull, "reconcile");
  const state = stateFromPullAndReview(pullLifecycle, reviewState);
  const apply = proposalStore?.applyEvent ?? applyProposalLifecycleEvent;
  const result = await apply({
    proposalId: proposal.proposalId,
    provider: "reconcile",
    deliveryKey: reconciliationKey(proposal, pull, reviewState, checksState),
    eventType: "proposal.reconciled",
    action: "reconcile",
    state,
    reviewState,
    checksState,
    headSha: pull.head?.sha,
    isDraft: pull.draft === true,
    mergedAt: pullLifecycle.mergedAt,
    closedAt: pullLifecycle.closedAt,
    payload: {
      repository: proposal.repository,
      pullRequestNumber: proposal.pullRequestNumber,
      pullUpdatedAt: pull.updated_at ?? null,
      reviewCount: Array.isArray(reviewsPayload) ? reviewsPayload.length : 0,
      checkCount: Array.isArray(checksPayload?.check_runs) ? checksPayload.check_runs.length : 0,
    },
  }, { db, now });
  return result.proposal ?? proposal;
}

export async function reconcileProposals(proposals, client, options = {}) {
  const output = [];
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    try {
      output.push({ ok: true, proposal: await reconcileProposal(proposal, client, options) });
    } catch (error) {
      output.push({
        ok: false,
        proposal,
        error: {
          code: "PROPOSAL_RECONCILE_FAILED",
          message: error?.message || "The proposal could not be reconciled.",
        },
      });
    }
  }
  return output;
}
