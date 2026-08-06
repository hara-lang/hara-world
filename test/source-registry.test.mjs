import test from "node:test";
import assert from "node:assert/strict";
import { validateRegistry } from "../scripts/lib/source-registry.mjs";

test("accepts an empty versioned registry", () => {
  assert.deepEqual(validateRegistry({ version: 1, sources: [] }), []);
});

test("requires permission metadata before activation", () => {
  const errors = validateRegistry({
    version: 1,
    sources: [{
      id: "example",
      name: "Example",
      homepage: "https://example.com",
      feed: "https://example.com/feed.xml",
      status: "active",
      syndication: "excerpt",
      permission: "authorised",
      topics: ["hara"]
    }]
  });
  assert.ok(errors.some((error) => error.includes("contact is required")));
});

test("rejects insecure and duplicate feeds", () => {
  const source = {
    id: "one",
    name: "One",
    homepage: "https://example.com",
    feed: "http://example.com/feed.xml",
    status: "proposed",
    syndication: "link",
    permission: "owner",
    topics: ["lisp"]
  };
  const errors = validateRegistry({ version: 1, sources: [source, { ...source, id: "two" }] });
  assert.ok(errors.some((error) => error.includes("must use HTTPS")));
  assert.ok(errors.some((error) => error.includes("duplicates another source")));
});
