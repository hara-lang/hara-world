import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import {
  createPostDraft,
  deletePostDraft,
  getPostDraft,
  listPostDrafts,
  markPostProposalError,
  markPostSubmitted,
  markPostWithdrawn,
  PostDraftConflictError,
  updatePostDraft,
} from "./_shared/community-posts.mjs";
import { createGitHubAppClient } from "./_shared/github-app.mjs";
import {
  assertDraftId,
  buildPostDocument,
  postContentSha256,
  postProposalBranch,
  postProposalPath,
  postPullRequestBody,
  POST_PROPOSAL_MARKER,
} from "./_shared/post-proposal.mjs";
import {
  clearWorldSessionCookie,
  json,
  readWorldSession,
  sameOrigin,
} from "./_shared/world-auth.mjs";

const POSTS_PATH = "/api/posts";

class PostProposalConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "PostProposalConflictError";
  }
}

function error(status, code, message, headers) {
  return json(status, { error: { code, message } }, headers);
}

function routeFor(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === POSTS_PATH) return { type: "collection" };
  const match = path.match(/^\/api\/posts\/([0-9a-f-]{36})(?:\/(submit|withdraw))?$/i);
  if (!match) return null;
  try {
    return { type: match[2] ?? "item", id: assertDraftId(match[1]) };
  } catch {
    return null;
  }
}


function resolvePostStore(options) {
  return options.postStore ?? {
    list: listPostDrafts,
    get: getPostDraft,
    create: createPostDraft,
    update: updatePostDraft,
    delete: deletePostDraft,
    markError: markPostProposalError,
    markSubmitted: markPostSubmitted,
    markWithdrawn: markPostWithdrawn,
  };
}

function refPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

async function resolveClient(options, env, now) {
  if (options.githubClient) return options.githubClient;
  return createGitHubAppClient({ env, fetchImpl: options.fetchImpl ?? fetch, now });
}

async function repositoryPathExists(client, path) {
  try {
    await client.request(`/repos/${client.repository}/contents/${path}?ref=${encodeURIComponent(client.baseBranch)}`);
    return true;
  } catch (cause) {
    if (cause?.status === 404) return false;
    throw cause;
  }
}

async function prepareProposalBranch(client, branch, baseSha) {
  try {
    await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(branch)}`);
    await client.request(`/repos/${client.repository}/git/refs/heads/${refPath(branch)}`, {
      method: "PATCH",
      body: { sha: baseSha, force: true },
    });
    return "reset";
  } catch (cause) {
    if (cause?.status !== 404) throw cause;
    await client.request(`/repos/${client.repository}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    });
    return "created";
  }
}

async function putPostFile(client, path, source, branch) {
  await client.request(`/repos/${client.repository}/contents/${path}`, {
    method: "PUT",
    body: {
      message: `Propose Hara World post ${path}`,
      content: Buffer.from(source).toString("base64"),
      branch,
    },
  });
}

async function findOpenPostPullRequest(client, branch) {
  const owner = client.repository.split("/")[0];
  const query = new URLSearchParams({
    state: "open",
    head: `${owner}:${branch}`,
    base: client.baseBranch,
    per_page: "10",
  });
  const pulls = await client.request(`/repos/${client.repository}/pulls?${query}`);
  return Array.isArray(pulls)
    ? pulls.find((pull) => String(pull?.body ?? "").includes(POST_PROPOSAL_MARKER)) ?? null
    : null;
}

