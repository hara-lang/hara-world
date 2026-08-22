import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handle } from "../netlify/functions/posts.mjs";
import { LEARN_SESSION_COOKIE, signLearnSession } from "../netlify/functions/_shared/learn-auth.mjs";

const NOW = Date.parse("2026-08-17T08:30:00Z");
const ENV = {
  HARA_LEARN_HANDOFF_SECRET: "h".repeat(64),
  HARA_LEARN_SESSION_SECRET: "s".repeat(64),
  HARA_LEARN_SITE: "https://learn.hara-lang.org",
};
const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  id: "6685337",
  login: "zcaudate",
  name: "Chris Zheng",
};
const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const INPUT = {
  slug: "small-hara-agent",
  postType: "showcase",
  title: "Building a small agent with Hara",
  description: "A working note on tools, state, and the embedded REPL.",
  topics: ["hara", "agents", "repl"],
  body: "## The experiment\n\nA small result.",
};
const DRAFT = {
  id: DRAFT_ID,
  githubUserId: IDENTITY.id,
  ...INPUT,
  status: "draft",
  contentSha256: "c".repeat(64),
  proposalContentSha256: null,
  proposalBranch: null,
  proposalPath: null,
  pullRequestNumber: null,
  pullRequestUrl: null,
  baseSha: null,
  submittedAt: null,
  mergedAt: null,
  withdrawnAt: null,
  revision: 1,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
};

function sessionCookie() {
  const token = signLearnSession(IDENTITY, ENV.HARA_LEARN_SESSION_SECRET, {
    issuer: "https://learn.hara-lang.org",
    now: NOW,
  });
  return `${LEARN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function request(path, { method = "GET", body, origin = "https://learn.hara-lang.org", requestHeader = true } = {}) {
  return new Request(`https://learn.hara-lang.org${path}`, {
    method,
    headers: {
      Cookie: sessionCookie(),
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(requestHeader && method !== "GET" ? { "X-Hara-Request": "community-post" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function store(overrides = {}) {
  return {
    async list() { return [DRAFT]; },
    async get() { return DRAFT; },
    async create(identity, input) { return { ...DRAFT, githubUserId: identity.id, ...input }; },
    async update(identity, id, input) { return { ...DRAFT, id, githubUserId: identity.id, ...input, revision: 2 }; },
    async delete() { return true; },
    async markError() { return DRAFT; },
    async markSubmitted(identity, id, proposal) {
      return {
        ...DRAFT,
        id,
        githubUserId: identity.id,
        status: "submitted",
        proposalBranch: proposal.branch,
        proposalPath: proposal.path,
        pullRequestNumber: proposal.number,
        pullRequestUrl: proposal.pullRequestUrl,
        proposalContentSha256: proposal.contentSha256,
      };
    },
    async markWithdrawn() { return { ...DRAFT, status: "withdrawn" }; },
    ...overrides,
  };
}

function githubClient() {
  const calls = [];
  let branchExists = false;
  return {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    installationPermissions: { contents: "write", pull_requests: "write" },
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-learn/contents/content/articles/community/") && options.method !== "PUT") {
        const error = new Error("Not found"); error.status = 404; throw error;
      }
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/main") return { object: { sha: "a".repeat(40) } };
      if (path.includes("/git/ref/heads/post/github-6685337/1111111111114111")) {
        if (!branchExists) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { object: { sha: "b".repeat(40) } };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs" && options.method === "POST") {
        branchExists = true;
        return { ref: options.body.ref };
      }
      if (options.method === "PUT" && path.includes("/contents/content/articles/community/")) return { content: { sha: "d".repeat(40) } };
      if (path.startsWith("/repos/hara-lang/hara-learn/pulls?")) return [];
      if (path === "/repos/hara-lang/hara-learn/pulls" && options.method === "POST") {
        return { number: 92, html_url: "https://github.com/hara-lang/hara-learn/pull/92" };
      }
      throw new Error(`Unexpected GitHub request: ${path} ${options.method || "GET"}`);
    },
  };
}

test("requires an active audience-bound Learn session and same-origin mutation", async () => {
  const unauthenticated = await handle(new Request("https://learn.hara-lang.org/api/posts"), {
    env: ENV,
    now: NOW,
    postStore: store(),
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(unauthenticated.status, 401);

  const inactive = await handle(request("/api/posts"), {
    env: ENV,
    now: NOW,
    postStore: store(),
    communityAccountStatusImpl: async () => "suspended",
  });
  assert.equal(inactive.status, 403);
  assert.match(inactive.headers.get("set-cookie"), new RegExp(`${LEARN_SESSION_COOKIE}=;`));

  const crossOrigin = await handle(request("/api/posts", { method: "POST", body: INPUT, origin: "https://evil.example" }), {
    env: ENV,
    now: NOW,
    postStore: store(),
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(crossOrigin.status, 403);
});

test("creates private drafts with server-verified ownership rather than browser identity", async () => {
  let observedIdentity;
  const postStore = store({
    async create(identity, input) {
      observedIdentity = identity;
      return { ...DRAFT, ...input, githubUserId: identity.id };
    },
  });
  const response = await handle(request("/api/posts", {
    method: "POST",
    body: { ...INPUT, githubUserId: "999", authorGithubLogin: "attacker" },
  }), {
    env: ENV,
    now: NOW,
    postStore,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 201);
  assert.equal(observedIdentity.id, "6685337");
  assert.equal(observedIdentity.login, "zcaudate");
  const body = await response.json();
  assert.equal(body.draft.githubUserId, "6685337");
});

test("submits one private draft through the GitHub App and records its proposal", async () => {
  const client = githubClient();
  let recordedProposal;
  const postStore = store({
    async markSubmitted(identity, id, proposal) {
      recordedProposal = proposal;
      return { ...DRAFT, id, status: "submitted", pullRequestNumber: proposal.number, pullRequestUrl: proposal.pullRequestUrl };
    },
  });
  const response = await handle(request(`/api/posts/${DRAFT_ID}/submit`, { method: "POST" }), {
    env: ENV,
    now: NOW,
    postStore,
    githubClient: client,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.proposal.number, 92);
  assert.equal(body.stateRecorded, true);
  assert.equal(recordedProposal.path, "content/articles/community/2026/08/6685337-small-hara-agent.md");
  const put = client.calls.find((call) => call.options.method === "PUT");
  const document = Buffer.from(put.options.body.content, "base64").toString("utf8");
  assert.match(document, /authorGithubId: "6685337"/);
  assert.doesNotMatch(document, /999|attacker/);
});

test("the database migration keeps private drafts separate from public Markdown", async () => {
  const migration = await readFile(new URL("../database/migrations/004_community_posts.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hara_learn\.community_post_drafts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hara_learn\.community_post_events/);
  assert.match(migration, /REFERENCES hara_learn\.community_accounts/);
  assert.match(migration, /proposal_content_sha256/);
  assert.doesNotMatch(migration, /article_body|published_articles|public_feed/);
});
