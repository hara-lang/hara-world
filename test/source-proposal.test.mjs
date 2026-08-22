import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSourceProposal,
  sourceForId,
  updateSourceRegistry,
} from "../netlify/functions/_shared/source-proposal.mjs";
import { LEARN_SESSION_COOKIE, signLearnSession } from "../netlify/functions/_shared/learn-auth.mjs";
import { handle } from "../netlify/functions/source-proposal.mjs";

const ENV = {
  HARA_LEARN_HANDOFF_SECRET: "h".repeat(64),
  HARA_LEARN_SESSION_SECRET: "s".repeat(64),
  HARA_LEARN_SITE: "https://learn.hara-lang.org",
};
const NOW = Date.parse("2026-08-17T12:00:00Z");
const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  id: "6685337",
  login: "zcaudate",
  name: "Chris Zheng",
  avatarUrl: "https://avatars.githubusercontent.com/u/6685337?v=4",
  profileUrl: "https://github.com/zcaudate",
};
const EMPTY_REGISTRY = { version: 1, sources: [] };
const INPUT = {
  id: "example-journal",
  name: "Example Lisp Journal",
  homepage: "https://example.com/",
  feed: "https://feeds.example.com/rss.xml",
  contact: "https://example.com/contact",
  permission: "owner",
  syndication: "excerpt",
  license: "",
  defaultAuthor: "Example Editors",
  language: "en-AU",
  topics: ["hara", "lisp"],
  relevance: "Publishes practical work on Hara, Lisp runtimes, and language tooling.",
  consent: true,
};
const PREVIEW = {
  requestedUrl: INPUT.feed,
  finalUrl: "https://feeds.example.com/canonical.xml",
  contentType: "application/rss+xml",
  format: "rss",
  title: "Example Lisp Journal",
  homepage: "https://example.com/",
  language: "en-AU",
  author: "Example Editors",
  entryCount: 2,
  entries: [
    { title: "First", url: "https://example.com/first", publishedAt: "2026-08-17", author: "Editor" },
    { title: "Second", url: "https://example.com/second", publishedAt: "2026-08-16", author: "Editor" },
  ],
};

function sessionCookie() {
  const token = signLearnSession(IDENTITY, ENV.HARA_LEARN_SESSION_SECRET, {
    issuer: "https://learn.hara-lang.org",
    now: NOW,
  });
  return `${LEARN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function existingSource() {
  return {
    id: "example-journal",
    name: "Example Lisp Journal",
    homepage: "https://example.com/",
    feed: PREVIEW.finalUrl,
    status: "active",
    syndication: "excerpt",
    permission: "owner",
    defaultAuthor: "Example Editors",
    contact: "https://example.com/contact",
    topics: ["hara", "lisp"],
    language: "en-AU",
    maxItemsPerRun: 7,
    relevance: INPUT.relevance,
    registrantGithubId: "6685337",
    registrantGithubLogin: "zcaudate",
    registeredAt: "2026-08-01",
    updatedAt: "2026-08-01",
  };
}

function fakeClient({ source = null, existingPull = null } = {}) {
  const calls = [];
  const registry = { version: 1, sources: source ? [source] : [] };
  let branchExists = Boolean(existingPull);
  return {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    installationPermissions: { contents: "write", pull_requests: "write" },
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-learn/contents/registry/sources.json?")) {
        return {
          encoding: "base64",
          content: Buffer.from(`${JSON.stringify(registry, null, 2)}\n`).toString("base64"),
          sha: "registry-sha",
        };
      }
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/main") return { object: { sha: "base-sha" } };
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/source-registry/github-6685337/example-journal") {
        if (!branchExists) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { object: { sha: "proposal-sha" } };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs" && options.method === "POST") {
        branchExists = true;
        return { ref: options.body.ref };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs/heads/source-registry/github-6685337/example-journal" && options.method === "PATCH") {
        return { object: { sha: options.body.sha } };
      }
      if (path.endsWith("/contents/registry/sources.json") && options.method === "PUT") return { content: { sha: "next-registry-sha" } };
      if (path.startsWith("/repos/hara-lang/hara-learn/pulls?")) return existingPull ? [existingPull] : [];
      if (path === "/repos/hara-lang/hara-learn/pulls" && options.method === "POST") {
        return { number: 61, html_url: "https://github.com/hara-lang/hara-learn/pull/61" };
      }
      if (existingPull && path === `/repos/hara-lang/hara-learn/pulls/${existingPull.number}` && options.method === "PATCH") {
        return { ...existingPull, html_url: existingPull.html_url };
      }
      throw new Error(`Unexpected GitHub request: ${path} ${options.method || "GET"}`);
    },
  };
}

function request(path = "/api/sources", body = INPUT, marker = "source-proposal") {
  return new Request(`https://learn.hara-lang.org${path}`, {
    method: "POST",
    headers: {
      Cookie: sessionCookie(),
      Origin: "https://learn.hara-lang.org",
      "Content-Type": "application/json",
      "X-Hara-Request": marker,
    },
    body: JSON.stringify(body),
  });
}

test("normalises proposal fields and derives registrant authority from the Learn session", () => {
  const proposal = normalizeSourceProposal({
    ...INPUT,
    registrantGithubId: "999",
    registrantGithubLogin: "attacker",
    status: "active",
    maxItemsPerRun: 20,
  });
  const updated = updateSourceRegistry(EMPTY_REGISTRY, {
    identity: IDENTITY,
    proposal,
    feedUrl: PREVIEW.finalUrl,
    now: NOW,
  });
  const source = sourceForId(updated.registry, "example-journal");
  assert.equal(source.status, "proposed");
  assert.equal(source.feed, PREVIEW.finalUrl);
  assert.equal(source.registrantGithubId, "6685337");
  assert.equal(source.registrantGithubLogin, "zcaudate");
  assert.equal(source.maxItemsPerRun, undefined);
  assert.equal(source.registeredAt, "2026-08-17");
  assert.doesNotMatch(JSON.stringify(source), /attacker|"999"/);
});

