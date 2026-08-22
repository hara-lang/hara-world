import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Learn has isolated testing and production Netlify deployments", async () => {
  const workflow = await read(".github/workflows/pages.yml");

  assert.match(workflow, /branches: \[main, testing\]/);
  assert.match(workflow, /github\.ref_name == 'testing'[\s\S]*NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /github\.ref_name == 'main'[\s\S]*NETLIFY_PRODUCTION_SITE_ID/);
  assert.doesNotMatch(workflow, /pull_request\.title|\[deploy\]/);
  assert.match(workflow, /NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /NETLIFY_PRODUCTION_SITE_ID/);
  assert.match(workflow, /learn\.testing\.hara-lang\.org/);
  assert.match(workflow, /learn\.hara-lang\.org/);
  assert.match(workflow, /world\.testing\.hara-lang\.org/);
  assert.match(workflow, /world\.hara-lang\.org/);
  assert.match(workflow, /netlify-cli deploy --build --prod/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /verify-learn-site\.sh/);
});

test("Learn deployment verification proves Identity, proposal lifecycle readiness, and front-channel logout", async () => {
  const verifier = await read(".github/scripts/verify-learn-site.sh");

  assert.match(verifier, /\.well-known\/hara-session/);
  assert.match(verifier, /\.allowedOrigins/);
  assert.match(verifier, /\.configured == true/);
  assert.match(verifier, /My Learn/);
  assert.match(verifier, /Your proposal activity/);
  assert.match(verifier, /Review the Learn/);
  assert.match(verifier, /identity-client\.js/);
  assert.match(verifier, /\.well-known\/hara-learn-readiness/);
  assert.match(verifier, /\.ready == true/);
  assert.match(verifier, /github-proposal-webhook/);
  assert.match(verifier, /proposals\.reconcileEndpoint/);
  assert.match(verifier, /api\/proposals/);
  assert.match(verifier, /api\/review\/proposals/);
  assert.match(verifier, /api\/github\/events/);
  assert.match(verifier, /accountStatusEnforced/);
  assert.match(verifier, /frontChannelLogout/);
  assert.match(verifier, /hara_learn_session=;/);
  assert.match(verifier, /LEARN_SESSION_REQUIRED/);
  assert.doesNotMatch(verifier, /WORLD_SESSION_REQUIRED|REQUIRE_WORLD_AUTH_CONFIGURED/);
  assert.doesNotMatch(verifier, /HARA_GITHUB_OAUTH_CLIENT_SECRET/);
  assert.doesNotMatch(verifier, /HARA_AUTH_SESSION_SECRET/);
  assert.doesNotMatch(verifier, /HARA_LEARN_SESSION_SECRET/);
  assert.doesNotMatch(verifier, /HARA_LEARN_GITHUB_WEBHOOK_SECRET/);
});
