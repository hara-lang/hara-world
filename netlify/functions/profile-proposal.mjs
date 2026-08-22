import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import {
  buildProfileDocument,
  normalizeProfileProposal,
  parseProfileDocument,
  profilePath,
} from "./_shared/profile-proposal.mjs";
import {
  assertProfileIndex,
  profileForIdentity,
  profileOwner,
  serialiseProfileIndex,
  updateProfileIndex,
} from "./_shared/profile-index.mjs";
import {
  publicPathForProposal,
  recordPublishedProposal,
} from "./_shared/proposal-recording.mjs";
import {
  clearLearnSessionCookie,
  json,
  readLearnSession,
  sameOrigin,
} from "./_shared/learn-auth.mjs";

const PROFILE_PATH = "/api/profile";
const PROFILE_INDEX_PATH = "registry/profiles.json";
const PR_MARKER = "<!-- hara-learn-profile-proposal -->";

function decodeContent(payload) {
  if (typeof payload?.content !== "string" || payload.encoding !== "base64") return "";
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function readRepositoryFile(client, path) {
  const payload = await client.request(`/repos/${client.repository}/contents/${path}?ref=${encodeURIComponent(client.baseBranch)}`);
  return { path, sha: payload.sha, source: decodeContent(payload) };
}

async function loadProfileState(client, identity) {
  const indexFile = await readRepositoryFile(client, PROFILE_INDEX_PATH);
  let parsedIndex;
  try { parsedIndex = assertProfileIndex(JSON.parse(indexFile.source)); }
  catch (error) { throw new Error(`Profile index could not be validated: ${error.message}`); }
  const indexed = profileForIdentity(parsedIndex, identity.id);
  let current = null;
  if (indexed) {
    const profileFile = await readRepositoryFile(client, indexed.path);
    current = { ...profileFile, ...parseProfileDocument(profileFile.source) };
    if (String(current.data.githubId) !== identity.id) throw new Error("Profile index and profile identity disagree.");
  }
  return { indexFile, index: parsedIndex, indexed, current };
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

function branchName(identity) {
  return `profile/github-${identity.id}`;
}

function refPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

function pullRequestBody(identity) {
  return [
    PR_MARKER,
    `<!-- hara-learn-profile:github:${identity.id} -->`,
    "## Hara Learn profile proposal",
    "",
    `Prepared from the authenticated Learn session for \`github:${identity.id}\` (\`@${identity.login}\`).`,
    "",
    "- The stable numeric GitHub identity and current login came from Hara Identity, not from form fields.",
    "- Existing reviewed roles and links are preserved.",
    "- The profile index is updated in the same reviewable branch.",
    "- Merge remains the publication event.",
    "- This profile does not grant package, specification, repository, or editorial authority.",
  ].join("\n");
}

async function findOpenProfilePullRequest(client, branch) {
  const owner = client.repository.split("/")[0];
  const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}`, base: client.baseBranch, per_page: "10" });
  const pulls = await client.request(`/repos/${client.repository}/pulls?${query}`);
  return Array.isArray(pulls) ? pulls.find((pull) => String(pull?.body ?? "").includes(PR_MARKER)) ?? null : null;
}

async function prepareProposalBranch(client, branch, baseSha) {
  try {
    await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(branch)}`);
    await client.request(`/repos/${client.repository}/git/refs/heads/${refPath(branch)}`, {
      method: "PATCH",
      body: { sha: baseSha, force: true },
    });
    return "reset";
  } catch (error) {
    if (error?.status !== 404) throw error;
    await client.request(`/repos/${client.repository}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    });
    return "created";
  }
}

async function putFile(client, path, source, branch, sha) {
  const body = {
    message: `Propose Learn profile record ${path}`,
    content: Buffer.from(source).toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  await client.request(`/repos/${client.repository}/contents/${path}`, { method: "PUT", body });
}

async function createOrUpdateProfilePullRequest(client, { identity, proposal, state, now }) {
  const targetPath = state.current?.path ?? profilePath(proposal.slug);
  const owner = profileOwner(state.index, proposal.slug);
  if (owner && owner !== identity.id) throw new Error("That public profile slug is already in use.");
  if (state.indexed && state.indexed.slug !== proposal.slug) throw new Error("A merged profile slug cannot be changed.");

  const document = buildProfileDocument({ identity, proposal, existing: state.current, now });
  const nextIndex = updateProfileIndex(state.index, {
    githubId: identity.id,
    githubLogin: identity.login,
    slug: proposal.slug,
  });
  const indexSource = serialiseProfileIndex(nextIndex);
  if (state.current?.source === document && state.indexFile.source === indexSource) {
    return { unchanged: true, path: targetPath, pullRequestUrl: null, number: null, reused: false };
  }

  const baseRef = await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(client.baseBranch)}`);
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== "string") throw new Error("GitHub did not return the profile base revision.");
  const branch = branchName(identity);
  await prepareProposalBranch(client, branch, baseSha);
  await putFile(client, targetPath, document, branch, state.current?.sha);
  await putFile(client, PROFILE_INDEX_PATH, indexSource, branch, state.indexFile.sha);

  const title = `Profile: @${identity.login}`;
  const body = pullRequestBody(identity);
  const existingPull = await findOpenProfilePullRequest(client, branch);
  let pull;
  if (existingPull) {
    pull = await client.request(`/repos/${client.repository}/pulls/${existingPull.number}`, {
      method: "PATCH",
      body: { title, body, base: client.baseBranch, maintainer_can_modify: true },
    });
  } else {
    pull = await client.request(`/repos/${client.repository}/pulls`, {
      method: "POST",
      body: {
        title,
        head: branch,
        base: client.baseBranch,
        draft: true,
        maintainer_can_modify: true,
        body,
      },
    });
  }

  return {
    unchanged: false,
    path: targetPath,
    branch,
    pullRequestUrl: pull?.html_url,
    number: pull?.number,
    headSha: pull?.head?.sha ?? null,
    submittedAt: pull?.created_at ?? new Date(now).toISOString(),
    reused: Boolean(existingPull),
  };
}