export async function createOrUpdatePostPullRequest(client, { identity, draft, now = Date.now() }) {
  const submittedAt = draft.submittedAt ?? new Date(now).toISOString();
  const branch = draft.proposalBranch ?? postProposalBranch(identity, draft.id);
  const path = draft.proposalPath ?? postProposalPath(identity, draft, submittedAt);
  const contentSha256 = postContentSha256(draft);

  if (await repositoryPathExists(client, path)) {
    throw new PostProposalConflictError("A published post already uses this community post path.");
  }

  const baseRef = await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(client.baseBranch)}`);
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== "string" || !/^[0-9a-f]{40}$/i.test(baseSha)) {
    throw new Error("GitHub did not return the post proposal base revision.");
  }

  await prepareProposalBranch(client, branch, baseSha);
  const document = buildPostDocument({ identity, draft, submittedAt });
  await putPostFile(client, path, document, branch);

  const title = `Post: ${draft.title}`;
  const body = postPullRequestBody({
    identity,
    draft,
    draftId: draft.id,
    contentSha256,
  });
  const existingPull = await findOpenPostPullRequest(client, branch);
  let pull;
  if (existingPull) {
    pull = await client.request(`/repos/${client.repository}/pulls/${existingPull.number}`, {
      method: "PATCH",
      body: {
        title,
        body,
        base: client.baseBranch,
        maintainer_can_modify: true,
      },
    });
  } else {
    pull = await client.request(`/repos/${client.repository}/pulls`, {
      method: "POST",
      body: {
        title,
        head: branch,
        base: client.baseBranch,
        body,
        draft: true,
        maintainer_can_modify: true,
      },
    });
  }
  if (!Number.isSafeInteger(Number(pull?.number)) || typeof pull?.html_url !== "string") {
    throw new Error("GitHub did not return a valid post proposal pull request.");
  }
  return {
    branch,
    path,
    baseSha: baseSha.toLowerCase(),
    contentSha256,
    submittedAt,
    number: Number(pull.number),
    pullRequestUrl: pull.html_url,
    reused: Boolean(existingPull),
  };
}

function inactiveResponse(request, status) {
  return error(403, "WORLD_ACCOUNT_INACTIVE", "This Hara World account is not active.", {
    "Set-Cookie": clearWorldSessionCookie(request.url),
    "X-Hara-World-Account-Status": String(status),
  });
}

async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error("The request body must be valid JSON."); }
}

async function requireDraft(identity, id, options, store) {
  const draft = await store.get(identity.id, id, { db: options.db });
  if (!draft) throw Object.assign(new Error("Post draft not found."), { status: 404, code: "POST_DRAFT_NOT_FOUND" });
  return draft;
}

export async function handle(request, options = {}) {
  const env = options.env ?? {};
  const now = options.now ?? Date.now();
  const route = routeFor(new URL(request.url).pathname);
  const store = resolvePostStore(options);
  if (!route) return error(404, "NOT_FOUND", "Unknown community post endpoint.");

  const identity = readWorldSession(request, env, now);
  if (!identity) return error(401, "WORLD_SESSION_REQUIRED", "Establish a Hara World session before working with private post drafts.");

  let accountStatus;
  try {
    accountStatus = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id, { db: options.db });
  } catch {
    return error(503, "WORLD_ACCOUNT_CHECK_FAILED", "World could not verify the community account.");
  }
  if (accountStatus !== "active") return inactiveResponse(request, accountStatus);

  const mutating = ["POST", "PATCH", "DELETE"].includes(request.method);
  if (mutating && (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "community-post")) {
    return error(403, "POST_REQUEST_REJECTED", "The post request must come from Hara World.");
  }

  try {
    if (route.type === "collection" && request.method === "GET") {
      const drafts = await store.list(identity.id, { db: options.db });
      return json(200, { ok: true, drafts });
    }

    if (route.type === "collection" && request.method === "POST") {
      const draft = await store.create(identity, await readJson(request), {
        db: options.db,
        now,
        randomUUIDImpl: options.randomUUIDImpl,
      });
      return json(201, { ok: true, draft });
    }

    if (route.type === "item" && request.method === "GET") {
      const draft = await requireDraft(identity, route.id, options, store);
      return json(200, { ok: true, draft });
    }

    if (route.type === "item" && request.method === "PATCH") {
      const draft = await store.update(identity, route.id, await readJson(request), { db: options.db, now });
      if (!draft) return error(404, "POST_DRAFT_NOT_FOUND", "Post draft not found.");
      return json(200, { ok: true, draft });
    }

    if (route.type === "item" && request.method === "DELETE") {
      const deleted = await store.delete(identity, route.id, { db: options.db });
      if (!deleted) return error(409, "POST_DRAFT_NOT_DELETABLE", "Only an unsubmitted private draft can be deleted.");
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    if (route.type === "submit" && request.method === "POST") {
      const draft = await requireDraft(identity, route.id, options, store);
      if (["merged", "withdrawn", "rejected"].includes(draft.status)) {
        return error(409, "POST_PROPOSAL_CLOSED", `A ${draft.status} post cannot be submitted.`);
      }

      let client;
      try { client = await resolveClient(options, env, now); }
      catch { return error(503, "POST_PUBLISHER_UNAVAILABLE", "The GitHub post proposal publisher is not configured."); }

      let proposal;
      try {
        proposal = await createOrUpdatePostPullRequest(client, { identity, draft, now });
      } catch (cause) {
        if (cause instanceof PostProposalConflictError) {
          return error(409, "POST_PATH_CONFLICT", cause.message);
        }
        console.error("World post proposal failed", { status: cause?.status, name: cause?.name });
        try { await store.markError(identity, route.id, cause?.message, { db: options.db, now }); } catch {}
        return error(502, "POST_PROPOSAL_FAILED", "The post pull request could not be created.");
      }

      let recorded = true;
      let nextDraft = draft;
      try {
        nextDraft = await store.markSubmitted(identity, route.id, proposal, { db: options.db, now });
      } catch (cause) {
        recorded = false;
        console.error("World post proposal state could not be recorded", { name: cause?.name });
      }
      return json(proposal.reused ? 200 : 201, {
        ok: true,
        proposal,
        draft: nextDraft,
        stateRecorded: recorded,
      });
    }

    if (route.type === "withdraw" && request.method === "POST") {
      const draft = await requireDraft(identity, route.id, options, store);
      if (draft.status === "merged") return error(409, "POST_ALREADY_PUBLISHED", "A merged post cannot be withdrawn as a private proposal.");
      if (draft.pullRequestNumber) {
        let client;
        try { client = await resolveClient(options, env, now); }
        catch { return error(503, "POST_PUBLISHER_UNAVAILABLE", "The GitHub post proposal publisher is not configured."); }
        try {
          await client.request(`/repos/${client.repository}/pulls/${draft.pullRequestNumber}`, {
            method: "PATCH",
            body: { state: "closed" },
          });
        } catch (cause) {
          console.error("World post withdrawal failed", { status: cause?.status, name: cause?.name });
          return error(502, "POST_WITHDRAWAL_FAILED", "The post proposal pull request could not be closed.");
        }
      }
      const withdrawn = await store.markWithdrawn(identity, route.id, { db: options.db, now });
      if (!withdrawn) return error(409, "POST_NOT_WITHDRAWABLE", "This post proposal cannot be withdrawn.");
      return json(200, { ok: true, draft: withdrawn });
    }

    const allowed = route.type === "collection"
      ? "GET, POST"
      : route.type === "item"
        ? "GET, PATCH, DELETE"
        : "POST";
    return error(405, "METHOD_NOT_ALLOWED", "Unsupported community post operation.", { Allow: allowed });
  } catch (cause) {
    if (cause instanceof PostDraftConflictError) return error(409, "POST_DRAFT_CONFLICT", cause.message);
    if (cause?.status === 404) return error(404, cause.code ?? "POST_DRAFT_NOT_FOUND", cause.message);
    if (/required|slug|topic|type|characters|HTML|unsafe|JSON/i.test(cause?.message ?? "")) {
      return error(400, "POST_DRAFT_INVALID", cause.message);
    }
    if (cause?.code === "23505") return error(409, "POST_SLUG_TAKEN", "You already have a draft using this post slug.");
    console.error("World post operation failed", { name: cause?.name, code: cause?.code });
    return error(503, "POST_STORAGE_UNAVAILABLE", "Private post storage is unavailable.");
  }
}

export default async (request) => handle(request);

export const config = {
  path: ["/api/posts", "/api/posts/:id", "/api/posts/:id/:action"],
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
