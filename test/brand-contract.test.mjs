import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const retiredWorldPalette = [
  "#ecebe4",
  "#f7f5ef",
  "#e2e2d9",
  "#17211c",
  "#3d755d",
  "#8eae9d",
  "#07100b",
  "#08120d",
  "#0d1a13",
  "#14251b",
  "#78b394",
  "#a2c5b3"
];

test("inherits protected Hara colour tokens instead of redefining them locally", async () => {
  const styleDirectory = new URL("../src/styles/", import.meta.url);
  const styleNames = (await readdir(styleDirectory)).filter((name) => name.endsWith(".css"));
  const styles = (await Promise.all(styleNames.map((name) => read(`src/styles/${name}`)))).join("\n");
  const base = await read("src/styles/base.css");

  assert.match(base, /^@import "@hara-lang\/visual-language\/tokens\.css";/);
  assert.match(base, /:root\s*{\s*--world-on-signal:\s*#fff;/);

  const protectedDeclarations = [...styles.matchAll(/(--hara-[a-z0-9-]+)\s*:/gi)]
    .map((match) => match[1]);
  assert.deepEqual(
    protectedDeclarations,
    [],
    `World CSS must not redefine protected Hara tokens: ${protectedDeclarations.join(", ")}`
  );

  const lowered = styles.toLowerCase();
  for (const colour of retiredWorldPalette) {
    assert.ok(!lowered.includes(colour), `retired World palette colour ${colour} must not return`);
  }
});

test("keeps browser chrome aligned with the shared light and dark surfaces", async () => {
  const layout = await read("src/layouts/SiteLayout.astro");

  assert.match(layout, /theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)"/);
  assert.match(layout, /theme-color" content="#050608" media="\(prefers-color-scheme: dark\)"/);
  assert.doesNotMatch(layout, /#f7f5ef|#08120d/);
});

test("pins the visual language and gates site and content releases", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const dependency = packageJson.dependencies["@hara-lang/visual-language"];

  assert.match(
    dependency,
    /^github:hara-lang\/visual-language#[0-9a-f]{40}$/,
    "World must consume an immutable visual-language commit"
  );
  assert.equal(packageJson.scripts["brand:check"], "node --test test/brand-contract.test.mjs");
  assert.match(packageJson.scripts.prebuild, /npm run brand:check/);
  assert.match(packageJson.scripts["release:build"], /npm run brand:check/);
});

test("publishes the favicon supplied by the pinned visual language", async () => {
  const [localFavicon, canonicalFavicon] = await Promise.all([
    read("public/favicon.svg"),
    read("node_modules/@hara-lang/visual-language/assets/hara-logo.svg")
  ]);

  assert.equal(
    localFavicon.trim(),
    canonicalFavicon.trim(),
    "World favicon must remain byte-identical to the pinned Hara brand asset"
  );
});
