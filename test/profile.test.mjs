import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("profiles remain Git-reviewed content keyed by stable GitHub identity", async () => {
  const [config, index, page, migration] = await Promise.all([
    read("src/content.config.ts"),
    read("src/pages/people/index.astro"),
    read("src/pages/people/[...id].astro"),
    read("database/migrations/002_community_accounts.sql"),
  ]);
  assert.match(config, /const profiles = defineCollection/);
  assert.match(config, /githubId/);
  assert.match(index, /getCollection\("profiles"/);
  assert.match(page, /github:\{profile\.data\.githubId\}/);
  assert.match(migration, /github_user_id bigint PRIMARY KEY/);
  assert.doesNotMatch(migration, /UNIQUE[\s\S]*github_login|community_accounts_github_login_key/);
});

test("profile editing trusts only the World session and creates a reviewable Git change", async () => {
  const [accountPage, endpoint, proposal, github] = await Promise.all([
    read("src/pages/me.astro"),
    read("netlify/functions/profile-proposal.mjs"),
    read("netlify/functions/_shared/profile-proposal.mjs"),
    read("netlify/functions/_shared/github-app.mjs"),
  ]);
  assert.match(accountPage, /<form class="profile-form"/);
  assert.match(accountPage, /\/api\/auth\/start\?returnTo=\/me/);
  assert.match(accountPage, /X-Hara-Request": "profile-proposal"/);
  assert.doesNotMatch(accountPage, /name="githubId"|name="githubLogin"|name="roles"/);
  assert.match(endpoint, /readWorldSession/);
  assert.match(endpoint, /draft:\s*true/);
  assert.match(endpoint, /Existing reviewed roles and links are preserved/);
  assert.match(proposal, /Profile biography cannot contain raw HTML/);
  assert.match(proposal, /unsafe link target/);
  assert.match(github, /app\/installations/);
  assert.doesNotMatch([accountPage, endpoint].join("\n"), /HARA_WORLD_GITHUB_APP_PRIVATE_KEY|HARA_WORLD_SESSION_SECRET\s*=/);
});
