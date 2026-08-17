import assert from "node:assert/strict";
import test from "node:test";
import {
  agentForSlug,
  agentIdFor,
  agentOwner,
  agentsForOperator,
  assertAgentIndex,
  updateAgentIndex,
  validateAgentIndex,
} from "../netlify/functions/_shared/agent-index.mjs";

const EMPTY = { version: 1, agents: [], bySlug: {}, byOperator: {} };

test("supports multiple agents per verified operator with deterministic reciprocal lookups", () => {
  const first = updateAgentIndex(EMPTY, { operatorGithubId: "20", operatorGithubLogin: "alice", slug: "atlas" });
  const second = updateAgentIndex(first, { operatorGithubId: "20", operatorGithubLogin: "alice", slug: "scribe" });
  const third = updateAgentIndex(second, { operatorGithubId: "3", operatorGithubLogin: "bob", slug: "relay" });

  assert.deepEqual(third.agents.map((agent) => agent.slug), ["relay", "atlas", "scribe"]);
  assert.equal(agentForSlug(third, "atlas").agentId, "agent:github:20:atlas");
  assert.equal(agentOwner(third, "relay"), "3");
  assert.deepEqual(agentsForOperator(third, "20").map((agent) => agent.slug), ["atlas", "scribe"]);
  assert.deepEqual(third.byOperator, { "3": ["relay"], "20": ["atlas", "scribe"] });
  assert.deepEqual(validateAgentIndex(third).errors, []);
});

test("derives stable agent IDs from the accountable operator and immutable slug", () => {
  assert.equal(agentIdFor("6685337", "work-agent"), "agent:github:6685337:work-agent");
  assert.throws(() => agentIdFor("not-an-id", "work-agent"), /valid operator identity/);
  assert.throws(() => agentIdFor("6685337", "Bad Slug"), /valid operator identity/);
});

test("rejects slug takeover, duplicate identities, and stale lookup maps", () => {
  const first = updateAgentIndex(EMPTY, { operatorGithubId: "6685337", operatorGithubLogin: "zcaudate", slug: "atlas" });
  assert.throws(() => updateAgentIndex(first, { operatorGithubId: "9", operatorGithubLogin: "other", slug: "atlas" }), /already in use/);

  const duplicate = {
    version: 1,
    agents: [
      { agentId: "agent:github:20:atlas", operatorGithubId: "20", operatorGithubLogin: "alice", slug: "atlas", path: "content/agents/atlas.md" },
      { agentId: "agent:github:20:atlas", operatorGithubId: "20", operatorGithubLogin: "alice", slug: "other", path: "content/agents/other.md" },
    ],
    bySlug: { atlas: "agent:github:20:atlas", other: "agent:github:20:atlas" },
    byOperator: { "20": ["atlas", "other"] },
  };
  assert.match(validateAgentIndex(duplicate).errors.join("\n"), /duplicates|agentId must be/);
  assert.throws(() => assertAgentIndex({ ...EMPTY, bySlug: { ghost: "agent:github:1:ghost" } }), /does not match/);
});