test("preserves reviewer-controlled activation and polling policy for an owned source", () => {
  const proposal = normalizeSourceProposal({ ...INPUT, name: "Renamed Journal" });
  const updated = updateSourceRegistry({ version: 1, sources: [existingSource()] }, {
    identity: IDENTITY,
    proposal,
    feedUrl: PREVIEW.finalUrl,
    now: NOW,
  });
  assert.equal(updated.source.status, "active");
  assert.equal(updated.source.maxItemsPerRun, 7);
  assert.equal(updated.source.registeredAt, "2026-08-01");
  assert.equal(updated.source.name, "Renamed Journal");
  assert.throws(() => updateSourceRegistry({ version: 1, sources: [{ ...existingSource(), registrantGithubId: "9" }] }, {
    identity: IDENTITY,
    proposal,
    feedUrl: PREVIEW.finalUrl,
    now: NOW,
  }), /another Learn account/);
});

test("requires an active Learn account and same-origin request", async () => {
  const unauthenticated = await handle(new Request("https://learn.hara-lang.org/api/sources"), {
    env: ENV,
    githubClient: fakeClient(),
    now: NOW,
  });
  assert.equal(unauthenticated.status, 401);

  const inactive = await handle(request(), {
    env: ENV,
    githubClient: fakeClient(),
    now: NOW,
    probeFeedImpl: async () => PREVIEW,
    communityAccountStatusImpl: async () => "suspended",
  });
  assert.equal(inactive.status, 403);
  assert.match(inactive.headers.get("set-cookie"), new RegExp(`${LEARN_SESSION_COOKIE}=;`));

  const rejected = await handle(new Request("https://learn.hara-lang.org/api/sources", {
    method: "POST",
    headers: { Cookie: sessionCookie(), Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify(INPUT),
  }), {
    env: ENV,
    githubClient: fakeClient(),
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(rejected.status, 403);
});

test("probes a feed through the authenticated first-party endpoint", async () => {
  const response = await handle(request("/api/sources/probe", { feed: INPUT.feed }, "source-probe"), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    probeFeedImpl: async (feed) => ({ ...PREVIEW, requestedUrl: feed }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.preview.finalUrl, PREVIEW.finalUrl);
  assert.equal(body.preview.format, "rss");
});

test("opens one scoped draft PR containing the server-probed canonical feed", async () => {
  const client = fakeClient();
  const response = await handle(request("/api/sources", {
    ...INPUT,
    registrantGithubId: "999",
    status: "active",
  }), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    probeFeedImpl: async () => PREVIEW,
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.branch, "source-registry/github-6685337/example-journal");
  assert.equal(body.pullRequestUrl, "https://github.com/hara-lang/hara-learn/pull/61");
  assert.equal(body.reused, false);

  const put = client.calls.find((call) => call.path.endsWith("/contents/registry/sources.json") && call.options.method === "PUT");
  const registry = JSON.parse(Buffer.from(put.options.body.content, "base64").toString("utf8"));
  assert.equal(registry.sources[0].feed, PREVIEW.finalUrl);
  assert.equal(registry.sources[0].status, "proposed");
  assert.equal(registry.sources[0].registrantGithubId, "6685337");
  assert.doesNotMatch(JSON.stringify(registry), /"999"/);

  const pull = client.calls.find((call) => call.path.endsWith("/pulls") && call.options.method === "POST");
  assert.equal(pull.options.body.draft, true);
  assert.match(pull.options.body.body, /hara-learn-source:github:6685337:example-journal/);
  assert.match(pull.options.body.body, /server re-probed the feed/i);
});

test("reuses the stable branch and existing open source proposal", async () => {
  const existingPull = {
    number: 23,
    html_url: "https://github.com/hara-lang/hara-learn/pull/23",
    body: "<!-- hara-learn-source-proposal -->",
  };
  const client = fakeClient({ source: existingSource(), existingPull });
  const response = await handle(request(), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    probeFeedImpl: async () => PREVIEW,
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.reused, true);
  assert.equal(body.number, 23);
  assert.ok(client.calls.some((call) => call.path.includes("git/refs/heads/source-registry/github-6685337/example-journal") && call.options.method === "PATCH"));
  assert.ok(client.calls.some((call) => call.path.endsWith("/pulls/23") && call.options.method === "PATCH"));
  assert.equal(client.calls.some((call) => call.path.endsWith("/pulls") && call.options.method === "POST"), false);
});

test("lists only merged sources registered by the current Learn identity", async () => {
  const client = fakeClient({ source: existingSource() });
  const response = await handle(new Request("https://learn.hara-lang.org/api/sources", {
    headers: { Cookie: sessionCookie() },
  }), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sources.length, 1);
  assert.equal(body.sources[0].id, "example-journal");
  assert.equal(body.sources[0].status, "active");
});

test("rejects missing permission evidence and unsafe contact URLs", () => {
  assert.throws(() => normalizeSourceProposal({ ...INPUT, permission: "open-licence", license: "" }), /identify its licence/);
  assert.throws(() => normalizeSourceProposal({ ...INPUT, contact: "mailto:private@example.com" }), /HTTPS URL/);
  assert.throws(() => normalizeSourceProposal({ ...INPUT, syndication: "full", permission: "authorised", license: "" }), /Full-text/);
});
