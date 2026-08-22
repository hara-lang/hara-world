import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const acceptedRevision = "b512a12e8d7191c9092d195ca0ddc894b0ba54d2";

const componentPaths = [
  "src/components/learn-home/LearnArrival.astro",
  "src/components/learn-home/LearnFirstLesson.astro",
  "src/components/learn-home/LearnPaths.astro",
  "src/components/learn-home/LearnCommunity.astro",
  "src/components/learn-home/LearnStart.astro"
];

test("the homepage is a definition-first Hara Learn application rather than a legacy community landing page", async () => {
  const [home, ...components] = await Promise.all([
    read("src/pages/index.astro"),
    ...componentPaths.map(read)
  ]);
  const composition = `${home}\n${components.join("\n")}`;

  for (const component of [
    "LearnArrival",
    "LearnFirstLesson",
    "LearnPaths",
    "LearnCommunity",
    "LearnStart"
  ]) {
    assert.match(home, new RegExp(`<${component}`));
  }

  assert.match(home, /class="learn-home"/);
  assert.match(composition, /Learn Hara by reading and changing small programs\./);
  assert.match(composition, /New to programming/);
  assert.match(composition, /Programmed before/);
  assert.match(composition, /Familiar with Lisp/);
  assert.match(composition, /Source, expectation, and execution boundary remain adjacent\./);
  assert.match(composition, /Learning continues through maintained work and public discussion\./);

  for (const legacyClass of [
    /class="community-intro/,
    /class="community-summary/,
    /class="community-widget/,
    /class="hero-actions/,
    /class="button(?:\s|")/,
    /class="callout(?:\s|")/,
    /class="feed-entry/,
    /class="lesson-widget/
  ]) {
    assert.doesNotMatch(composition, legacyClass);
  }
});

test("the homepage derives lessons, paths, articles, and people from canonical production collections", async () => {
  const [home, arrival, firstLesson, paths, community, site] = await Promise.all([
    read("src/pages/index.astro"),
    read(componentPaths[0]),
    read(componentPaths[1]),
    read(componentPaths[2]),
    read(componentPaths[3]),
    read("src/lib/site.ts")
  ]);

  assert.match(home, /await getArticles\(\)/);
  assert.match(home, /getCollection\("profiles", \(\{ data \}\) => data\.published\)/);
  assert.match(home, /const dailyLesson = KOANS\[buildDay % KOANS\.length\]/);
  assert.match(home, /lessonBySlug\("first-value"\)/);
  assert.match(home, /lessonBySlug\("double-it"\)/);
  assert.match(home, /lessonBySlug\("threaded-data"\)/);
  assert.match(home, /KOANS\.filter\(\(lesson\) => definition\.topics\.includes\(lesson\.topic\)\)/);
  assert.match(arrival, /koanCount/);
  assert.match(firstLesson, /lesson\.starter/);
  assert.match(firstLesson, /lesson\.tests\[0\]/);
  assert.match(firstLesson, /No inferred execution result is shown/);
  assert.doesNotMatch(firstLesson, /data-run|mountLiveCard|createLiveKernel/);
  assert.match(paths, /lessonCount/);
  assert.match(community, /articlePath\(article\)/);
  assert.match(community, /kindLabels\[article\.data\.kind\]/);
  assert.match(community, /profile\.data\.githubLogin/);

  for (const route of [
    /href="\/articles"/,
    /href="\/people"/,
    /href="\/agents"/,
    /href="\/submit"/,
    /href="\/feed\.xml"/,
    /href="\/feed\.json"/,
    /href="\/sources\.opml"/
  ]) {
    assert.match(community, route);
  }

  assert.match(site, /post: "\/post"/);
  assert.match(site, /profile: "\/me"/);
  assert.match(site, /sources: "\/submit"/);
  assert.match(site, /agents: "\/agents"/);
  assert.match(site, /registerAgent: "\/agents\/register"/);
  assert.doesNotMatch(site, /issues\/new\?template/);
});

test("the shared navigation presents learning and community destinations without duplicating the application shell", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");

  assert.match(layout, /import Shell from "@hara-lang\/visual-language\/astro\/v2\/Shell\.astro"/);
  assert.match(layout, /import ContextNav from "@hara-lang\/visual-language\/astro\/v2\/ContextNav\.astro"/);
  assert.match(layout, /\{ href: "\/articles", label: "Feed" \}[\s\S]*?\{ href: "\/people", label: "People" \}[\s\S]*?\{ href: "\/agents", label: "Agents" \}[\s\S]*?\{ href: "\/learn\/koans\/", label: "Koans" \}[\s\S]*?\{ href: "\/sources", label: "Sources" \}/);
  assert.match(layout, /<ContextNav[\s\S]*?items=\{learnNav\}[\s\S]*?label="Hara Learn navigation"/);
  assert.match(layout, /<a href="\/submit">Add a feed<\/a>[\s\S]*?<a class="learn-post-action"/);
  assert.match(layout, /Lessons, posts, people, agents, and feeds from the Hara community\./);
  assert.equal((layout.match(/<main\b/g) ?? []).length, 0, "the shared Shell must remain the only main-landmark owner");
});

test("the homepage composition consumes v2 tokens and preserves responsive, focus, touch, overflow, and reduced-motion rules", async () => {
  const [home, styles, bridge] = await Promise.all([
    read("src/pages/index.astro"),
    read("src/styles/learn-home-v2.css"),
    read("src/styles/v2-adoption.css")
  ]);

  assert.match(home, /@hara-lang\/visual-language\/v2-icons\.css/);
  assert.match(home, /styles\/learn-home-v2\.css/);
  for (const selector of [
    ".learn-home-arrival",
    ".learn-home-ledger",
    ".learn-home-entrance-grid",
    ".learn-home-lesson-record",
    ".learn-home-path-grid",
    ".learn-home-community-grid",
    ".learn-home-syndication-record",
    ".learn-home-start-grid",
    ".learn-home-state-grid",
    ".learn-home-closing"
  ]) {
    assert.match(styles, new RegExp(selector.replaceAll(".", "\\.")));
  }

  assert.match(styles, /var\(--hara-v2-/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(bridge, /min-height:\s*44px/);
  assert.match(styles, /overflow-x:\s*auto|overflow:\s*auto/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(bridge, /:focus-visible/);
  assert.doesNotMatch(`${styles}\n${bridge}`, /--hara(?:-v2)?-[a-z0-9-]+\s*:/i, "Learn may consume but not redefine protected Hara tokens");
});

test("the exact Visual Language Learn contract is pinned, available, and documented", async () => {
  const [packageJson, contract, adoption] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("node_modules/@hara-lang/visual-language/V2-LEARN.md"),
    read("VISUAL-LANGUAGE-V2-ADOPTION.md")
  ]);

  assert.equal(
    packageJson.dependencies["@hara-lang/visual-language"],
    `github:hara-lang/visual-language#${acceptedRevision}`
  );
  assert.match(contract, /new to programming/i);
  assert.match(contract, /programmed before/i);
  assert.match(contract, /familiar with Lisp/i);
  assert.match(contract, /anonymous/i);
  assert.match(adoption, new RegExp(acceptedRevision));
  assert.match(adoption, /V2-LEARN\.md/);
  assert.match(adoption, /static-first/i);
  assert.match(adoption, /getArticles\(\)/);
  assert.match(adoption, /Follow-on work/i);
});
