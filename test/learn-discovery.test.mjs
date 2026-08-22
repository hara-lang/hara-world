import assert from "node:assert/strict";
import test from "node:test";
import { discoveryPayload } from "../netlify/functions/learn-discovery.mjs";

const CONFIGURED = {
  HARA_LEARN_HANDOFF_SECRET: "h".repeat(64),
  HARA_LEARN_SESSION_SECRET: "s".repeat(64),
  HARA_LEARN_GITHUB_APP_ID: "12345",
  HARA_LEARN_GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nconfigured\n-----END PRIVATE KEY-----",
  HARA_LEARN_GITHUB_INSTALLATION_ID: "67890",
  HARA_LEARN_GITHUB_WEBHOOK_SECRET: "w".repeat(64),
  DATABASE_URL: "postgresql://example.invalid/world",
};

test("publishes fail-closed discovery and points operators to active readiness", () => {
  const request = new Request("https://learn.hara-lang.org/.well-known/hara-learn");
  const missing = discoveryPayload(request, {});
  assert.equal(missing.configured, false);
  assert.equal(missing.authentication.configured, false);
  assert.equal(missing.profiles.configured, false);
  assert.equal(missing.sources.configured, false);
  assert.equal(missing.proposals.configured, false);
  assert.equal(missing.proposals.webhookConfigured, false);
  assert.equal(missing.database.configured, false);

  const ready = discoveryPayload(request, CONFIGURED);
  assert.equal(ready.configured, true);
  assert.equal(ready.readinessEndpoint, "https://learn.hara-lang.org/.well-known/hara-learn-readiness");
  assert.equal(ready.authentication.accountStatusEnforced, true);
  assert.equal(ready.authentication.frontChannelLogout, true);
  assert.equal(ready.profiles.index, "registry/profiles.json");
  assert.equal(ready.profiles.editor, "https://learn.hara-lang.org/me#profile");
  assert.equal(ready.profiles.oneOpenProposalPerIdentity, true);
  assert.equal(ready.sources.endpoint, "https://learn.hara-lang.org/api/sources");
  assert.equal(ready.sources.probeEndpoint, "https://learn.hara-lang.org/api/sources/probe");
  assert.equal(ready.sources.form, "https://learn.hara-lang.org/submit");
  assert.equal(ready.sources.activationBoundary, "reviewed-status-change");
  assert.equal(ready.sources.networkPolicy, "public-https-only");
  assert.equal(ready.proposals.configured, true);
  assert.equal(ready.proposals.dashboard, "https://learn.hara-lang.org/me");
  assert.equal(ready.proposals.endpoint, "https://learn.hara-lang.org/api/proposals");
  assert.equal(ready.proposals.reconcileEndpoint, "https://learn.hara-lang.org/api/proposals/reconcile");
  assert.equal(ready.proposals.reviewQueue, "https://learn.hara-lang.org/review");
  assert.equal(ready.proposals.reviewEndpoint, "https://learn.hara-lang.org/api/review/proposals");
  assert.equal(ready.proposals.webhookEndpoint, "https://learn.hara-lang.org/api/github/events");
  assert.equal(ready.proposals.deliveryDeduplication, true);
  assert.equal(ready.proposals.reconciliationFallback, true);
  assert.doesNotMatch(JSON.stringify(ready), /postgresql:\/\/|BEGIN PRIVATE KEY|hhhhhhhh|ssssssss|wwwwwwww/);
});

test("keeps testing and production issuers and proposal endpoints isolated", () => {
  const ready = discoveryPayload(new Request("https://learn.testing.hara-lang.org/.well-known/hara-learn"), CONFIGURED);
  assert.equal(ready.issuer, "https://learn.testing.hara-lang.org");
  assert.equal(ready.centralIssuer, "https://id.testing.hara-lang.org");
  assert.equal(ready.authentication.callbackEndpoint, "https://learn.testing.hara-lang.org/api/auth/callback");
  assert.equal(ready.sources.form, "https://learn.testing.hara-lang.org/submit");
  assert.equal(ready.proposals.dashboard, "https://learn.testing.hara-lang.org/me");
  assert.equal(ready.proposals.webhookEndpoint, "https://learn.testing.hara-lang.org/api/github/events");
});
