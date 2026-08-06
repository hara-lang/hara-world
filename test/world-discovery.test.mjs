import assert from "node:assert/strict";
import test from "node:test";
import { discoveryPayload } from "../netlify/functions/world-discovery.mjs";

const CONFIGURED = {
  HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
  HARA_WORLD_SESSION_SECRET: "s".repeat(64),
  HARA_WORLD_GITHUB_APP_ID: "12345",
  HARA_WORLD_GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nconfigured\n-----END PRIVATE KEY-----",
  HARA_WORLD_GITHUB_INSTALLATION_ID: "67890",
  DATABASE_URL: "postgresql://example.invalid/world",
};

test("publishes fail-closed World authentication and profile discovery", () => {
  const request = new Request("https://world.hara-lang.org/.well-known/hara-world");
  const missing = discoveryPayload(request, {});
  assert.equal(missing.configured, false);
  assert.equal(missing.authentication.configured, false);
  assert.equal(missing.profiles.configured, false);
  assert.equal(missing.database.configured, false);

  const ready = discoveryPayload(request, CONFIGURED);
  assert.equal(ready.configured, true);
  assert.equal(ready.centralIssuer, "https://id.hara-lang.org");
  assert.equal(ready.authentication.handoffDiscoveryEndpoint, "https://id.hara-lang.org/.well-known/hara-handoff");
  assert.equal(ready.profiles.management, "git-pull-request");
  assert.equal(ready.profiles.publicationBoundary, "merge");
  assert.doesNotMatch(JSON.stringify(ready), /postgresql:\/\/|BEGIN PRIVATE KEY|hhhhhhhh|ssssssss/);
});

test("keeps testing and production issuers isolated", () => {
  const ready = discoveryPayload(new Request("https://world.testing.hara-lang.org/.well-known/hara-world"), CONFIGURED);
  assert.equal(ready.issuer, "https://world.testing.hara-lang.org");
  assert.equal(ready.centralIssuer, "https://id.testing.hara-lang.org");
  assert.equal(ready.authentication.callbackEndpoint, "https://world.testing.hara-lang.org/api/auth/callback");
});
