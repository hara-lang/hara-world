import assert from "node:assert/strict";
import test from "node:test";
import safeCommunityMarkdown, {
  isCommunityDocument,
  sanitizeCommunityMarkdownTree,
} from "../src/lib/safe-community-markdown.mjs";

test("removes raw HTML, active content, images, and unsafe link schemes at render time", () => {
  const tree = { type: "root", children: [
    { type: "raw", value: "<script>alert(1)</script>" },
    { type: "element", tagName: "form", properties: {}, children: [{ type: "text", value: "kept text" }] },
    { type: "element", tagName: "a", properties: { href: "javascript:alert(1)", onclick: "bad" }, children: [{ type: "text", value: "bad link" }] },
    { type: "element", tagName: "img", properties: { src: "https://tracker.example/x", alt: "diagram" }, children: [] },
  ] };
  sanitizeCommunityMarkdownTree(tree);
  assert.equal(tree.children.length, 3);
  assert.deepEqual(tree.children[0], { type: "text", value: "kept text" });
  assert.equal(tree.children[1].tagName, "span");
  assert.deepEqual(tree.children[1].properties, {});
  assert.deepEqual(tree.children[2], { type: "text", value: "[Image: diagram]" });
  assert.doesNotMatch(JSON.stringify(tree), /script|onclick|tracker\.example/);
});

test("allows relative and HTTPS links while marking external user content", () => {
  const tree = { type: "root", children: [
    { type: "element", tagName: "a", properties: { href: "/people" }, children: [{ type: "text", value: "People" }] },
    { type: "element", tagName: "a", properties: { href: "https://example.com/path" }, children: [{ type: "text", value: "Example" }] },
    { type: "element", tagName: "a", properties: { href: "http://example.com" }, children: [{ type: "text", value: "HTTP" }] },
    { type: "element", tagName: "a", properties: { href: "//example.com/path" }, children: [{ type: "text", value: "Protocol relative" }] },
  ] };
  sanitizeCommunityMarkdownTree(tree);
  assert.equal(tree.children[0].properties.href, "/people");
  assert.equal(tree.children[1].properties.href, "https://example.com/path");
  assert.deepEqual(tree.children[1].properties.rel, ["nofollow", "ugc", "noopener", "noreferrer"]);
  assert.equal(tree.children[2].tagName, "span");
  assert.equal(tree.children[3].tagName, "span");
});

test("applies the renderer allowlist to profiles and native community posts only", () => {
  const transform = safeCommunityMarkdown();
  const profileTree = { type: "root", children: [{ type: "raw", value: "<b>unsafe</b>" }] };
  const communityTree = { type: "root", children: [{ type: "raw", value: "<b>unsafe post</b>" }] };
  const editorialTree = { type: "root", children: [{ type: "raw", value: "<b>editorial</b>" }] };
  transform(profileTree, { path: "/repo/content/profiles/chris.md" });
  transform(communityTree, { path: "/repo/content/articles/community/2026/08/6685337-note.md" });
  transform(editorialTree, { path: "/repo/content/articles/2026-08-06-editorial.md" });
  assert.deepEqual(profileTree.children, []);
  assert.deepEqual(communityTree.children, []);
  assert.equal(editorialTree.children.length, 1);
  assert.equal(isCommunityDocument({ data: { astro: { frontmatter: { authorGithubId: "6685337", postType: "note" } } } }), true);
});
