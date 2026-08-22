import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the homepage opens as a community feed rather than an editorial front page", async () => {
  const home = await read("src/pages/index.astro");

  assert.match(home, /See what people are making with Hara\./);
  assert.match(home, /class="community-feed"/);
  assert.match(home, /Who’s using Hara\?/);
  assert.match(home, /Lesson of the day/);
  assert.match(home, /Post something/);
  assert.match(home, /Add your feed/);
  assert.doesNotMatch(home, /independent publication|transmission bands|Release algebra|world-feature/);
});

test("the homepage exposes native posts, syndicated feeds, profiles, and a daily koan", async () => {
  const [home, site] = await Promise.all([
    read("src/pages/index.astro"),
    read("src/lib/site.ts")
  ]);

  assert.match(home, /getCollection\("profiles"/);
  assert.match(home, /data-lesson-widget/);
  assert.match(home, /Date\.UTC\(today\.getFullYear\(\), today\.getMonth\(\), today\.getDate\(\)\)/);
  assert.match(home, /RSS or Atom/);
  assert.match(home, /\/feed\.xml/);
  assert.match(home, /\/feed\.json/);
  assert.match(home, /\/sources\.opml/);
  assert.match(site, /post: "\/post"/);
  assert.match(site, /profile: "\/me"/);
  assert.match(site, /sources: "\/submit"/);
  assert.match(site, /agents: "\/agents"/);
  assert.match(site, /registerAgent: "\/agents\/register"/);
  assert.doesNotMatch(site, /issues\/new\?template/);
});

test("the shared navigation uses community language", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");

  assert.match(layout, /import ContextNav from "@hara-lang\/visual-language\/astro\/v2\/ContextNav\.astro"/);
  assert.match(layout, /const learnNav = \[/);
  assert.match(layout, /\{ href: "\/articles", label: "Feed" \}[\s\S]*?\{ href: "\/people", label: "People" \}[\s\S]*?\{ href: "\/agents", label: "Agents" \}[\s\S]*?\{ href: "\/learn\/koans\/", label: "Learn" \}[\s\S]*?\{ href: "\/sources", label: "Sources" \}/);
  assert.match(layout, /<ContextNav[\s\S]*?items=\{learnNav\}[\s\S]*?label="Hara Learn navigation"/);
  assert.match(layout, /<a href="\/submit">Add a feed<\/a>[\s\S]*?<a class="learn-post-action"/);
  assert.match(layout, /Posts, people, agents, and feeds from the Hara community\./);
  assert.match(layout, /Register an agent/);
});
