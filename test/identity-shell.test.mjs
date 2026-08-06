import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("World mounts central Identity and clears stale local sessions", async () => {
  const [layout, loader, sync] = await Promise.all([
    read("src/layouts/SiteLayout.astro"),
    read("public/identity-loader.js"),
    read("public/world-session-sync.js"),
  ]);
  assert.match(layout, /<div data-hara-identity><\/div>/);
  assert.match(layout, /src="\/identity-loader\.js"/);
  assert.match(loader, /https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(loader, /https:\/\/id\.hara-lang\.org/);
  assert.match(loader, /\/world-session-sync\.js/);
  assert.match(loader, /\/identity-client\.js/);
  assert.match(sync, /hara:identity-change/);
  assert.match(sync, /\/api\/auth\/session/);
  assert.match(sync, /localId === centralId/);
  assert.match(sync, /\/api\/auth\/logout/);
  assert.match(sync, /central-sign-out/);
  assert.doesNotMatch([loader, sync].join("\n"), /HARA_GITHUB_OAUTH_CLIENT_SECRET|HARA_AUTH_SESSION_SECRET|HARA_WORLD_SESSION_SECRET|client_secret/i);
});

test("the account page uses the trusted World session for profile proposals", async () => {
  const accountPage = await read("src/pages/me.astro");
  assert.match(accountPage, /\/api\/auth\/start\?returnTo=\/me/);
  assert.match(accountPage, /fetch\("\/api\/auth\/session"/);
  assert.match(accountPage, /fetch\("\/api\/profile"/);
  assert.match(accountPage, /Open draft profile PR/);
  assert.match(accountPage, /stored in Git history/);
  assert.doesNotMatch(accountPage, /name="githubId"|name="githubLogin"|name="roles"/);
  assert.doesNotMatch(accountPage, /HARA_WORLD_HANDOFF_SECRET|HARA_WORLD_SESSION_SECRET|HARA_WORLD_GITHUB_APP_PRIVATE_KEY/);
});
