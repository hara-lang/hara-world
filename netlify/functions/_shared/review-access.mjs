import { parseProfileDocument } from "./profile-proposal.mjs";

const REVIEW_ROLES = new Set(["maintainer", "editor", "reviewer", "moderator"]);
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

function decodeContent(payload) {
  if (typeof payload?.content !== "string" || payload.encoding !== "base64") return "";
  return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
}

function assertIdentity(identity) {
  const id = String(identity?.id ?? "");
  const login = String(identity?.login ?? "");
  if (!/^\d+$/.test(id) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) {
    throw new TypeError("A verified World identity is required for review access.");
  }
  return { id, login };
}

async function repositoryPermission(identity, client) {
  try {
    const payload = await client.request(`/repos/${client.repository}/collaborators/${encodeURIComponent(identity.login)}/permission`);
    const permission = String(payload?.permission ?? "").toLowerCase();
    if (WRITE_PERMISSIONS.has(permission)) return { allowed: true, source: "repository", permission, roles: [] };
  } catch (error) {
    if (![403, 404].includes(error?.status)) throw error;
  }
  return null;
}

async function reviewedProfileRoles(identity, client) {
  let indexPayload;
  try {
    indexPayload = await client.request(`/repos/${client.repository}/contents/registry/profiles.json?ref=${encodeURIComponent(client.baseBranch)}`);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
  let index;
  try { index = JSON.parse(decodeContent(indexPayload)); }
  catch { return null; }
  const slug = index?.byGithubId?.[identity.id];
  if (typeof slug !== "string" || !slug) return null;
  const record = Array.isArray(index?.profiles)
    ? index.profiles.find((profile) => String(profile.githubId) === identity.id && profile.slug === slug)
    : null;
  const path = record?.path ?? `content/profiles/${slug}.md`;
  let profilePayload;
  try {
    profilePayload = await client.request(`/repos/${client.repository}/contents/${path}?ref=${encodeURIComponent(client.baseBranch)}`);
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
  const profile = parseProfileDocument(decodeContent(profilePayload));
  if (String(profile.data.githubId) !== identity.id) return null;
  const roles = Array.isArray(profile.data.roles) ? profile.data.roles.map((role) => String(role).toLowerCase()) : [];
  const matched = roles.filter((role) => REVIEW_ROLES.has(role));
  return matched.length ? { allowed: true, source: "profile-role", permission: null, roles: matched } : null;
}

export async function reviewAccess(identityValue, client) {
  const identity = assertIdentity(identityValue);
  if (!client?.repository || !client?.baseBranch || typeof client?.request !== "function") {
    throw new TypeError("A configured GitHub App client is required for review access.");
  }
  const repository = await repositoryPermission(identity, client);
  if (repository) return repository;
  const profile = await reviewedProfileRoles(identity, client);
  return profile ?? { allowed: false, source: "none", permission: null, roles: [] };
}
