import assert from "node:assert/strict";
import test from "node:test";
import { reconcileScheduledProposals } from "../netlify/functions/proposal-reconcile-scheduled.mjs";

function proposal(state, number) {
  return {
    proposalId: `proposal:post:${String(number).padStart(24, "0")}`,
    proposalType: "post",
    ownerGithubUserId: "6685337",
    resourceKey: `draft-${number}`,
    resourceTitle: `Proposal ${number}`,
    repository: "hara-lang/hara-world",
    pullRequestNumber: number,
    state,
  };
}

test("hourly repair discovers missing rows and reconciles only non-terminal proposals", async () => {
  const calls = [];
  const result = await reconcileScheduledProposals({
    db: { name: "db" },
    githubClient: { repository: "hara-lang/hara-world", baseBranch: "main", async request() {} },
    discoverManagedProposalsImpl: async (_client, options) => {
      calls.push(["discover", options.db.name]);
      return [{ ok: true, proposal: proposal("submitted", 1) }, { ok: false, error: { code: "BROKEN" } }];
    },
    listReviewProposalsImpl: async ({ limit }) => {
      calls.push(["list", limit]);
      return [
        proposal("submitted", 1),
        proposal("approved", 2),
        proposal("merged", 3),
        proposal("closed", 4),
        proposal("withdrawn", 5),
      ];
    },
    reconcileProposalsImpl: async (items, _client, options) => {
      calls.push(["reconcile", items.map((item) => item.pullRequestNumber), options.db.name]);
      return items.map((item) => ({ ok: item.pullRequestNumber !== 2, proposal: item }));
    },
  });

  assert.deepEqual(calls, [
    ["discover", "db"],
    ["list", 300],
    ["reconcile", [1, 2], "db"],
  ]);
  assert.equal(result.discoveredCount, 1);
  assert.equal(result.reconciledCount, 1);
  assert.equal(result.failureCount, 2);
});
