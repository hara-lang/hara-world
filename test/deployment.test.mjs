import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("World has isolated testing and production Netlify deployments", async () => {
  const workflow = await read(".github/workflows/pages.yml");

  assert.match(workflow, /branches: \[main, production\]/);
  assert.match(workflow, /NETLIFY_TESTING_SITE_ID/);
  assert.match(workflow, /NETLIFY_PRODUCTION_SITE_ID/);
  assert.match(workflow, /world\.testing\.hara-lang\.org/);
  assert.match(workflow, /world\.hara-lang\.org/);
  assert.match(workflow, /netlify-cli deploy --build --prod/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /verify-world-site\.sh/);
});

test("World deployment verification requires the matching Identity issuer", async () => {
  const verifier = await read(".github/scripts/verify-world-site.sh");

  assert.match(verifier, /\.well-known\/hara-session/);
  assert.match(verifier, /\.allowedOrigins/);
  assert.match(verifier, /\.configured == true/);
  assert.match(verifier, /Your Hara identity/);
  assert.match(verifier, /identity-client\.js/);
  assert.doesNotMatch(verifier, /HARA_GITHUB_OAUTH_CLIENT_SECRET/);
  assert.doesNotMatch(verifier, /HARA_AUTH_SESSION_SECRET/);
});
