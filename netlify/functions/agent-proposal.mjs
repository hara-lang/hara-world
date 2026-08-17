import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import {
  agentForSlug,
  agentOwner,
  agentsForOperator,
  assertAgentIndex,
  serialiseAgentIndex,
  updateAgentIndex,
} from "./_shared/agent-index.mjs";
import {
  agentPath,
  buildAgentDocument,
  normalizeAgentProposal,
  parseAgentDocument,
} from "./_shared/agent-proposal.mjs";
import {
  publicPathForProposal,
  recordPublishedProposal,
} from "./_shared/proposal-recording.mjs";
import {
  clearWorldSessionCookie,
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const AGENT_PATH = "/api/agents";
const AGENT_INDEX_PATH = "registry/agents.json";
const PR_MARKER = "<!-- hara-world-agent-proposal -->";

function decodeContent(payload) {
  if (typeof payload?.content !== "string" || payload.encoding !== "base64") return "";
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

async function readRepositoryFile(client, path) {
  const payload = await client.request(`/repos/${client.repository}/contents/${path}?ref=${encodeURIComponent(client.baseBranch)}`);
  return { path, sha: payload.sha, source: decodeContent(payload) };
}

async function loadAgentIndex(client) {
  const indexFile = await readRepositoryFile(client, AGENT_INDEX_PATH);
  let index;
  try { index = assertAgentIndex(JSON.parse(indexFile.source)); }
  catch (error) { throw new Error(`Agent index could not be validated: ${error.message}`); }
  return { indexFile, index };
}

async function readAgentRecord(client, indexed) {
  const file = await readRepositoryFile(client, indexed.path);
  const parsed = parseAgentDocument(file.source);
  if (String(parsed.data.agentId) !== indexed.agentId) throw new Error("Agent index and public record disagree.");
  if (String(parsed.data.operatorGithubId) !== indexed.operatorGithubId) throw new Error("Agent operator identity does not match the index.");
  return { ...file, ...parsed, indexed };
}

function publicAgent(record) {
  const data = record.data ?? {};
  return {
    exists: true,
    path: record.path,
    slug: record.indexed.slug,
    agentId: data.agentId,
    operatorGithubId: String(data.operatorGithubId),
    operatorGithubLogin: data.operatorGithubLogin,
    operatorDisplayName: data.operatorDisplayName,
    name: data.name,
    summary: data.summary,
    status: data.status,
    availability: data.availability,
    operationMode: data.operationMode,
    capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
    interfaces: Array.isArray(data.interfaces) ? data.interfaces : [],
    haraPackages: Array.isArray(data.haraPackages) ? data.haraPackages : [],
    runtime: data.runtime ?? "",
    website: data.website ?? "",
    source: data.source ?? "",
    documentation: data.documentation ?? "",
    verification: data.verification ?? "operator-claimed",
    keyFingerprint: data.keyFingerprint ?? "",
    description: record.body ?? "",
    registeredAt: data.registeredAt,
    updatedAt: data.updatedAt,
    published: data.published === true,
  };
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

function branchName(identity, slug) {
  return `agent-registry/github-${identity.id}/${slug}`;
}

function refPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

function pullRequestBody(identity, proposal) {
  return [
    PR_MARKER,
    `<!-- hara-world-agent:agent:github:${identity.id}:${proposal.slug} -->`,
    "## Hara World agent registration",
    "",
    `Prepared from the authenticated World session for operator \`github:${identity.id}\` (\`@${identity.login}\`).`,
    "",
    `Agent: **${proposal.name}** (\`${proposal.slug}\`)`,
    "",
    "- The stable operator identity came from Hara Identity, not from form fields.",
    "- The public agent record and reciprocal registry index are updated together.",
    "- Merge remains the registration event.",
    "- Registration confirms the accountable human operator, not Hara endorsement or permission for the agent to act.",
    "- Agent authentication, delegated posting authority, keys, package authority, and runtime access are outside this record.",
  ].join("\n");
}

async function findOpenAgentPullRequest(client, branch) {
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
    message: `Propose World agent record ${path}`,
    content: Buffer.from(source).toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  await client.request(`/repos/${client.repository}/contents/${path}`, { method: "PUT", body });
}

async function createOrUpdateAgentPullRequest(client, { identity, proposal, state, now }) {
  const owner = agentOwner(state.index, proposal.slug);
  if (owner && owner !== identity.id) throw new Error("That public agent slug is already in use.");
  const indexed = agentForSlug(state.index, proposal.slug);
  const current = indexed ? await readAgentRecord(client, indexed) : null;
  const targetPath = current?.path ?? agentPath(proposal.slug);
  const document = buildAgentDocument({ identity, proposal, existing: current, now });
  const nextIndex = updateAgentIndex(state.index, {
    operatorGithubId: identity.id,
    operatorGithubLogin: identity.login,
    slug: proposal.slug,
  });
  const indexSource = serialiseAgentIndex(nextIndex);

  if (current?.source === document && state.indexFile.source === indexSource) {
    return { unchanged: true, path: targetPath, pullRequestUrl: null, number: null, reused: false };
  }

  const baseRef = await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(client.baseBranch)}`);
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== "string") throw new Error("GitHub did not return the agent-registry base revision.");
  const branch = branchName(identity, proposal.slug);
  await prepareProposalBranch(client, branch, baseSha);
  await putFile(client, targetPath, document, branch, current?.sha);
  await putFile(client, AGENT_INDEX_PATH, indexSource, branch, state.indexFile.sha);

  const title = `Agent: ${proposal.name}`;
  const body = pullRequestBody(identity, proposal);
  const existingPull = await findOpenAgentPullRequest(client, branch);
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
      code: "WORLD_ACCOUNT_INACTIVE",
      message: "This Hara World account is not active.",
      status,
    },
  }, { "Set-Cookie": clearWorldSessionCookie(request.url) });
}

export async function handle(request, options = {}) {
  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  if (new URL(request.url).pathname !== AGENT_PATH) {
    return json(404, { error: { code: "NOT_FOUND", message: "Unknown agent endpoint." } });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and POST are supported." } }, { Allow: "GET, POST" });
  }

  const identity = readWorldSession(request, env, now);
  if (!identity) return json(401, { error: { code: "WORLD_SESSION_REQUIRED", message: "Establish a Hara World session before registering an agent." } });
  if (request.method === "POST" && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "agent-proposal")) {
    return json(403, { error: { code: "AGENT_REQUEST_REJECTED", message: "The agent registration must come from Hara World." } });
  }

  let status;
  try { status = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id); }
  catch { return json(503, { error: { code: "WORLD_ACCOUNT_CHECK_FAILED", message: "World could not verify the community account." } }); }
  if (status !== "active") return inactiveResponse(request, status);

  let client;
  try { client = await resolveClient(options, env, now); }
  catch { return json(503, { error: { code: "AGENT_PUBLISHER_UNAVAILABLE", message: "The GitHub agent publisher is not configured." } }); }

  let state;
  try { state = await loadAgentIndex(client); }
  catch (error) {
    console.error("World agent index lookup failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "AGENT_REGISTRY_UNAVAILABLE", message: "The agent registry could not be read from GitHub." } });
  }

  if (request.method === "GET") {
    try {
      const records = await Promise.all(agentsForOperator(state.index, identity.id).map((indexed) => readAgentRecord(client, indexed)));
      return json(200, { ok: true, agents: records.map(publicAgent) });
    } catch (error) {
      console.error("World agent records could not be loaded", { status: error?.status, name: error?.name });
      return json(502, { error: { code: "AGENT_RECORDS_UNAVAILABLE", message: "The registered agent records could not be loaded." } });
    }
  }

  let proposal;
  try { proposal = normalizeAgentProposal(await request.json()); }
  catch (error) { return json(400, { error: { code: "AGENT_INVALID", message: error.message || "The agent registration is invalid." } }); }

  try {
    const result = await createOrUpdateAgentPullRequest(client, { identity, proposal, state, now });
    const lifecycle = await recordPublishedProposal({
      proposalType: "agent",
      identity,
      resourceKey: `agent:github:${identity.id}:${proposal.slug}`,
      resourceTitle: proposal.name,
      result,
      client,
      publicPath: publicPathForProposal("agent", { slug: proposal.slug }),
      now,
      db: options.db,
      proposalStore: options.proposalLifecycleStore,
    });
    return json(result.unchanged ? 200 : 201, { ok: true, ...result, lifecycleRecorded: lifecycle.recorded });
  } catch (error) {
    if (/slug|at most/.test(error?.message ?? "")) return json(409, { error: { code: "AGENT_CONFLICT", message: error.message } });
    console.error("World agent proposal failed", { status: error?.status, name: error?.name });
    return json(502, { error: { code: "AGENT_PROPOSAL_FAILED", message: "The agent pull request could not be created." } });
  }
}

export default async (request) => handle(request);

export const config = {
  path: "/api/agents",
  method: ["GET", "POST"],
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
