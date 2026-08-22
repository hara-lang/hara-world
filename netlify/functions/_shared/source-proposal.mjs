import { validateRegistry } from "../../../scripts/lib/source-registry.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOPIC_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const PERMISSIONS = new Set(["owner", "authorised", "open-licence"]);
const SYNDICATION = new Set(["link", "excerpt", "full"]);

function cleanText(value, maximum, { required = false, label = "field" } = {}) {
  const text = String(value ?? "").replace(/\0/g, "").trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters.`);
  return text;
}

function cleanHttps(value, label, { required = false } = {}) {
  const text = cleanText(value, 2048, { required, label });
  if (!text) return undefined;
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be a valid HTTPS URL without embedded credentials.`);
  }
  return url.toString();
}

function cleanTopics(value) {
  const input = Array.isArray(value) ? value : String(value ?? "").split(",");
  const output = [];
  const seen = new Set();
  for (const entry of input) {
    const topic = cleanText(entry, 40, { label: "Topic" }).toLowerCase().replace(/\s+/g, "-");
    if (!topic) continue;
    if (!TOPIC_PATTERN.test(topic)) throw new Error(`Topic is not valid: ${topic}.`);
    if (seen.has(topic)) continue;
    seen.add(topic);
    output.push(topic);
    if (output.length > 12) throw new Error("A source may contain at most twelve topics.");
  }
  if (output.length === 0) throw new Error("At least one topic is required.");
  return output;
}

function cleanLanguage(value) {
  const language = cleanText(value, 35, { label: "Language" });
  if (!language) return undefined;
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(language)) {
    throw new Error("Language must use a BCP 47-style tag such as en or en-AU.");
  }
  return language;
}

function cleanEnum(value, allowed, label) {
  const text = cleanText(value, 30, { required: true, label }).toLowerCase();
  if (!allowed.has(text)) throw new Error(`${label} is not supported.`);
  return text;
}

export function normalizeSourceProposal(input) {
  const id = cleanText(input?.id, 64, { required: true, label: "Source ID" }).toLowerCase();
  if (!ID_PATTERN.test(id)) throw new Error("Source ID must use lowercase kebab-case.");
  const permission = cleanEnum(input?.permission, PERMISSIONS, "Permission basis");
  const syndication = cleanEnum(input?.syndication, SYNDICATION, "Syndication mode");
  const license = cleanText(input?.license, 500, { label: "Licence or permission reference" }) || undefined;
  if (permission === "open-licence" && !license) throw new Error("An open-licence source must identify its licence.");
  if (syndication === "full" && permission !== "owner" && !license) {
    throw new Error("Full-text syndication requires owner permission or an explicit licence reference.");
  }
  const consent = input?.consent === true || input?.consent === "true" || input?.consent === "on";
  if (!consent) throw new Error("The source submission attestations are required.");

  return {
    id,
    name: cleanText(input?.name, 120, { required: true, label: "Publication name" }),
    homepage: cleanHttps(input?.homepage, "Homepage", { required: true }),
    feed: cleanHttps(input?.feed, "Feed URL", { required: true }),
    contact: cleanHttps(input?.contact, "Public contact URL", { required: true }),
    permission,
    syndication,
    license,
    relevance: cleanText(input?.relevance, 1200, { required: true, label: "Relevance statement" }),
    topics: cleanTopics(input?.topics),
    defaultAuthor: cleanText(input?.defaultAuthor, 120, { label: "Default author" }) || undefined,
    language: cleanLanguage(input?.language),
  };
}

export function assertSourceRegistry(value) {
  const errors = validateRegistry(value);
  if (errors.length) throw new Error(`The Git-reviewed source registry is invalid: ${errors.join(" ")}`);
  return value;
}

export function sourcesForRegistrant(registry, githubUserId) {
  const value = assertSourceRegistry(registry);
  const id = String(githubUserId ?? "");
  if (!/^\d+$/.test(id)) throw new TypeError("A stable numeric GitHub identity is required.");
  return value.sources.filter((source) => String(source.registrantGithubId ?? "") === id);
}

export function sourceForId(registry, id) {
  return assertSourceRegistry(registry).sources.find((source) => source.id === String(id ?? "")) ?? null;
}

export function updateSourceRegistry(registry, { identity, proposal, feedUrl, now = Date.now() }) {
  const value = assertSourceRegistry(registry);
  if (!identity || !/^\d+$/.test(identity.id ?? "") || !GITHUB_LOGIN_PATTERN.test(String(identity.login ?? ""))) {
    throw new TypeError("A verified Learn session is required to propose a source.");
  }
  const resolvedFeed = cleanHttps(feedUrl ?? proposal.feed, "Probed feed URL", { required: true });
  const current = sourceForId(value, proposal.id);
  if (current && !current.registrantGithubId) {
    throw new Error("That legacy source requires manual ownership assignment before it can be edited through Learn.");
  }
  if (current && String(current.registrantGithubId) !== identity.id) {
    throw new Error("That source ID is maintained by another Learn account.");
  }
  const feedOwner = value.sources.find((source) => source.feed === resolvedFeed && source.id !== proposal.id);
  if (feedOwner) throw new Error(`That feed is already registered as ${feedOwner.id}.`);
  const date = new Date(now).toISOString().slice(0, 10);
  const next = {
    id: proposal.id,
    name: proposal.name,
    homepage: proposal.homepage,
    feed: resolvedFeed,
    status: current?.status ?? "proposed",
    syndication: proposal.syndication,
    permission: proposal.permission,
    license: proposal.license,
    defaultAuthor: proposal.defaultAuthor,
    contact: proposal.contact,
    topics: proposal.topics,
    language: proposal.language,
    maxItemsPerRun: current?.maxItemsPerRun,
    relevance: proposal.relevance,
    registrantGithubId: identity.id,
    registrantGithubLogin: identity.login,
    registeredAt: current?.registeredAt ?? date,
    updatedAt: date,
  };
  const sources = value.sources.filter((source) => source.id !== proposal.id);
  sources.push(Object.fromEntries(Object.entries(next).filter(([, item]) => item !== undefined)));
  sources.sort((left, right) => left.id.localeCompare(right.id));
  const candidate = { version: 1, sources };
  assertSourceRegistry(candidate);
  return { registry: candidate, current, source: sourceForId(candidate, proposal.id) };
}

export function serialiseSourceRegistry(value) {
  const registry = assertSourceRegistry(value);
  const sources = [...registry.sources].sort((left, right) => left.id.localeCompare(right.id));
  return `${JSON.stringify({ version: 1, sources }, null, 2)}\n`;
}
