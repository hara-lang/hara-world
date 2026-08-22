import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("source submission is an on-site authenticated form backed by the Learn API", async () => {
  const page = await read("src/pages/submit.astro");
  assert.match(page, /<form class="source-form"/);
  assert.match(page, /\/api\/sources\/probe/);
  assert.match(page, /\/api\/sources/);
  assert.match(page, /X-Hara-Request": "source-proposal"/);
  assert.match(page, /X-Hara-Request": "source-probe"/);
  assert.match(page, /returnTo=\/submit/);
  assert.doesNotMatch(page, /issues\/new\?template|Open a source submission/);
});

test("profile calls-to-action stay on Hara Learn and use the existing profile API form", async () => {
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
  assert.match(me, /api\("\/api\/profile"/);
  assert.match(me, /X-Hara-Request": "profile-proposal"/);
  assert.match(home, /href=\{SITE\.profile\}/);
});

test("Learn discovery advertises the first-party source proposal and probe endpoints", async () => {
  const discovery = await read("netlify/functions/learn-discovery.mjs");
  assert.match(discovery, /sources: \{/);
  assert.match(discovery, /endpoint: `\$\{issuer\}\/api\/sources`/);
  assert.match(discovery, /probeEndpoint: `\$\{issuer\}\/api\/sources\/probe`/);
  assert.match(discovery, /management: "git-pull-request"/);
  assert.match(discovery, /publicationBoundary: "merge"/);
});

test("authenticated source proposals have a read-only scope workflow and explicit code owners", async () => {
  const [workflow, scope, owners] = await Promise.all([
    read(".github/workflows/source-proposal.yml"),
    read("scripts/validate-source-pr-scope.mjs"),
    read(".github/CODEOWNERS"),
  ]);
  assert.match(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /source-registry\/github-/);
  assert.match(scope, /may change only registry\/sources\.json/);
  assert.match(scope, /cannot change reviewer-controlled activation status/);
  assert.match(scope, /cannot change reviewer-controlled polling policy/);
  assert.match(scope, /hara-learn-source-proposal/);
  assert.match(owners, /netlify\/functions\/source-proposal\.mjs/);
  assert.match(owners, /netlify\/functions\/_shared\/feed-probe\.mjs/);
  assert.match(owners, /registry\/sources\.json/);
  assert.match(owners, /source-proposal\.yml/);
});
