import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the first-party composer makes the private-to-public boundary explicit", async () => {
  const page = await read("src/pages/post.astro");
  assert.match(page, /Draft privately/);
  assert.match(page, /\/api\/auth\/start\?returnTo=\/post/);
  assert.match(page, /\/api\/posts/);
  assert.match(page, /X-Hara-Request": "community-post"/);
  assert.match(page, /Save private draft/);
  assert.match(page, /Submit for review/);
  assert.match(page, /Merge publishes/);
  assert.match(page, /Raw HTML, executable links, embeds, and tracking images are not/);
});

test("community post content has verified author fields and a dedicated safety boundary", async () => {
  const [schema, sanitizer] = await Promise.all([
    read("src/content.config.ts"),
    read("src/lib/safe-community-markdown.mjs"),
  ]);
  assert.match(schema, /authorGithubId/);
  assert.match(schema, /authorGithubLogin/);
  assert.match(schema, /postType/);
  assert.match(sanitizer, /content.*articles/);
  assert.match(sanitizer, /community/);
  assert.match(sanitizer, /nofollow/);
  assert.match(sanitizer, /ugc/);
});
