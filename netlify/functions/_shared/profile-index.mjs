const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function compareProfiles(left, right) {
  return String(left.githubId).localeCompare(String(right.githubId), "en", { numeric: true });
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function validateProfileIndex(value) {
  const errors = [];
  const root = plainObject(value);
  if (!root || root.version !== 1 || !Array.isArray(root.profiles)) {
    return { errors: ["Profile index must contain version 1 and a profiles array."], index: null };
  }
  const profiles = [];
  const ids = new Map();
  const slugs = new Map();
  for (const [position, raw] of root.profiles.entries()) {
    const record = plainObject(raw) ?? {};
    const githubId = String(record.githubId ?? "");
    const githubLogin = String(record.githubLogin ?? "");
    const slug = String(record.slug ?? "");
    const path = String(record.path ?? "");
    const label = `profiles[${position}]`;
    if (!/^\d+$/.test(githubId)) errors.push(`${label}.githubId must be numeric.`);
    if (!LOGIN_PATTERN.test(githubLogin)) errors.push(`${label}.githubLogin is invalid.`);
    if (!SLUG_PATTERN.test(slug)) errors.push(`${label}.slug is invalid.`);
    if (path !== `content/profiles/${slug}.md`) errors.push(`${label}.path must match its slug.`);
    if (ids.has(githubId)) errors.push(`${label}.githubId duplicates ${ids.get(githubId)}.`);
    else if (githubId) ids.set(githubId, label);
    if (slugs.has(slug)) errors.push(`${label}.slug duplicates ${slugs.get(slug)}.`);
    else if (slug) slugs.set(slug, label);
    profiles.push({ githubId, githubLogin, slug, path });
  }
  profiles.sort(compareProfiles);
  const byGithubId = {};
  const bySlug = {};
  for (const profile of profiles) {
    if (profile.githubId) byGithubId[profile.githubId] = profile.slug;
    if (profile.slug) bySlug[profile.slug] = profile.githubId;
  }
  if (JSON.stringify(root.byGithubId ?? {}) !== JSON.stringify(byGithubId)) errors.push("byGithubId does not match profiles.");
  if (JSON.stringify(root.bySlug ?? {}) !== JSON.stringify(bySlug)) errors.push("bySlug does not match profiles.");
  return { errors, index: { version: 1, profiles, byGithubId, bySlug } };
}

export function assertProfileIndex(value) {
  const result = validateProfileIndex(value);
  if (result.errors.length) throw new Error(`The Git-reviewed profile index is invalid: ${result.errors.join(" ")}`);
  return result.index;
}

export function serialiseProfileIndex(value) {
  return `${JSON.stringify(assertProfileIndex(value), null, 2)}\n`;
}

export function profileForIdentity(index, githubId) {
  const validated = assertProfileIndex(index);
  const id = String(githubId ?? "");
  const slug = validated.byGithubId[id];
  return slug ? validated.profiles.find((profile) => profile.githubId === id) ?? null : null;
}

export function profileOwner(index, slug) {
  const validated = assertProfileIndex(index);
  return validated.bySlug[String(slug ?? "")] ?? null;
}

export function updateProfileIndex(index, { githubId, githubLogin, slug }) {
  const validated = assertProfileIndex(index);
  const id = String(githubId ?? "");
  if (!/^\d+$/.test(id) || !LOGIN_PATTERN.test(String(githubLogin ?? "")) || !SLUG_PATTERN.test(String(slug ?? ""))) {
    throw new TypeError("A valid verified profile identity is required.");
  }
  const previousSlug = validated.byGithubId[id];
  const owner = validated.bySlug[slug];
  if (owner && owner !== id) throw new Error("That public profile slug is already in use.");
  if (previousSlug && previousSlug !== slug) throw new Error("A merged profile slug cannot be changed.");

  const profiles = validated.profiles.filter((profile) => profile.githubId !== id);
  profiles.push({ githubId: id, githubLogin, slug, path: `content/profiles/${slug}.md` });
  profiles.sort(compareProfiles);
  const byGithubId = {};
  const bySlug = {};
  for (const profile of profiles) {
    byGithubId[profile.githubId] = profile.slug;
    bySlug[profile.slug] = profile.githubId;
  }
  return { version: 1, profiles, byGithubId, bySlug };
}
