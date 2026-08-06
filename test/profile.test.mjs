import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("profiles are Git-reviewed content keyed by stable GitHub identity", async () => {
  const [config, index, page, issue] = await Promise.all([
    read("src/content.config.ts"),
    read("src/pages/people/index.astro"),
    read("src/pages/people/[...id].astro"),
    read(".github/ISSUE_TEMPLATE/profile.yml"),
  ]);

  assert.match(config, /const profiles = defineCollection/);
  assert.match(config, /githubId/);
  assert.match(config, /githubLogin/);
  assert.match(config, /published/);
  assert.match(index, /getCollection\("profiles"/);
  assert.match(index, /Submit a profile/);
  assert.match(page, /github:\{profile\.data\.githubId\}/);
  assert.match(page, /profile\.data\.roles/);
  assert.match(issue, /Stable numeric GitHub user ID/);
  assert.match(issue, /stored publicly in Git history/);
});

test("the first profile system does not introduce browser-trusted mutation", async () => {
  const files = [
    await read("src/pages/people/index.astro"),
    await read("src/pages/people/[...id].astro"),
  ].join("\n");

  assert.doesNotMatch(files, /method=["']post/i);
  assert.doesNotMatch(files, /fetch\s*\(/);
  assert.doesNotMatch(files, /HARA_AUTH_SESSION_SECRET/);
  assert.doesNotMatch(files, /HARA_GITHUB_OAUTH_CLIENT_SECRET/);
});
