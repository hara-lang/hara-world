import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("World has isolated testing and production Netlify deployments", async () => {
  const workflow = await read(".github/workflows/pages.yml");

  assert.match(workflow, /branches: \[main, testing\]/);
  assert.match(workflow, /github\.ref_name == 'testing'[\s\S]*NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /github\.ref_name == 'main'[\s\S]*NETLIFY_PRODUCTION_SITE_ID/);
  assert.doesNotMatch(workflow, /pull_request\.title|\[deploy\]/);
  assert.match(workflow, /NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /NETLIFY_PRODUCTION_SITE_ID/);
  assert.match(workflow, /world\.testing\.hara-lang\.org/);
  assert.match(workflow, /world\.hara-lang\.org/);
  assert.match(workflow, /netlify-cli deploy --build --prod/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /verify-world-site\.sh/);
});

test("World deployment verification proves Identity, readiness, and front-channel logout", async () => {
  const verifier = await read(".github/scripts/verify-world-site.sh");

  assert.match(verifier, /\.well-known\/hara-session/);
  assert.match(verifier, /\.allowedOrigins/);
  assert.match(verifier, /\.configured == true/);
  assert.match(verifier, /Your Hara World account/);
  assert.match(verifier, /identity-client\.js/);
  assert.match(verifier, /\.well-known\/hara-world-readiness/);
  assert.match(verifier, /\.ready == true/);
  assert.match(verifier, /accountStatusEnforced/);
  assert.match(verifier, /frontChannelLogout/);
  assert.match(verifier, /hara_world_session=;/);
  assert.doesNotMatch(verifier, /HARA_GITHUB_OAUTH_CLIENT_SECRET/);
  assert.doesNotMatch(verifier, /HARA_AUTH_SESSION_SECRET/);
  assert.doesNotMatch(verifier, /HARA_WORLD_SESSION_SECRET/);
});
