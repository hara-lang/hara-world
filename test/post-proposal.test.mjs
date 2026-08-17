import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPostDocument,
  normalizePostDraft,
  postContentSha256,
  postProposalBranch,
  postProposalPath,
  postPullRequestBody,
} from "../netlify/functions/_shared/post-proposal.mjs";
import { createOrUpdatePostPullRequest } from "../netlify/functions/posts.mjs";

const NOW = Date.parse("2026-08-17T08:30:00Z");
const IDENTITY = {
  id: "6685337",
  login: "zcaudate",
  name: "Chris Zheng",
};
const DRAFT = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "small-hara-agent",
  postType: "showcase",
  title: "Building a small agent with Hara",
  description: "A working note on tools, state, and the embedded REPL.",
  topics: ["Hara", "language runtimes", "hara"],
  body: "## The experiment\n\n```clojure\n(+ 1 2)\n```",
  submittedAt: null,
  proposalBranch: null,
  proposalPath: null,
};

function fakeClient({ branchExists = false, existingPull = null, pathExists = false } = {}) {
  const calls = [];
  let hasBranch = branchExists;
  return {
    repository: "hara-lang/hara-world",
    baseBranch: "main",
    installationPermissions: { contents: "write", pull_requests: "write" },
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-world/contents/content/articles/community/") && options.method !== "PUT") {
        if (pathExists) return { sha: "b".repeat(40) };
        const error = new Error("Not found"); error.status = 404; throw error;
      }
      if (path === "/repos/hara-lang/hara-world/git/ref/heads/main") return { object: { sha: "a".repeat(40) } };
      if (path.includes("/git/ref/heads/post/github-6685337/1111111111114111")) {
        if (!hasBranch) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { object: { sha: "c".repeat(40) };
      }
      if (path === "/repos/hara-lang/hara-world/git/refs" && options.method === "POST") {
        hasBranch = true;
        return { ref: options.body.ref };
      }
      if (path.includes("/git/refs/heads/post/github-6685337/1111111111114111") && options.method === "PATCH") {
        return { object: { sha: options.body.sha } };
      }
      if (options.method === "PUT" && path.includes("/contents/content/articles/community/")) {
        return { content: { sha: "d".repeat(40) } };
      }
      if (path.startsWith("/repos/hara-lang/hara-world/pulls?")) return existingPull ? [existingPull] : [];
      if (path === "/repos/hara-lang/hara-world/pulls" && options.method === "POST") {
        return { number: 91, html_url: "https://github.com/hara-lang/hara-world/pull/91" };
      }
      if (existingPull && path === `/repos/hara-lang/hara-world/pulls/${existingPull.number}` && options.method === "PATCH") {
        return { ...existingPull, html_url: existingPull.html_url };
      }
      throw new Error(`Unexpected GitHub request: ${path} ${options.method || "GET"}`);
    },
  };
}

test("normalises a community post and builds deterministic server-owned frontmatter", () => {
  const normalized = normalizePostDraft({ ...DRAFT, authorGithubId: "999", author: "Attacker" });
  assert.deepEqual(normalized.topics, ["hara", "language-runtimes"]);
  const document = buildPostDocument({ identity: IDENTITY, draft: normalized, submittedAt: NOW });
  assert.match(document, /author: "Chris Zheng"/);
  assert.match(document, /authorGithubId: "6685337"/);
  assert.match(document, /authorGithubLogin: "zcaudate"/);
  assert.match(document, /postType: "showcase"/);
  assert.match(document, /social: false/);
  assert.doesNotMatch(document, /Attacker|authorGithubId: "999"/);
  assert.equal(postContentSha256(normalized), postContentSha256({ ...normalized, topics: ["hara", "language-runtimes"] }));
});

test("derives stable branch and publication paths from verified identity and draft ID", () => {
  assert.equal(postProposalBranch(IDENTITY, DRAFT.id), "post/github-6685337/1111111111114111");
  assert.equal(
    postProposalPath(IDENTITY, DRAFT, NOW),
    "content/articles/community/2026/08/6685337-small-hara-agent.md",
  );
  const body = postPullRequestBody({ identity: IDENTITY, draft: DRAFT, draftId: DRAFT.id });
  assert.match(body, /hara-world-post:draft:11111111-1111-4111-8111-111111111111/);
  assert.match(body, /hara-world-author:github:6685337/);
  assert.match(body, /Merge remains the publication event/);
});

test("rejects executable Markdown and raw HTML before proposal creation", () => {
  assert.throws(() => normalizePostDraft({ ...DRAFT, body: "<script>alert(1)</script>" }), /raw HTML/);
  assert.throws(() => normalizePostDraft({ ...DRAFT, body: "[run](javascript:alert(1))" }), /unsafe link/);
  assert.throws(() => normalizePostDraft({ ...DRAFT, postType: "advertisement" }), /Post type/);
});

test("creates one draft PR with deterministic Markdown and reuses an existing proposal", async () => {
  const client = fakeClient();
  const result = await createOrUpdatePostPullRequest(client, { identity: IDENTITY, draft: DRAFT, now: NOW });
  assert.equal(result.number, 91);
  assert.equal(result.reused, false);
  assert.equal(result.path, "content/articles/community/2026/08/6685337-small-hara-agent.md");
  const put = client.calls.find((call) => call.options.method === "PUT");
  const document = Buffer.from(put.options.body.content, "base64").toString("utf8");
  assert.match(document, /publishedAt: "2026-08-17T08:30:00.000Z"/);
  assert.match(document, /## The experiment/);
  const pull = client.calls.find((call) => call.path.endsWith("/pulls") && call.options.method === "POST");
  assert.equal(pull.options.body.draft, true);
  assert.equal(pull.options.body.head, result.branch);

  const existingPull = {
    number: 27,
    html_url: "https://github.com/hara-lang/hara-world/pull/27",
    body: "<!-- hara-world-post-proposal -->",
  };
  const reusedClient = fakeClient({ branchExists: true, existingPull });
  const reused = await createOrUpdatePostPullRequest(reusedClient, {
    identity: IDENTITY,
    draft: { ...DRAFT, proposalBranch: result.branch, proposalPath: result.path, submittedAt: result.submittedAt },
    now: NOW + 10_000,
  });
  assert.equal(reused.number, 27);
  assert.equal(reused.reused, true);
  assert.ok(reusedClient.calls.some((call) => call.path.endsWith("/pulls/27") && call.options.method === "PATCH"));
  assert.equal(reusedClient.calls.some((call) => call.path.endsWith("/pulls") && call.options.method === "POST"), false);
});

test("refuses to overwrite an existing canonical community path", async () => {
  await assert.rejects(
    createOrUpdatePostPullRequest(fakeClient({ pathExists: true }), { identity: IDENTITY, draft: DRAFT, now: NOW }),
    /already uses this community post path/,
  );
});
