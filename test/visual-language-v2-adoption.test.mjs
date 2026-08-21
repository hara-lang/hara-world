import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const acceptedRevision = "a2ab66d0fde79edb1cee46b79528098b3fda68cf";

test("World pins the accepted merged visual-language revision", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(
    packageJson.dependencies["@hara-lang/visual-language"],
    `github:hara-lang/visual-language#${acceptedRevision}`
  );
});

test("SiteLayout consumes the shared v2 shell, header and context navigation", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");
  for (const value of [
    "astro/v2/Shell.astro",
    "astro/v2/Header.astro",
    "astro/v2/ContextNav.astro",
    "@hara-lang/visual-language/v2.css"
  ]) assert.match(layout, new RegExp(value.replaceAll(".", "\\.")));
  assert.match(layout, /body class="hara-v2 world-product"/);
  assert.match(layout, /section="World"/);
  assert.match(layout, /label="Hara World navigation"/);
});

test("World keeps product-owned primary destinations and visible contribution actions", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");
  assert.match(layout, /\{ href: "\/articles", label: "Feed" \}/);
  assert.match(layout, /\{ href: "\/people", label: "People" \}/);
  assert.match(layout, /\{ href: "\/agents", label: "Agents" \}/);
  assert.match(layout, /\{ href: "\/learn\/koans\/", label: "Learn" \}/);
  assert.match(layout, /\{ href: "\/sources", label: "Sources" \}/);
  assert.match(layout, /href="\/submit">Add a feed<\/a>/);
  assert.match(layout, /class="world-post-action"/);
});

test("feed, registry, lesson and identity endpoints remain represented", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");
  for (const endpoint of [
    "/feed.xml",
    "/feed.json",
    "/sources.opml",
    "/agents.json",
    "/learn/koans/",
    "/me"
  ]) assert.match(layout, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.match(layout, /data-hara-identity/);
  assert.match(layout, /identity-loader\.js/);
});

test("theme behavior delegates to the shared ThemeToggle instead of the old custom three-state icon mutation", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");
  assert.match(layout, /<ThemeToggle label="Theme" \/>/);
  assert.doesNotMatch(layout, /getThemePreference/);
  assert.doesNotMatch(layout, /syncThemeIcon/);
  assert.doesNotMatch(layout, /const icons =/);
});

test("the World mapping preserves focus, compact touch targets, scroll containment and reduced motion", async () => {
  const css = await read("src/styles/v2-adoption.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /scroll-margin-top/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /--hara-v2-[A-Za-z0-9_-]+\s*:/, "World may consume but not redefine protected v2 tokens");
});
