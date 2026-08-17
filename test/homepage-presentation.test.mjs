import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the homepage opens as a publication rather than a distribution dashboard", async () => {
  const home = await read("src/pages/index.astro");

  assert.match(home, /Notes from a programmable world\./);
  assert.match(home, /class="world-feature"/);
  assert.match(home, /Browse all dispatches/);
  assert.doesNotMatch(home, /hero-console|Canonical|Outbox|Social projections/);
});

test("the shared shell follows the Hara ecosystem order and keeps World navigation focused", async () => {
  const [layout, site] = await Promise.all([
    read("src/layouts/SiteLayout.astro"),
    read("src/lib/site.ts")
  ]);

  assert.match(
    layout,
    />Home<\/a>[\s\S]*aria-current="page">World<\/a>[\s\S]*>Specs<\/a>[\s\S]*>Packages<\/a>[\s\S]*>Identity<\/a>/
  );
  assert.match(layout, /class="section-nav__primary"/);
  assert.match(layout, /class="section-nav__secondary"/);
  assert.match(site, /packages: "https:\/\/packages\.hara-lang\.org\/"/);
  assert.match(site, /identity: "https:\/\/id\.hara-lang\.org\/"/);
});
