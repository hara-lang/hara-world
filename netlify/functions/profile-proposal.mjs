import { randomBytes } from "node:crypto";
import { createGitHubAppClient } from "./_shared/github-app.mjs";
import {
  buildProfileDocument,
  normalizeProfileProposal,
  parseProfileDocument,
  profilePath,
} from "./_shared/profile-proposal.mjs";
import {
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const PROFILE_PATH = "/api/profile";

function decodeContent(payload) {
  if (typeof payload?.content !== "string" || payload.encoding !== "base64") return "";
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function loadProfiles(client) {
  let entries;
  try {
    entries = await client.request(`/repos/${client.repository}/contents/content/profiles?ref=${encodeURIComponent(client.baseBranch)}`);
  } catch (error) {
    if (error?.status === 404) return [];
    throw error;
  }
  if (!Array.isArray(entries)) return [];
  const files = entries.filter((entry) => entry?.type === "file" && entry.name?.endsWith(".md"));
  return Promise.all(files.map(async (entry) => {
    const payload = await client.request(`/repos/${client.repository}/contents/${entry.path}?ref=${encodeURIComponent(client.baseBranch)}`);
    const source = decodeContent(payload);
    return {
      path: entry.path,
      sha: payload.sha || entry.sha,
      source,
      ...parseProfileDocument(source),
    };
  }));
}

function publicProfile(record, identity) {
  const data = record?.data ?? {};
  return {
    exists: Boolean(record),
    path: record?.path ?? null,
    slug: record?.path?.replace(/^content\/profiles\//, "").replace(/\.md$/, "") ?? identity.login.toLowerCase(),
    githubId: identity.id,
    githubLogin: identity.login,
    displayName: data.displayName ?? identity.name ?? identity.login,
    summary: data.summary ?? "",
    location: data.location ?? "",
    website: data.website ?? "",
    interests: Array.isArray(data.interests) ? data.interests : [],
    roles: Array.isArray(data.roles) ? data.roles : [],
    bio: record?.body ?? "",
    published: data.published === true,
  };
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

function branchName(identity, now, suffix) {
  return `profile/github-${identity.id}-${Math.floor(now / 1000).toString(36)}-${suffix}`;
}

async function createProfilePullRequest(client, {
  identity,
  proposal,
  current,
  now,
  suffix,
}) {
  const targetPath = current?.path ?? profilePath(proposal.slug);
  const document = buildProfileDocument({ identity, proposal, existing: current, now });
  if (current?.source === document) {
    return { unchanged: true, path: targetPath, pullRequestUrl: null, number: null };
  }

  const ref = await client.request(`/repos/${client.repository}/git/ref/heads/${encodeURIComponent(client.baseBranch)}`);
  const baseSha = ref?.object?.sha;
  if (typeof baseSha !== "string") throw new Error("GitHub did not return the profile base revision.");
  const branch = branchName(identity, now, suffix);
  await client.request(`/repos/${client.repository}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: baseSha },
  });

  const update = {
    message: current ? `Update World profile for @${identity.login}` : `Add World profile for @${identity.login}`,
    content: Buffer.from(document).toString("base64"),
    branch,
  };
  if (current?.sha) update.sha = current.sha;
  await client.request(`/repos/${client.repository}/contents/${targetPath}`, {
    method: "PUT",
    body: update,
  });

  const pull = await client.request(`/repos/${client.repository}/pulls`, {
    method: "POST",
    body: {
      title: `Profile: @${identity.login}`,
      head: branch,
      base: client.baseBranch,
      draft: true,
      maintainer_can_modify: true,
      body: [
        "## Hara World profile proposal",
        "",
        `Prepared from the authenticated World session for \`github:${identity.id}\` (\`@${identity.login}\`).`,
        "",
        "- The stable numeric GitHub identity and current login came from Hara Identity, not from form fields.",
        "- Existing reviewed roles and links are preserved.",
        "- Merge remains the publication event.",
        "- This profile does not grant package, specification, repository, or editorial authority.",
      ].join("\n"),
    },
  });

  return {
    unchanged: false,
    path: targetPath,
    branch,
    pullRequestUrl: pull?.html_url,
    number: pull?.number,
  };
}

export async function handle(request, options = {}) {
  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  if (new URL(request.url).pathname !== PROFILE_PATH) {
    return json(404, { error: { code: "NOT_FOUND", message: "Unknown profile endpoint." } });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and POST are supported." } }, { Allow: "GET, POST" });
  }

  const identity = readWorldSession(request, env, now);
  if (!identity) {
    return json(401, { error: { code: "WORLD_SESSION_REQUIRED", message: "Establish a Hara World session before editing a profile." } });
  }
  if (request.method === "POST" && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "profile-proposal")) {
    return json(403, { error: { code: "PROFILE_REQUEST_REJECTED", message: "The profile request must come from Hara World." } });
  }

  let client;
  try {
    client = await resolveClient(options, env, now);
  } catch {
    return json(503, { error: { code: "PROFILE_PUBLISHER_UNAVAILABLE", message: "The GitHub profile publisher is not configured." } });
  }

  let profiles;
  try {
    profiles = await loadProfiles(client);
  } catch (error) {
    console.error("World profile lookup failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "PROFILE_REGISTRY_UNAVAILABLE", message: "The profile registry could not be read from GitHub." } });
  }

  const current = profiles.find((profile) => String(profile.data.githubId) === identity.id) ?? null;
  if (request.method === "GET") {
    return json(200, { ok: true, profile: publicProfile(current, identity) });
  }

  let proposal;
  try {
    proposal = normalizeProfileProposal(await request.json());
  } catch (error) {
    return json(400, { error: { code: "PROFILE_INVALID", message: error.message || "The profile proposal is invalid." } });
  }

  const proposedPath = current?.path ?? profilePath(proposal.slug);
  const conflict = profiles.find((profile) => profile.path === proposedPath && String(profile.data.githubId) !== identity.id);
  if (conflict) {
    return json(409, { error: { code: "PROFILE_SLUG_TAKEN", message: "That public profile slug is already in use." } });
  }

  try {
    const suffix = options.randomSuffix ?? randomBytes(3).toString("hex");
    const result = await createProfilePullRequest(client, { identity, proposal, current, now, suffix });
    return json(result.unchanged ? 200 : 201, { ok: true, ...result });
  } catch (error) {
    console.error("World profile proposal failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "PROFILE_PROPOSAL_FAILED", message: "The profile pull request could not be created." } });
  }
}

export default async (request) => handle(request);

export const config = {
  path: "/api/profile",
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
