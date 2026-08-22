import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDocument,
  normalizeAgentProposal,
  parseAgentDocument,
} from "../netlify/functions/_shared/agent-proposal.mjs";
import { LEARN_SESSION_COOKIE, signLearnSession } from "../netlify/functions/_shared/learn-auth.mjs";
import { handle } from "../netlify/functions/agent-proposal.mjs";

const ENV = {
  HARA_LEARN_HANDOFF_SECRET: "h".repeat(64),
  HARA_LEARN_SESSION_SECRET: "s".repeat(64),
  HARA_LEARN_SITE: "https://learn.hara-lang.org",
};
const NOW = Date.parse("2026-08-17T10:00:00Z");
const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  id: "6685337",
  login: "zcaudate",
  name: "Chris Zheng",
  avatarUrl: "https://avatars.githubusercontent.com/u/6685337?v=4",
  profileUrl: "https://github.com/zcaudate",
};
const EMPTY_INDEX = { version: 1, agents: [], bySlug: {}, byOperator: {} };

const INPUT = {
  slug: "atlas",
  name: "Atlas",
  summary: "A supervised research and code-navigation agent built around Hara.",
  status: "experimental",
  availability: "private",
  operationMode: "supervised",
  capabilities: ["research", "code navigation"],
  interfaces: ["chat", "repl"],
  haraPackages: ["work.agent", "std.work"],
  runtime: "Hara process with an OpenAI-compatible provider",
  website: "https://learn.hara-lang.org/agents/atlas/",
  source: "https://github.com/hara-lang/hara",
  documentation: "https://hara-lang.org/docs/",
  description: "## Purpose\n\nAtlas explores source trees while a person remains responsible for every published change.",
  consent: true,
};

