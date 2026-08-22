const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const HTTPS_URL_PATTERN = /^https:\/\//i;

function cleanText(value, maximum, { required = false } = {}) {
  const text = String(value ?? "").replace(/\0/g, "").trim();
  if (required && !text) throw new Error("A required profile field is missing.");
  if (text.length > maximum) throw new Error(`A profile field exceeds ${maximum} characters.`);
  return text;
}

function cleanList(value, maximumItems = 12, maximumLength = 40) {
  const input = Array.isArray(value) ? value : String(value ?? "").split(",");
  const output = [];
  const seen = new Set();
  for (const entry of input) {
    const item = cleanText(entry, maximumLength).replace(/\s+/g, " ");
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length > maximumItems) throw new Error(`A profile may contain at most ${maximumItems} interests.`);
  }
  return output;
}

function cleanWebsite(value) {
  const text = cleanText(value, 300);
  if (!text) return undefined;
  let url;
  try { url = new URL(text); } catch { throw new Error("Website must be a valid HTTPS URL."); }
  if (!HTTPS_URL_PATTERN.test(url.toString()) || url.username || url.password) {
    throw new Error("Website must be a valid HTTPS URL.");
  }
  return url.toString();
}

export function normalizeProfileProposal(input) {
  const slug = cleanText(input?.slug, 64, { required: true }).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new Error("Profile slug must contain lowercase letters, numbers, and single hyphens.");
  const consent = input?.consent === true || input?.consent === "true" || input?.consent === "on";
  if (!consent) throw new Error("Publishing consent is required to propose a public profile.");
  const bio = cleanText(input?.bio, 5000, { required: true });
  if (/<(?:script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math|[A-Za-z][^>]*)\b/i.test(bio)) {
    throw new Error("Profile biography cannot contain raw HTML.");
  }
  if (/\]\(\s*(?:javascript|data|vbscript):/i.test(bio)) {
    throw new Error("Profile biography contains an unsafe link target.");
  }
  return {
    slug,
    displayName: cleanText(input?.displayName, 100, { required: true }),
    summary: cleanText(input?.summary, 320, { required: true }),
    location: cleanText(input?.location, 100) || undefined,
    website: cleanWebsite(input?.website),
    interests: cleanList(input?.interests),
    bio,
  };
}

function parseScalar(value) {
  const text = value.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (text.startsWith('"') || text.startsWith("[")) {
    try { return JSON.parse(text); } catch {}
  }
  return text;
}

export function parseProfileDocument(source) {
  const match = String(source).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: String(source).trim() };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    data[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }
  return { data, body: String(source).slice(match[0].length).trim() };
}

function scalar(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return undefined;
  return String(value);
}

export function buildProfileDocument({ identity, proposal, existing, now = Date.now() }) {
  if (!identity || !/^\d+$/.test(identity.id ?? "") || !identity.login) {
    throw new TypeError("A verified Learn session is required to build a profile proposal.");
  }
  const previous = existing?.data ?? {};
  const data = {
    githubId: identity.id,
    githubLogin: identity.login,
    displayName: proposal.displayName,
    summary: proposal.summary,
    website: proposal.website,
    location: proposal.location,
    interests: proposal.interests,
    roles: Array.isArray(previous.roles) ? previous.roles : [],
    links: Array.isArray(previous.links) ? previous.links : [],
    joinedAt: previous.joinedAt || new Date(now).toISOString().slice(0, 10),
    published: previous.published === false ? false : true,
  };
  const ordered = [
    "githubId", "githubLogin", "displayName", "summary", "website", "location",
    "interests", "roles", "links", "joinedAt", "published",
  ];
  const lines = ["---"];
  for (const key of ordered) {
    const value = scalar(data[key]);
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }
  lines.push("---", "", proposal.bio.trim(), "");
  return lines.join("\n");
}

export function profilePath(slug) {
  return `content/profiles/${slug}.md`;
}
