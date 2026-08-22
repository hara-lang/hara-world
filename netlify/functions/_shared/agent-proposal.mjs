import { agentIdFor } from "./agent-index.mjs";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const PACKAGE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,119})$/;
const INTERFACES = new Set(["web", "chat", "cli", "repl", "api", "mcp", "email", "discord", "other"]);
const STATUSES = new Set(["experimental", "active", "paused", "retired"]);
const AVAILABILITY = new Set(["public", "request", "private", "local"]);
const OPERATION_MODES = new Set(["interactive", "supervised", "scheduled", "autonomous"]);

function cleanText(value, maximum, { required = false, label = "agent field" } = {}) {
  const text = String(value ?? "").replace(/\0/g, "").trim();
  if (required && !text) throw new Error(`A required ${label} is missing.`);
  if (text.length > maximum) throw new Error(`The ${label} exceeds ${maximum} characters.`);
  return text;
}

function cleanList(value, { maximumItems, maximumLength, label, pattern } = {}) {
  const input = Array.isArray(value) ? value : String(value ?? "").split(",");
  const output = [];
  const seen = new Set();
  for (const entry of input) {
    const item = cleanText(entry, maximumLength, { label }).replace(/\s+/g, " ");
    if (!item) continue;
    if (pattern && !pattern.test(item)) throw new Error(`The ${label} contains an unsupported value: ${item}.`);
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length > maximumItems) throw new Error(`An agent may contain at most ${maximumItems} ${label}.`);
  }
  return output;
}

function cleanEnum(value, allowed, fallback, label) {
  const normalized = cleanText(value || fallback, 40, { label }).toLowerCase();
  if (!allowed.has(normalized)) throw new Error(`The ${label} is not supported.`);
  return normalized;
}

function cleanHttps(value, label) {
  const text = cleanText(value, 400, { label });
  if (!text) return undefined;
  let url;
  try { url = new URL(text); } catch { throw new Error(`${label} must be a valid HTTPS URL.`); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be a valid HTTPS URL without embedded credentials.`);
  }
  return url.toString();
}

function assertSafeMarkdown(value) {
  const description = cleanText(value, 8000, { required: true, label: "agent description" });
  if (/<(?:script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math|[A-Za-z][^>]*)\b/i.test(description)) {
    throw new Error("Agent descriptions cannot contain raw HTML.");
  }
  if (/\]\(\s*(?:javascript|data|vbscript):/i.test(description)) {
    throw new Error("The agent description contains an unsafe link target.");
  }
  return description;
}

export function normalizeAgentProposal(input) {
  const slug = cleanText(input?.slug, 64, { required: true, label: "agent slug" }).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new Error("Agent slug must contain lowercase letters, numbers, and single hyphens.");
  const consent = input?.consent === true || input?.consent === "true" || input?.consent === "on";
  if (!consent) throw new Error("Publishing consent is required to register a public agent record.");

  return {
    slug,
    name: cleanText(input?.name, 100, { required: true, label: "agent name" }),
    summary: cleanText(input?.summary, 320, { required: true, label: "agent summary" }),
    status: cleanEnum(input?.status, STATUSES, "experimental", "agent status"),
    availability: cleanEnum(input?.availability, AVAILABILITY, "private", "agent availability"),
    operationMode: cleanEnum(input?.operationMode, OPERATION_MODES, "supervised", "operation mode"),
    capabilities: cleanList(input?.capabilities, { maximumItems: 12, maximumLength: 60, label: "capabilities" }),
    interfaces: cleanList(input?.interfaces, { maximumItems: 9, maximumLength: 20, label: "interfaces", pattern: /^[a-z]+$/ })
      .map((value) => value.toLowerCase())
      .map((value) => {
        if (!INTERFACES.has(value)) throw new Error(`The agent interface is not supported: ${value}.`);
        return value;
      }),
    haraPackages: cleanList(input?.haraPackages, { maximumItems: 16, maximumLength: 120, label: "Hara packages", pattern: PACKAGE_PATTERN }),
    runtime: cleanText(input?.runtime, 160, { label: "runtime description" }) || undefined,
    website: cleanHttps(input?.website, "Website"),
    source: cleanHttps(input?.source, "Source URL"),
    documentation: cleanHttps(input?.documentation, "Documentation URL"),
    description: assertSafeMarkdown(input?.description),
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

export function parseAgentDocument(source) {
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

export function buildAgentDocument({ identity, proposal, existing, now = Date.now() }) {
  if (!identity || !/^\d+$/.test(identity.id ?? "") || !identity.login) {
    throw new TypeError("A verified Learn session is required to build an agent registration.");
  }
  const previous = existing?.data ?? {};
  const date = new Date(now).toISOString().slice(0, 10);
  const data = {
    agentId: agentIdFor(identity.id, proposal.slug),
    operatorGithubId: identity.id,
    operatorGithubLogin: identity.login,
    operatorDisplayName: identity.name || previous.operatorDisplayName || identity.login,
    name: proposal.name,
    summary: proposal.summary,
    status: proposal.status,
    availability: proposal.availability,
    operationMode: proposal.operationMode,
    capabilities: proposal.capabilities,
    interfaces: proposal.interfaces,
    haraPackages: proposal.haraPackages,
    runtime: proposal.runtime,
    website: proposal.website,
    source: proposal.source,
    documentation: proposal.documentation,
    verification: previous.verification === "key-verified" ? "key-verified" : "operator-claimed",
    keyFingerprint: previous.keyFingerprint,
    attestations: Array.isArray(previous.attestations) ? previous.attestations : [],
    registeredAt: previous.registeredAt || date,
    updatedAt: date,
    published: previous.published === false ? false : true,
  };
  const ordered = [
    "agentId", "operatorGithubId", "operatorGithubLogin", "operatorDisplayName",
    "name", "summary", "status", "availability", "operationMode", "capabilities",
    "interfaces", "haraPackages", "runtime", "website", "source", "documentation",
    "verification", "keyFingerprint", "attestations", "registeredAt", "updatedAt", "published",
  ];
  const lines = ["---"];
  for (const key of ordered) {
    const value = scalar(data[key]);
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }
  lines.push("---", "", proposal.description.trim(), "");
  return lines.join("\n");
}

export function agentPath(slug) {
  return `content/agents/${slug}.md`;
}
