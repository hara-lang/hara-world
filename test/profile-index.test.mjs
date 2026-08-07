import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProfileIndex,
  profileForIdentity,
  profileOwner,
  updateProfileIndex,
  validateProfileIndex,
} from "../netlify/functions/_shared/profile-index.mjs";

const EMPTY = { version: 1, profiles: [], byGithubId: {}, bySlug: {} };

test("builds reciprocal deterministic lookups", () => {
  const first = updateProfileIndex(EMPTY, { githubId: "20", githubLogin: "alice", slug: "alice" });
  const second = updateProfileIndex(first, { githubId: "3", githubLogin: "bob", slug: "bob" });
  assert.deepEqual(second.profiles.map((profile) => profile.githubId), ["3", "20"]);
  assert.equal(profileForIdentity(second, "20").slug, "alice");
  assert.equal(profileOwner(second, "bob"), "3");
  assert.deepEqual(validateProfileIndex(second).errors, []);
});

test("rejects duplicate identities, duplicate slugs, and stale lookup maps", () => {
  const duplicate = {
    version: 1,
    profiles: [
      { githubId: "20", githubLogin: "alice", slug: "alice", path: "content/profiles/alice.md" },
      { githubId: "20", githubLogin: "other", slug: "other", path: "content/profiles/other.md" },
    ],
    byGithubId: { "20": "other" },
    bySlug: { alice: "20", other: "20" },
  };
  assert.match(validateProfileIndex(duplicate).errors.join("\n"), /duplicates/);
  assert.throws(() => assertProfileIndex({ ...EMPTY, byGithubId: { "1": "ghost" } }), /does not match/);
});

test("does not allow slug reassignment after publication", () => {
  const first = updateProfileIndex(EMPTY, { githubId: "6685337", githubLogin: "zcaudate", slug: "chris-zheng" });
  assert.throws(() => updateProfileIndex(first, { githubId: "9", githubLogin: "other", slug: "chris-zheng" }), /already in use/);
  assert.throws(() => updateProfileIndex(first, { githubId: "6685337", githubLogin: "zcaudate", slug: "renamed" }), /cannot be changed/);
});
