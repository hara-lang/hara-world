import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("World mounts the shared Hara identity client without owning OAuth", async () => {
  const [layout, loader] = await Promise.all([
    read("src/layouts/SiteLayout.astro"),
    read("public/identity-loader.js"),
  ]);

  assert.match(layout, /<div data-hara-identity><\/div>/);
  assert.match(layout, /src="\/identity-loader\.js"/);
  assert.match(layout, /href="\/me"/);

  assert.match(loader, /https:\/\/id\.testing\.hara-lang\.org/);
  assert.match(loader, /https:\/\/id\.hara-lang\.org/);
  assert.match(loader, /\/identity-client\.js/);
  assert.match(loader, /endsWith\("\.testing\.hara-lang\.org"\)/);

  assert.doesNotMatch(loader, /HARA_GITHUB_OAUTH_CLIENT_SECRET/);
  assert.doesNotMatch(loader, /HARA_AUTH_SESSION_SECRET/);
  assert.doesNotMatch(loader, /client_secret/i);
  assert.doesNotMatch(loader, /client_id/i);
});

test("the first World account page remains read-only", async () => {
  const accountPage = await read("src/pages/me.astro");

  assert.match(accountPage, /hara:identity-change/);
  assert.match(accountPage, /HaraIdentity\?\.refresh/);
  assert.match(accountPage, /display only/i);
  assert.match(accountPage, /No profile, comment, follow, or submission mutation/);
  assert.match(accountPage, /newsletter email/i);

  assert.doesNotMatch(accountPage, /<form/i);
  assert.doesNotMatch(accountPage, /method=["']post/i);
  assert.doesNotMatch(accountPage, /fetch\s*\(/);
});
