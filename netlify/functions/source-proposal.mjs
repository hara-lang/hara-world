import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import { probeFeed } from "./_shared/feed-probe.mjs";
import {
  publicPathForProposal,
  recordPublishedProposal,
} from "./_shared/proposal-recording.mjs";
import {
  assertSourceRegistry,
  normalizeSourceProposal,
  serialiseSourceRegistry,
  sourcesForRegistrant,
  updateSourceRegistry,
} from "./_shared/source-proposal.mjs";
import {
  clearWorldSessionCookie,
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const SOURCES_PATH = "/api/sources";
const PROBE_PATH = "/api/sources/probe";
const REGISTRY_PATH = "registry/sources.json";
const PR_MARKER = "<!-- hara-world-source-proposal -->";

function decodeContent(payload) {
  if (typeof payload?.content !== "string" || payload.encoding !== "base64") return "";
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function readRegistry(client) {
  const payload = await client.request(`/repos/${client.repository}/contents/${REGISTRY_PATH}?ref=${encodeURIComponent(client.baseBranch)}`);
  const source = decodeContent(payload);
  let registry;
  try { registry = assertSourceRegistry(JSON.parse(source)); }
  catch (error) { throw new Error(`Source registry could not be validated: ${error.message}`); }
  return { path: REGISTRY_PATH, sha: payload.sha, source, registry };
}

function publicSource(source) {
  return {
    id: source.id,
    name: source.name,
    homepage: source.homepage,
    feed: source.feed,
    contact: source.contact ?? "",
    status: source.status,
    syndication: source.syndication,
    permission: source.permission,
    license: source.license ?? "",
    defaultAuthor: source.defaultAuthor ?? "",
    topics: source.topics ?? [],
    language: source.language ?? "",
    relevance: source.relevance ?? "",
    registeredAt: source.registeredAt ?? "",
    updatedAt: source.updatedAt ?? "",
  };
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

function branchName(identity, sourceId) {
  return `source-registry/github-${identity.id}/${sourceId}`;
}

function refPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

function pullRequestBody(identity, proposal, preview) {
  const samples = preview.entries.slice(0, 3).map((entry) => `- ${entry.title || "Untitled entry"}${entry.url ? ` — ${entry.url}` : ""}`);
  return [
    PR_MARKER,
    `<!-- hara-world-source:github:${identity.id}:${proposal.id} -->`,
    "## Hara World source proposal",
    "",
    `Prepared from the authenticated World session for \`github:${identity.id}\` (\`@${identity.login}\`).`,
    "",
    `Publication: **${proposal.name}** (\`${proposal.id}\`)`,
    `Feed detected as: **${preview.format.toUpperCase()}**${preview.title ? ` — ${preview.title}` : ""}`,
    `Final probed feed URL: ${preview.finalUrl}`,
    `Requested syndication: **${proposal.syndication}**`,
    `Permission basis: **${proposal.permission}**`,
    "",
    "### Relevance",
    "",
    proposal.relevance,
    "",
    "### Feed sample",
    "",
    ...(samples.length ? samples : ["- The feed currently exposes no entries."]),
    "",
    "### Review boundary",
    "",
    "- The stable registrant identity came from Hara Identity, not form fields.",
    "- The server re-probed the feed with public-network, redirect, timeout, and response-size checks before preparing this proposal.",
    "- A public feed does not itself grant republication permission.",
    "- Merge records the proposed source; reviewers control activation and may keep `status: proposed` until permission is independently checked.",
    "- Pausing or removing a source remains a reviewed registry operation.",
  ].join("\n");
}

async function findOpenSourcePullRequest(client, branch) {
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

async function putRegistry(client, source, branch, sha) {
  await client.request(`/repos/${client.repository}/contents/${REGISTRY_PATH}`, {
    method: "PUT",
    body: {
      message: "Propose Hara World source registry update",
      content: Buffer.from(source).toString("base64"),
      branch,
      sha,
    },
  });
}

async function createOrUpdateSourcePullRequest(client, { identity, proposal, preview, state, now }) {
  const updated = updateSourceRegistry(state.registry, {
    identity,
    proposal,
    feedUrl: preview.finalUrl,
    now,
  });
  const nextSource = serialiseSourceRegistry(updated.registry);
  if (state.source === nextSource) {
    return { unchanged: true, source: publicSource(updated.source), pullRequestUrl: null, number: null, reused: false };
  }

  const baseRef = await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(client.baseBranch)}`);
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== "string") throw new Error("GitHub did not return the source-registry base revision.");
  const branch = branchName(identity, proposal.id);
  await prepareProposalBranch(client, branch, baseSha);
  await putRegistry(client, nextSource, branch, state.sha);

  const title = `Source: ${proposal.name}`;
  const body = pullRequestBody(identity, proposal, preview);
  const existingPull = await findOpenSourcePullRequest(client, branch);
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
    source: publicSource(updated.source),
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
      code: "WORLD_ACCOUNT_INACTIVE",
      message: "This Hara World account is not active.",
      status,
    },
  }, { "Set-Cookie": clearWorldSessionCookie(request.url) });
}

export async function handle(request, options = {}) {
  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  const path = new URL(request.url).pathname;
  if (![SOURCES_PATH, PROBE_PATH].includes(path)) {
    return json(404, { error: { code: "NOT_FOUND", message: "Unknown source endpoint." } });
  }
  if ((path === SOURCES_PATH && !["GET", "POST"].includes(request.method)) || (path === PROBE_PATH && request.method !== "POST")) {
    return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Unsupported source operation." } });
  }

  const identity = readWorldSession(request, env, now);
  if (!identity) return json(401, { error: { code: "WORLD_SESSION_REQUIRED", message: "Establish a Hara World session before submitting a publication feed." } });

  if (request.method === "POST") {
    const marker = path === PROBE_PATH ? "source-probe" : "source-proposal";
    if (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== marker) {
      return json(403, { error: { code: "SOURCE_REQUEST_REJECTED", message: "The source request must come from Hara World." } });
    }
  }

  let status;
  try { status = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id); }
  catch { return json(503, { error: { code: "WORLD_ACCOUNT_CHECK_FAILED", message: "World could not verify the community account." } }); }
  if (status !== "active") return inactiveResponse(request, status);

  if (path === PROBE_PATH) {
    let feed;
    try { feed = String((await request.json())?.feed ?? "").trim(); }
    catch { return json(400, { error: { code: "SOURCE_PROBE_INVALID", message: "A JSON feed request is required." } }); }
    try {
      const preview = await (options.probeFeedImpl ?? probeFeed)(feed, options.probeOptions ?? {});
      return json(200, { ok: true, preview });
    } catch (error) {
      return json(422, { error: { code: "SOURCE_PROBE_FAILED", message: error.message || "The feed could not be inspected safely." } });
    }
  }

  let client;
  try { client = await resolveClient(options, env, now); }
  catch { return json(503, { error: { code: "SOURCE_PUBLISHER_UNAVAILABLE", message: "The GitHub source publisher is not configured." } }); }

  let state;
  try { state = await readRegistry(client); }
  catch (error) {
    console.error("World source registry lookup failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "SOURCE_REGISTRY_UNAVAILABLE", message: "The source registry could not be read from GitHub." } });
  }

  if (request.method === "GET") {
    return json(200, { ok: true, sources: sourcesForRegistrant(state.registry, identity.id).map(publicSource) });
  }

  let proposal;
  try { proposal = normalizeSourceProposal(await request.json()); }
  catch (error) { return json(400, { error: { code: "SOURCE_INVALID", message: error.message || "The source proposal is invalid." } }); }

  let preview;
  try { preview = await (options.probeFeedImpl ?? probeFeed)(proposal.feed, options.probeOptions ?? {}); }
  catch (error) { return json(422, { error: { code: "SOURCE_PROBE_FAILED", message: error.message || "The feed could not be inspected safely." } }); }

  try {
    const result = await createOrUpdateSourcePullRequest(client, { identity, proposal, preview, state, now });
    const lifecycle = await recordPublishedProposal({
      proposalType: "source",
      identity,
      resourceKey: proposal.id,
      resourceTitle: proposal.name,
      result,
      client,
      publicPath: publicPathForProposal("source"),
      now,
      db: options.db,
      proposalStore: options.proposalLifecycleStore,
    });
    return json(result.unchanged ? 200 : 201, {
      ok: true,
      preview,
      ...result,
      lifecycleRecorded: lifecycle.recorded,
    });
  } catch (error) {
    if (/another World account|already registered|source ID|legacy source/i.test(error?.message ?? "")) {
      return json(409, { error: { code: "SOURCE_CONFLICT", message: error.message } });
    }
    console.error("World source proposal failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "SOURCE_PROPOSAL_FAILED", message: "The source registry pull request could not be created." } });
  }
}

export default async (request) => handle(request);

export const config = {
  path: ["/api/sources", "/api/sources/probe"],
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 12,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
