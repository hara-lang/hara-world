import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createGitHubAppJwt } from "../netlify/functions/_shared/github-app.mjs";
import {
  buildProfileDocument,
  normalizeProfileProposal,
  parseProfileDocument,
} from "../netlify/functions/_shared/profile-proposal.mjs";
import { LEARN_SESSION_COOKIE, signLearnSession } from "../netlify/functions/_shared/learn-auth.mjs";
import { handle } from "../netlify/functions/profile-proposal.mjs";

const ENV = {
  HARA_LEARN_HANDOFF_SECRET: "h".repeat(64),
  HARA_LEARN_SESSION_SECRET: "s".repeat(64),
  HARA_LEARN_SITE: "https://learn.hara-lang.org",
};
const NOW = Date.parse("2026-08-07T00:00:00Z");
const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  id: "6685337",
  login: "zcaudate",
  name: "Chris",
  avatarUrl: "https://avatars.githubusercontent.com/u/6685337?v=4",
  profileUrl: "https://github.com/zcaudate",
};
const EMPTY_INDEX = { version: 1, profiles: [], byGithubId: {}, bySlug: {} };

function sessionCookie() {
  const token = signLearnSession(IDENTITY, ENV.HARA_LEARN_SESSION_SECRET, {
    issuer: "https://learn.hara-lang.org",
    now: NOW,
  });
  return `${LEARN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function profileSource({ slug = "chris-zheng", login = "zcaudate" } = {}) {
  return `---\ngithubId: "6685337"\ngithubLogin: "${login}"\ndisplayName: "Chris Zheng"\nsummary: "Building Hara."\ninterests: ["Hara"]\nroles: ["maintainer"]\nlinks: [{"label":"Packages","url":"https://packages.hara-lang.org/"}]\njoinedAt: "2026-08-01"\npublished: true\n---\n\nExisting biography.\n`;
}

function fakeClient({ existingProfile = null, existingPull = null } = {}) {
  const calls = [];
  const index = existingProfile ? {
    version: 1,
    profiles: [{ githubId: "6685337", githubLogin: "zcaudate", slug: existingProfile.slug, path: `content/profiles/${existingProfile.slug}.md` }],
    byGithubId: { "6685337": existingProfile.slug },
    bySlug: { [existingProfile.slug]: "6685337" },
  } : EMPTY_INDEX;
  let branchExists = Boolean(existingPull);
  return {
    repository: "hara-lang/hara-learn",
    baseBranch: "main",
    installationPermissions: { contents: "write", pull_requests: "write" },
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-learn/contents/registry/profiles.json?")) {
        return { encoding: "base64", content: Buffer.from(`${JSON.stringify(index, null, 2)}\n`).toString("base64"), sha: "index-sha" };
      }
      if (existingProfile && path.startsWith(`/repos/hara-lang/hara-learn/contents/content/profiles/${existingProfile.slug}.md?`)) {
        return { encoding: "base64", content: Buffer.from(profileSource(existingProfile)).toString("base64"), sha: "profile-sha" };
      }
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/main") return { object: { sha: "base-sha" } };
      if (path === "/repos/hara-lang/hara-learn/git/ref/heads/profile/github-6685337") {
        if (!branchExists) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { object: { sha: "proposal-sha" } };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs" && options.method === "POST") {
        branchExists = true;
        return { ref: options.body.ref };
      }
      if (path === "/repos/hara-lang/hara-learn/git/refs/heads/profile/github-6685337" && options.method === "PATCH") {
        return { object: { sha: options.body.sha } };
      }
      if (options.method === "PUT" && path.includes("/contents/")) return { content: { sha: "new-sha" } };
      if (path.startsWith("/repos/hara-lang/hara-learn/pulls?")) return existingPull ? [existingPull] : [];
      if (path === "/repos/hara-lang/hara-learn/pulls" && options.method === "POST") {
        return { number: 42, html_url: "https://github.com/hara-lang/hara-learn/pull/42" };
      }
      if (existingPull && path === `/repos/hara-lang/hara-learn/pulls/${existingPull.number}` && options.method === "PATCH") {
        return { ...existingPull, html_url: existingPull.html_url };
      }
      throw new Error(`Unexpected GitHub request: ${path} ${options.method || "GET"}`);
    },
  };
}

const INPUT = {
  slug: "chris-zheng",
  displayName: "Chris Zheng",
  summary: "Building Hara and its programmable ecosystem.",
  location: "Melbourne",
  website: "https://hara-lang.org/",
  interests: ["Hara", "language runtimes"],
  bio: "I work on Hara, package infrastructure, and programmable media.",
  consent: true,
};

function proposalRequest(body = INPUT) {
  return new Request("https://learn.hara-lang.org/api/profile", {
    method: "POST",
    headers: {
      Cookie: sessionCookie(),
      Origin: "https://learn.hara-lang.org",
      "Content-Type": "application/json",
      "X-Hara-Request": "profile-proposal",
    },
    body: JSON.stringify(body),
  });
}

test("signs GitHub App JWTs with the configured RSA key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = createGitHubAppJwt({ appId: "12345", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), now: NOW });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "12345");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("builds deterministic Markdown from session identity and preserves reviewed authority", () => {
  const proposal = normalizeProfileProposal({ ...INPUT, githubId: "999", githubLogin: "attacker", roles: ["owner"] });
  const existing = { data: { roles: ["maintainer"], links: [{ label: "Packages", url: "https://packages.hara-lang.org/" }], joinedAt: "2026-08-01", published: true } };
  const document = buildProfileDocument({ identity: IDENTITY, proposal, existing, now: NOW });
  const parsed = parseProfileDocument(document);
  assert.equal(parsed.data.githubId, "6685337");
  assert.equal(parsed.data.githubLogin, "zcaudate");
  assert.deepEqual(parsed.data.roles, ["maintainer"]);
  assert.doesNotMatch(document, /attacker|githubId: "999"|owner/);
});

test("requires a current active Learn account and same-origin request", async () => {
  const unauthenticated = await handle(new Request("https://learn.hara-lang.org/api/profile"), { env: ENV, githubClient: fakeClient(), now: NOW });
  assert.equal(unauthenticated.status, 401);

  const inactive = await handle(proposalRequest(), {
    env: ENV, githubClient: fakeClient(), now: NOW, communityAccountStatusImpl: async () => "suspended",
  });
  assert.equal(inactive.status, 403);
  assert.match(inactive.headers.get("set-cookie"), new RegExp(`${LEARN_SESSION_COOKIE}=;`));

  const rejected = await handle(new Request("https://learn.hara-lang.org/api/profile", {
    method: "POST",
    headers: { Cookie: sessionCookie(), Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify(INPUT),
  }), { env: ENV, githubClient: fakeClient(), now: NOW, communityAccountStatusImpl: async () => "active" });
  assert.equal(rejected.status, 403);
});

test("opens one scoped draft PR and updates the reciprocal profile index", async () => {
  const client = fakeClient();
  const response = await handle(proposalRequest({ ...INPUT, githubId: "999", roles: ["owner"] }), {
    env: ENV, githubClient: client, now: NOW, communityAccountStatusImpl: async () => "active",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.branch, "profile/github-6685337");
  assert.equal(body.pullRequestUrl, "https://github.com/hara-lang/hara-learn/pull/42");
  assert.equal(body.reused, false);

  const puts = client.calls.filter((call) => call.options.method === "PUT");
  assert.equal(puts.length, 2);
  const profilePut = puts.find((call) => call.path.includes("content/profiles/chris-zheng.md"));
  const profile = Buffer.from(profilePut.options.body.content, "base64").toString("utf8");
  assert.match(profile, /githubId: "6685337"/);
  assert.doesNotMatch(profile, /githubId: "999"|roles: \["owner"\]/);
  const indexPut = puts.find((call) => call.path.includes("registry/profiles.json"));
  const index = JSON.parse(Buffer.from(indexPut.options.body.content, "base64").toString("utf8"));
  assert.equal(index.byGithubId["6685337"], "chris-zheng");
  assert.equal(index.bySlug["chris-zheng"], "6685337");
  const pull = client.calls.find((call) => call.path.endsWith("/pulls") && call.options.method === "POST");
  assert.equal(pull.options.body.draft, true);
  assert.match(pull.options.body.body, /hara-learn-profile:github:6685337/);
});

test("reuses the stable branch and existing open proposal instead of creating PR spam", async () => {
  const existingPull = {
    number: 12,
    html_url: "https://github.com/hara-lang/hara-learn/pull/12",
    body: "<!-- hara-learn-profile-proposal -->",
  };
  const client = fakeClient({ existingProfile: { slug: "chris-zheng" }, existingPull });
  const response = await handle(proposalRequest(INPUT), {
    env: ENV, githubClient: client, now: NOW, communityAccountStatusImpl: async () => "active",
  });
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.reused, true);
  assert.equal(body.number, 12);
  assert.ok(client.calls.some((call) => call.path.includes("git/refs/heads/profile/github-6685337") && call.options.method === "PATCH"));
  assert.ok(client.calls.some((call) => call.path.endsWith("/pulls/12") && call.options.method === "PATCH"));
  assert.equal(client.calls.some((call) => call.path.endsWith("/pulls") && call.options.method === "POST"), false);
});

test("rejects executable markup and unsafe link schemes in profile biographies", () => {
  assert.throws(() => normalizeProfileProposal({ ...INPUT, bio: "Hello <script>alert(1)</script>" }), /raw HTML/);
  assert.throws(() => normalizeProfileProposal({ ...INPUT, bio: "[click](javascript:alert(1))" }), /unsafe link target/);
});
