import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Learn mounts central Identity in popup mode and clears stale local sessions", async () => {
  const [layout, loader, sync] = await Promise.all([
    read("src/layouts/SiteLayout.astro"),
    read("public/identity-loader.js"),
    read("public/learn-session-sync.js"),
  ]);
  assert.match(layout, /<div data-hara-identity><\/div>/);
  assert.match(layout, /src="\/identity-loader\.js"/);
  assert.match(loader, /meta\[name="hara-identity-mode"\]/);
  assert.match(loader, /mode\.content = "popup"/);
  assert.match(loader, /https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(loader, /https:\/\/id\.hara-lang\.org/);
  assert.match(loader, /\/learn-session-sync\.js/);
  assert.match(loader, /\/identity-client\.js/);
  assert.match(sync, /hara:identity-change/);
  assert.match(sync, /\/api\/auth\/session/);
  assert.match(sync, /localId === centralId/);
  assert.match(sync, /\/api\/auth\/logout/);
  assert.match(sync, /central-sign-out/);
  assert.doesNotMatch([loader, sync].join("\n"), /HARA_GITHUB_OAUTH_CLIENT_SECRET|HARA_AUTH_SESSION_SECRET|HARA_LEARN_SESSION_SECRET|client_secret/i);
});

test("My Learn uses the trusted local session for profile and lifecycle proposals", async () => {
  const accountPage = await read("src/pages/me.astro");
  assert.match(accountPage, /\/api\/auth\/start\?returnTo=\/me/);
  assert.match(accountPage, /fetch\("\/api\/auth\/session"/);
  assert.match(accountPage, /api\("\/api\/profile"/);
  assert.match(accountPage, /"\/api\/proposals\/reconcile"\s*:\s*"\/api\/proposals"/);
  assert.match(accountPage, /Submit profile for review/);
  assert.match(accountPage, /stored in Git history/);
  assert.match(accountPage, /X-Hara-Request": "profile-proposal"/);
  assert.doesNotMatch(accountPage, /name="githubId"|name="githubLogin"|name="roles"/);
  assert.doesNotMatch(accountPage, /HARA_LEARN_HANDOFF_SECRET|HARA_LEARN_SESSION_SECRET|HARA_LEARN_GITHUB_APP_PRIVATE_KEY|HARA_LEARN_GITHUB_WEBHOOK_SECRET/);
});
