import assert from "node:assert/strict";
import test from "node:test";
import { reviewAccess } from "../netlify/functions/_shared/review-access.mjs";

const IDENTITY = { id: "6685337", login: "zcaudate" };

function base64(source) {
  return { encoding: "base64", content: Buffer.from(source).toString("base64") };
}

test("grants review access from current repository write authority", async () => {
  const calls = [];
  const client = {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    async request(path) {
      calls.push(path);
      return { permission: "maintain" };
    },
  };
  const access = await reviewAccess(IDENTITY, client);
  assert.deepEqual(access, { allowed: true, source: "repository", permission: "maintain", roles: [] });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /collaborators\/zcaudate\/permission/);
});

test("falls back to merged reviewed profile roles when repository permission is absent", async () => {
  const client = {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    async request(path) {
      if (path.includes("/collaborators/")) {
        const error = new Error("Not found");
        error.status = 404;
        throw error;
      }
      if (path.includes("registry/profiles.json")) {
        return base64(JSON.stringify({
          version: 1,
          profiles: [{ githubId: "6685337", githubLogin: "zcaudate", slug: "chris", path: "content/profiles/chris.md" }],
          byGithubId: { "6685337": "chris" },
          bySlug: { chris: "6685337" },
        }));
      }
      if (path.includes("content/profiles/chris.md")) {
        return base64(`---\ngithubId: "6685337"\ngithubLogin: "zcaudate"\ndisplayName: "Chris"\nsummary: "Building Hara."\ninterests: []\nroles: ["editor", "community-member"]\nlinks: []\njoinedAt: "2026-08-01"\npublished: true\n---\n\nProfile.\n`);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const access = await reviewAccess(IDENTITY, client);
  assert.deepEqual(access, { allowed: true, source: "profile-role", permission: null, roles: ["editor"] });
});

test("does not derive review authority from an unreviewed browser claim or ordinary profile role", async () => {
  const client = {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    async request(path) {
      if (path.includes("/collaborators/")) return { permission: "read" };
      if (path.includes("registry/profiles.json")) {
        return base64(JSON.stringify({
          version: 1,
          profiles: [{ githubId: "6685337", githubLogin: "zcaudate", slug: "chris", path: "content/profiles/chris.md" }],
          byGithubId: { "6685337": "chris" },
          bySlug: { chris: "6685337" },
        }));
      }
      if (path.includes("content/profiles/chris.md")) {
        return base64(`---\ngithubId: "6685337"\ngithubLogin: "zcaudate"\ndisplayName: "Chris"\nsummary: "Building Hara."\ninterests: []\nroles: ["community-member"]\nlinks: []\njoinedAt: "2026-08-01"\npublished: true\n---\n\nProfile.\n`);
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const access = await reviewAccess({ ...IDENTITY, roles: ["maintainer"] }, client);
  assert.deepEqual(access, { allowed: false, source: "none", permission: null, roles: [] });
});
