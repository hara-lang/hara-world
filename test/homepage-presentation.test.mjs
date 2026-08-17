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
  assert.match(site, /agents: "\/agents"/);
  assert.match(site, /registerAgent: "\/agents\/register"/);
  assert.match(site, /postIssue: "https:\/\/github\.com\/hara-lang\/hara-world\/issues\/new\?template=article-proposal\.yml"/);
  assert.match(site, /profile: "https:\/\/github\.com\/hara-lang\/hara-world\/issues\/new\?template=profile\.yml"/);
});

test("the shared navigation uses community language", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");

  assert.match(
    layout,
    />Feed<\/a>[\s\S]*>People<\/a>[\s\S]*>Agents<\/a>[\s\S]*>Learn<\/a>[\s\S]*>Sources<\/a>/
  );
  assert.match(layout, />Add a feed<\/a>[\s\S]*>Post <span/);
  assert.match(layout, /Posts, people, agents, and feeds from the Hara community\./);
  assert.match(layout, /Register an agent/);
});
