import test from "node:test";
import assert from "node:assert/strict";
import { validateRegistry } from "../scripts/lib/source-registry.mjs";

const VALID = {
  id: "example",
  name: "Example",
  homepage: "https://example.com/",
  feed: "https://example.com/feed.xml",
  status: "proposed",
  syndication: "excerpt",
  permission: "owner",
  contact: "https://example.com/contact",
  topics: ["hara"],
  relevance: "Publishes material about Hara and Lisp runtimes.",
  registrantGithubId: "6685337",
  registrantGithubLogin: "zcaudate",
  registeredAt: "2026-08-17",
  updatedAt: "2026-08-17",
};

test("accepts an empty versioned registry", () => {
  assert.deepEqual(validateRegistry({ version: 1, sources: [] }), []);
});

test("accepts a reviewed proposal carrying relevance and accountable registrant identity", () => {
  assert.deepEqual(validateRegistry({ version: 1, sources: [VALID] }), []);
});

test("requires permission metadata before activation", () => {
  const errors = validateRegistry({
    version: 1,
    sources: [{ ...VALID, status: "active", contact: undefined }],
  });
  assert.ok(errors.some((error) => error.includes("contact is required")));
});

test("rejects insecure and duplicate feeds", () => {
  const source = { ...VALID, id: "one", feed: "http://example.com/feed.xml" };
  const errors = validateRegistry({ version: 1, sources: [source, { ...source, id: "two" }] });
  assert.ok(errors.some((error) => error.includes("must use HTTPS")));
  assert.ok(errors.some((error) => error.includes("duplicates another source")));
});

test("requires reciprocal registrant identity and a public HTTPS contact URL", () => {
  const missingLogin = validateRegistry({
    version: 1,
    sources: [{ ...VALID, registrantGithubLogin: undefined }],
  });
  assert.ok(missingLogin.some((error) => error.includes("both registrantGithubId and registrantGithubLogin")));

  const privateContact = validateRegistry({
    version: 1,
    sources: [{ ...VALID, contact: "mailto:owner@example.com" }],
  });
  assert.ok(privateContact.some((error) => error.includes("contact must use HTTPS")));
});

test("validates source dates, language tags, topics, and relevance", () => {
  const errors = validateRegistry({
    version: 1,
    sources: [{
      ...VALID,
      language: "not a language tag!",
      registeredAt: "17 August 2026",
      topics: [],
      relevance: "",
    }],
  });
  assert.ok(errors.some((error) => error.includes("language is invalid")));
  assert.ok(errors.some((error) => error.includes("registeredAt must use YYYY-MM-DD")));
  assert.ok(errors.some((error) => error.includes("between one and twelve topics")));
  assert.ok(errors.some((error) => error.includes("relevance")));
});
