import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import test from "node:test";
import { createGitHubAppJwt } from "../netlify/functions/_shared/github-app.mjs";
import {
  buildProfileDocument,
  normalizeProfileProposal,
  parseProfileDocument,
} from "../netlify/functions/_shared/profile-proposal.mjs";
import {
  WORLD_SESSION_COOKIE,
  signWorldSession,
} from "../netlify/functions/_shared/world-auth.mjs";
import { handle } from "../netlify/functions/profile-proposal.mjs";

const ENV = {
  HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
  HARA_WORLD_SESSION_SECRET: "s".repeat(64),
  HARA_WORLD_SITE: "https://world.hara-lang.org",
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

function sessionCookie() {
  const token = signWorldSession(IDENTITY, ENV.HARA_WORLD_SESSION_SECRET, {
    issuer: "https://world.hara-lang.org",
    now: NOW,
  });
  return `${WORLD_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function fakeClient({ existing = [] } = {}) {
  const calls = [];
  const byPath = new Map(existing.map((record) => [record.path, record]));
  return {
    repository: "hara-lang/hara-world",
    baseBranch: "main",
    calls,
    async request(path, options = {}) {
      calls.push({ path, options });
      if (path.startsWith("/repos/hara-lang/hara-world/contents/content/profiles?")) {
        return existing.map((record) => ({ type: "file", name: record.path.split("/").at(-1), path: record.path, sha: record.sha }));
      }
      if (path.startsWith("/repos/hara-lang/hara-world/contents/content/profiles/") && options.method !== "PUT") {
        const filePath = decodeURIComponent(path.split("/contents/")[1].split("?")[0]);
        const record = byPath.get(filePath);
        if (!record) { const error = new Error("Not found"); error.status = 404; throw error; }
        return { encoding: "base64", content: Buffer.from(record.source).toString("base64"), sha: record.sha };
      }
      if (path.includes("/git/ref/heads/main")) return { object: { sha: "base-sha" } };
      if (path.endsWith("/git/refs")) return { ref: options.body.ref };
      if (options.method === "PUT" && path.includes("/contents/content/profiles/")) return { content: { sha: "new-sha" } };
      if (path.endsWith("/pulls")) return { number: 42, html_url: "https://github.com/hara-lang/hara-world/pull/42" };
      throw new Error(`Unexpected GitHub request: ${path}`);
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

test("signs GitHub App JWTs with the configured RSA key", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = createGitHubAppJwt({
    appId: "12345",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
    now: NOW,
  });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "12345");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("builds a deterministic profile document from session identity and preserves reviewed roles", () => {
  const proposal = normalizeProfileProposal({
    ...INPUT,
    githubId: "999",
    githubLogin: "attacker",
    roles: ["owner"],
  });
  const existing = {
    data: {
      roles: ["maintainer"],
      links: [{ label: "Packages", url: "https://packages.hara-lang.org/" }],
      joinedAt: "2026-08-01",
      published: true,
    },
  };
  const document = buildProfileDocument({ identity: IDENTITY, proposal, existing, now: NOW });
  const parsed = parseProfileDocument(document);
  assert.equal(parsed.data.githubId, "6685337");
  assert.equal(parsed.data.githubLogin, "zcaudate");
  assert.deepEqual(parsed.data.roles, ["maintainer"]);
  assert.deepEqual(parsed.data.links, [{ label: "Packages", url: "https://packages.hara-lang.org/" }]);
  assert.doesNotMatch(document, /attacker|999|owner/);
});

test("requires a World-local session and same-origin proposal request", async () => {
  const unauthenticated = await handle(new Request("https://world.hara-lang.org/api/profile"), { env: ENV, githubClient: fakeClient(), now: NOW });
  assert.equal(unauthenticated.status, 401);

  const rejected = await handle(new Request("https://world.hara-lang.org/api/profile", {
    method: "POST",
    headers: { Cookie: sessionCookie(), Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify(INPUT),
  }), { env: ENV, githubClient: fakeClient(), now: NOW });
  assert.equal(rejected.status, 403);
});

test("loads the authenticated profile and opens a draft Git pull request", async () => {
  const client = fakeClient();
  const get = await handle(new Request("https://world.hara-lang.org/api/profile", {
    headers: { Cookie: sessionCookie() },
  }), { env: ENV, githubClient: client, now: NOW });
  assert.equal(get.status, 200);
  assert.equal((await get.json()).profile.githubId, "6685337");

  const response = await handle(new Request("https://world.hara-lang.org/api/profile", {
    method: "POST",
    headers: {
      Cookie: sessionCookie(),
      Origin: "https://world.hara-lang.org",
      "Content-Type": "application/json",
      "X-Hara-Request": "profile-proposal",
    },
    body: JSON.stringify({ ...INPUT, githubId: "999", githubLogin: "attacker", roles: ["owner"] }),
  }), { env: ENV, githubClient: client, now: NOW, randomSuffix: "abc123" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.pullRequestUrl, "https://github.com/hara-lang/hara-world/pull/42");
  assert.equal(body.path, "content/profiles/chris-zheng.md");

  const put = client.calls.find((call) => call.options.method === "PUT");
  const document = Buffer.from(put.options.body.content, "base64").toString("utf8");
  assert.match(document, /githubId: "6685337"/);
  assert.match(document, /githubLogin: "zcaudate"/);
  assert.doesNotMatch(document, /attacker|githubId: "999"|roles: \["owner"\]/);

  const pull = client.calls.find((call) => call.path.endsWith("/pulls"));
  assert.equal(pull.options.body.draft, true);
  assert.match(pull.options.body.body, /github:6685337/);
});

test("rejects executable markup and unsafe link schemes in profile biographies", () => {
  assert.throws(() => normalizeProfileProposal({ ...INPUT, bio: "Hello <script>alert(1)</script>" }), /raw HTML/);
  assert.throws(() => normalizeProfileProposal({ ...INPUT, bio: "[click](javascript:alert(1))" }), /unsafe link target/);
});
