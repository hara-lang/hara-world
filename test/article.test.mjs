import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, serialiseFrontmatter, slugify, stripHtml, stripMarkdown, truncate } from "../scripts/lib/article.mjs";

test("frontmatter round-trips supported article values", () => {
  const data = {
    title: "A precise title",
    draft: false,
    topics: ["hara", "lisp"],
    publishedAt: "2026-08-06T10:00:00+10:00"
  };
  const source = `${serialiseFrontmatter(data)}Body.`;
  const parsed = parseFrontmatter(source);
  assert.deepEqual(parsed.data, data);
  assert.equal(parsed.body, "Body.");
});

test("text normalisation is deterministic", () => {
  assert.equal(slugify("Hara: Lisp, Rebuilt"), "hara-lisp-rebuilt");
  assert.equal(stripHtml("<p>Hello &amp; <strong>world</strong>.</p>"), "Hello & world.");
  assert.equal(stripMarkdown("## Hello\n\nA [link](https://example.com)."), "Hello A link.");
  assert.equal(truncate("one two three four", 13), "one two…");
});