function inactiveResponse(request, status) {
  return json(403, {
    error: {
      code: "LEARN_ACCOUNT_INACTIVE",
      message: "This Hara Learn account is not active.",
      status,
    },
  }, { "Set-Cookie": clearLearnSessionCookie(request.url) });
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

  const identity = readLearnSession(request, env, now);
  if (!identity) return json(401, { error: { code: "LEARN_SESSION_REQUIRED", message: "Establish a Hara Learn session before editing a profile." } });
  if (request.method === "POST" && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "profile-proposal")) {
    return json(403, { error: { code: "PROFILE_REQUEST_REJECTED", message: "The profile request must come from Hara Learn." } });
  }

  let status;
  try { status = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id); }
  catch { return json(503, { error: { code: "LEARN_ACCOUNT_CHECK_FAILED", message: "Learn could not verify the community account." } }); }
  if (status !== "active") return inactiveResponse(request, status);

  let client;
  try { client = await resolveClient(options, env, now); }
  catch { return json(503, { error: { code: "PROFILE_PUBLISHER_UNAVAILABLE", message: "The GitHub profile publisher is not configured." } }); }

  let state;
  try { state = await loadProfileState(client, identity); }
  catch (error) {
    console.error("Learn profile lookup failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "PROFILE_REGISTRY_UNAVAILABLE", message: "The profile registry could not be read from GitHub." } });
  }

  if (request.method === "GET") return json(200, { ok: true, profile: publicProfile(state.current, identity) });

  let proposal;
  try { proposal = normalizeProfileProposal(await request.json()); }
  catch (error) { return json(400, { error: { code: "PROFILE_INVALID", message: error.message || "The profile proposal is invalid." } }); }

  try {
    const result = await createOrUpdateProfilePullRequest(client, { identity, proposal, state, now });
    const lifecycle = await recordPublishedProposal({
      proposalType: "profile",
      identity,
      resourceKey: `github:${identity.id}`,
      resourceTitle: proposal.displayName,
      result,
      client,
      publicPath: publicPathForProposal("profile", { slug: proposal.slug }),
      now,
      db: options.db,
      proposalStore: options.proposalLifecycleStore,
    });
    return json(result.unchanged ? 200 : 201, { ok: true, ...result, lifecycleRecorded: lifecycle.recorded });
  } catch (error) {
    if (/slug/.test(error?.message ?? "")) return json(409, { error: { code: "PROFILE_SLUG_TAKEN", message: error.message } });
    console.error("Learn profile proposal failed", { status: error?.status, name: error?.name });
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
