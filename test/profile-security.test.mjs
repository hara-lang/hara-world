import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("protects authenticated profile changes with a read-only pull request workflow", async () => {
  const [workflow, scope, owners] = await Promise.all([
    read(".github/workflows/profile-proposal.yml"),
    read("scripts/validate-profile-pr-scope.mjs"),
    read(".github/CODEOWNERS"),
  ]);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(scope, /profile\/github-/);
  assert.match(scope, /exactly one profile Markdown file/);
  assert.match(scope, /registry\/profiles\.json/);
  assert.match(owners, /content\/profiles\/\*\*/);
  assert.match(owners, /profile-proposal\.mjs/);
});

test("pins renderer sanitisation, active readiness, and endpoint throttling in code", async () => {
  const [astro, readiness, auth, profile] = await Promise.all([
    read("astro.config.mjs"),
    read("netlify/functions/learn-readiness.mjs"),
    read("netlify/functions/learn-auth.mjs"),
    read("netlify/functions/profile-proposal.mjs"),
  ]);
  assert.match(astro, /safeCommunityMarkdown/);
  assert.match(readiness, /to_regclass\('hara_learn\.community_accounts'\)/);
  assert.match(readiness, /pull_requests === "write"/);
  assert.match(auth, /rateLimit/);
  assert.match(profile, /communityAccountStatus/);
  assert.match(profile, /profile\/github-/);
  assert.match(profile, /reused/);
});
