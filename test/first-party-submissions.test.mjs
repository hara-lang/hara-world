import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("source submission is an on-site authenticated form backed by the World API", async () => {
  const page = await read("src/pages/submit.astro");
  assert.match(page, /<form class="source-form"/);
  assert.match(page, /\/api\/sources\/probe/);
  assert.match(page, /\/api\/sources/);
  assert.match(page, /X-Hara-Request": "source-proposal"/);
  assert.match(page, /X-Hara-Request": "source-probe"/);
  assert.match(page, /returnTo=\/submit/);
  assert.doesNotMatch(page, /issues\/new\?template|Open a source submission/);
});

test("profile calls-to-action stay on Hara World and use the existing profile API form", async () => {
  const [people, site, me, home] = await Promise.all([
    read("src/pages/people/index.astro"),
    read("src/lib/site.ts"),
    read("src/pages/me.astro"),
    read("src/pages/index.astro"),
  ]);
  assert.match(people, /href="\/me"/);
  assert.doesNotMatch(people, /issues\/new\?template=profile/);
  assert.match(site, /profile: "\/me"/);
  assert.doesNotMatch(site, /issues\/new\?template/);
  assert.match(me, /fetch\("\/api\/profile"/);
  assert.match(home, /href=\{SITE\.profile\}/);
});

test("World discovery advertises the first-party source proposal and probe endpoints", async () => {
  const discovery = await read("netlify/functions/world-discovery.mjs");
  assert.match(discovery, /sources: \{/);
  assert.match(discovery, /endpoint: `\$\{issuer\}\/api\/sources`/);
  assert.match(discovery, /probeEndpoint: `\$\{issuer\}\/api\/sources\/probe`/);
  assert.match(discovery, /management: "git-pull-request"/);
  assert.match(discovery, /publicationBoundary: "merge"/);
});