function sessionCookie() {
  const token = signLearnSession(IDENTITY, ENV.HARA_LEARN_SESSION_SECRET, {
    issuer: "https://learn.hara-lang.org",
    now: NOW,
  });
  return `${LEARN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function agentSource({ slug = "atlas", login = "zcaudate" } = {}) {
  return `---\nagentId: "agent:github:6685337:${slug}"\noperatorGithubId: "6685337"\noperatorGithubLogin: "${login}"\noperatorDisplayName: "Chris Zheng"\nname: "Atlas"\nsummary: "Existing agent record."\nstatus: "active"\navailability: "private"\noperationMode: "supervised"\ncapabilities: ["research"]\ninterfaces: ["chat"]\nharaPackages: ["work.agent"]\nverification: "operator-claimed"\nattestations: []\nregisteredAt: "2026-08-01"\nupdatedAt: "2026-08-01"\npublished: true\n---\n\nExisting description.\n`;
}

function fakeClient({ existingAgent = null, existingPull = null } = {}) {
  const calls = [];
  const index = existingAgent ? {
    version: 1,
    agents: [{
      agentId: `agent:github:6685337:${existingAgent.slug}`,
      operatorGithubId: "6685337",
      operatorGithubLogin: "zcaudate",
      slug: existingAgent.slug,
      path: `content/agents/${existingAgent.slug}.md`,
    }],
    bySlug: { [existingAgent.slug]: `agent:github:6685337:${existingAgent.slug}` },
    byOperator: { "6685337": [existingAgent.slug] },
  } : EMPTY_INDEX;
  let branchExists = Boolean(existingPull);

  return {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    installationPermissions: { contents: "write", pull_requests: "write" },
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-learn/contents/registry/agents.json?")) {
        return { encoding: "base64", content: Buffer.from(`${JSON.stringify(index, null, 2)}\n`).toString("base64"), sha: "index-sha" };
      }
      if (existingAgent && path.startsWith(`/repos/hara-lang/hara-learn/contents/content/agents/${existingAgent.slug}.md?`)) {
        return { encoding: "base64", content: Buffer.from(agentSource(existingAgent)).toString("base64"), sha: "agent-sha" };
      }
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/main") return { object: { sha: "base-sha" } };
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/agent-registry/github-6685337/atlas") {
        if (!branchExists) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { object: { sha: "proposal-sha" } };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs" && options.method === "POST") {
        branchExists = true;
        return { ref: options.body.ref };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs/heads/agent-registry/github-6685337/atlas" && options.method === "PATCH") {
        return { object: { sha: options.body.sha } };
      }
      if (options.method === "PUT" && path.includes("/contents/")) return { content: { sha: "new-sha" } };
      if (path.startsWith("/repos/hara-lang/hara-learn/pulls?")) return existingPull ? [existingPull] : [];
      if (path === "/repos/hara-lang/hara-learn/pulls" && options.method === "POST") {
        return { number: 51, html_url: "https://github.com/hara-lang/hara-learn/pull/51" };
      }
      if (existingPull && path === `/repos/hara-lang/hara-learn/pulls/${existingPull.number}` && options.method === "PATCH") {
        return { ...existingPull, html_url: existingPull.html_url };
      }
      throw new Error(`Unexpected GitHub request: ${path} ${options.method || "GET"}`);
    },
  };
}

function proposalRequest(body = INPUT) {
  return new Request("https://learn.hara-lang.org/api/agents", {
    method: "POST",
    headers: {
      Cookie: sessionCookie(),
      Origin: "https://learn.hara-lang.org",
      "Content-Type": "application/json",
      "X-Hara-Request": "agent-proposal",
    },
    body: JSON.stringify(body),
  });
}

test("builds a deterministic agent record from server identity and preserves reviewed verification", () => {
  const proposal = normalizeAgentProposal({
    ...INPUT,
    operatorGithubId: "999",
    operatorGithubLogin: "attacker",
    verification: "key-verified",
    keyFingerprint: "forged",
  });
  const existing = {
    data: {
      verification: "key-verified",
      keyFingerprint: "sha256:reviewed-key",
      attestations: [{ label: "Review", url: "https://example.com/review" }],
      registeredAt: "2026-08-01",
      published: true,
    },
  };
  const document = buildAgentDocument({ identity: IDENTITY, proposal, existing, now: NOW });
  const parsed = parseAgentDocument(document);

  assert.equal(parsed.data.agentId, "agent:github:6685337:atlas");
  assert.equal(parsed.data.operatorGithubId, "6685337");
  assert.equal(parsed.data.operatorGithubLogin, "zcaudate");
  assert.equal(parsed.data.verification, "key-verified");
  assert.equal(parsed.data.keyFingerprint, "sha256:reviewed-key");
  assert.deepEqual(parsed.data.attestations, [{ label: "Review", url: "https://example.com/review" }]);
  assert.doesNotMatch(document, /attacker|operatorGithubId: "999"|forged/);
});

test("requires an active Learn account and a same-origin registration request", async () => {
  const unauthenticated = await handle(new Request("https://learn.hara-lang.org/api/agents"), { env: ENV, githubClient: fakeClient(), now: NOW });
  assert.equal(unauthenticated.status, 401);

  const inactive = await handle(proposalRequest(), {
    env: ENV,
    githubClient: fakeClient(),
    now: NOW,
    communityAccountStatusImpl: async () => "suspended",
  });
  assert.equal(inactive.status, 403);
  assert.match(inactive.headers.get("set-cookie"), new RegExp(`${LEARN_SESSION_COOKIE}=;`));

  const rejected = await handle(new Request("https://learn.hara-lang.org/api/agents", {
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

test("opens one scoped draft PR and updates the reciprocal agent index", async () => {
  const client = fakeClient();
  const response = await handle(proposalRequest({
    ...INPUT,
    operatorGithubId: "999",
    verification: "key-verified",
  }), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.branch, "agent-registry/github-6685337/atlas");
  assert.equal(body.pullRequestUrl, "https://github.com/hara-lang/hara-learn/pull/51");
  assert.equal(body.reused, false);

  const puts = client.calls.filter((call) => call.options.method === "PUT");
  assert.equal(puts.length, 2);
  const agentPut = puts.find((call) => call.path.includes("content/agents/atlas.md"));
  const agent = Buffer.from(agentPut.options.body.content, "base64").toString("utf8");
  assert.match(agent, /agentId: "agent:github:6685337:atlas"/);
  assert.match(agent, /operatorGithubLogin: "zcaudate"/);
  assert.match(agent, /verification: "operator-claimed"/);
  assert.doesNotMatch(agent, /operatorGithubId: "999"|key-verified/);

  const indexPut = puts.find((call) => call.path.includes("registry/agents.json"));
  const index = JSON.parse(Buffer.from(indexPut.options.body.content, "base64").toString("utf8"));
  assert.equal(index.bySlug.atlas, "agent:github:6685337:atlas");
  assert.deepEqual(index.byOperator["6685337"], ["atlas"]);

  const pull = client.calls.find((call) => call.path.endsWith("/pulls") && call.options.method === "POST");
  assert.equal(pull.options.body.draft, true);
  assert.match(pull.options.body.body, /hara-learn-agent:agent:github:6685337:atlas/);
  assert.match(pull.options.body.body, /does not grant|no credential|outside this record/i);
});

test("reuses the stable branch and existing open registration instead of creating PR spam", async () => {
  const existingPull = {
    number: 22,
    html_url: "https://github.com/hara-lang/hara-learn/pull/22",
    body: "<!-- hara-learn-agent-proposal -->",
  };
  const client = fakeClient({ existingAgent: { slug: "atlas" }, existingPull });
  const response = await handle(proposalRequest(INPUT), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.reused, true);
  assert.equal(body.number, 22);
  assert.ok(client.calls.some((call) => call.path.includes("git/refs/heads/agent-registry/github-6685337/atlas") && call.options.method === "PATCH"));
  assert.ok(client.calls.some((call) => call.path.endsWith("/pulls/22") && call.options.method === "PATCH"));
  assert.equal(client.calls.some((call) => call.path.endsWith("/pulls") && call.options.method === "POST"), false);
});

test("lists merged agents owned by the session identity and rejects active Markdown", async () => {
  const client = fakeClient({ existingAgent: { slug: "atlas" } });
  const response = await handle(new Request("https://learn.hara-lang.org/api/agents", {
    headers: { Cookie: sessionCookie() },
  }), {
    env: ENV,
    githubClient: client,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.agents.length, 1);
  assert.equal(body.agents[0].agentId, "agent:github:6685337:atlas");
  assert.equal(body.agents[0].description, "Existing description.");

  assert.throws(() => normalizeAgentProposal({ ...INPUT, description: "Hello <script>alert(1)</script>" }), /raw HTML/);
  assert.throws(() => normalizeAgentProposal({ ...INPUT, description: "[click](javascript:alert(1))" }), /unsafe link target/);
  assert.throws(() => normalizeAgentProposal({ ...INPUT, interfaces: ["ssh"] }), /not supported/);
});
