const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_AGENTS_PER_OPERATOR = 24;

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function compareAgents(left, right) {
  const owner = String(left.operatorGithubId).localeCompare(String(right.operatorGithubId), "en", { numeric: true });
  return owner || String(left.slug).localeCompare(String(right.slug));
}

export function agentIdFor(operatorGithubId, slug) {
  const id = String(operatorGithubId ?? "");
  const normalizedSlug = String(slug ?? "");
  if (!/^\d+$/.test(id) || !SLUG_PATTERN.test(normalizedSlug)) {
    throw new TypeError("A valid operator identity and agent slug are required.");
  }
  return `agent:github:${id}:${normalizedSlug}`;
}

export function validateAgentIndex(value) {
  const errors = [];
  const root = plainObject(value);
  if (!root || root.version !== 1 || !Array.isArray(root.agents)) {
    return { errors: ["Agent index must contain version 1 and an agents array."], index: null };
  }

  const agents = [];
  const ids = new Map();
  const slugs = new Map();
  const operatorCounts = new Map();
  for (const [position, raw] of root.agents.entries()) {
    const record = plainObject(raw) ?? {};
    const agentId = String(record.agentId ?? "");
    const operatorGithubId = String(record.operatorGithubId ?? "");
    const operatorGithubLogin = String(record.operatorGithubLogin ?? "");
    const slug = String(record.slug ?? "");
    const path = String(record.path ?? "");
    const label = `agents[${position}]`;

    if (!/^\d+$/.test(operatorGithubId)) errors.push(`${label}.operatorGithubId must be numeric.`);
    if (!LOGIN_PATTERN.test(operatorGithubLogin)) errors.push(`${label}.operatorGithubLogin is invalid.`);
    if (!SLUG_PATTERN.test(slug)) errors.push(`${label}.slug is invalid.`);
    if (path !== `content/agents/${slug}.md`) errors.push(`${label}.path must match its slug.`);
    if (/^\d+$/.test(operatorGithubId) && SLUG_PATTERN.test(slug)) {
      const expected = agentIdFor(operatorGithubId, slug);
      if (agentId !== expected) errors.push(`${label}.agentId must be ${expected}.`);
    }
    if (ids.has(agentId)) errors.push(`${label}.agentId duplicates ${ids.get(agentId)}.`);
    else if (agentId) ids.set(agentId, label);
    if (slugs.has(slug)) errors.push(`${label}.slug duplicates ${slugs.get(slug)}.`);
    else if (slug) slugs.set(slug, label);

    operatorCounts.set(operatorGithubId, (operatorCounts.get(operatorGithubId) ?? 0) + 1);
    agents.push({ agentId, operatorGithubId, operatorGithubLogin, slug, path });
  }

  for (const [operatorGithubId, count] of operatorCounts) {
    if (operatorGithubId && count > MAX_AGENTS_PER_OPERATOR) {
      errors.push(`Operator ${operatorGithubId} exceeds the ${MAX_AGENTS_PER_OPERATOR}-agent registry limit.`);
    }
  }

  agents.sort(compareAgents);
  const bySlug = {};
  const byOperator = {};
  for (const agent of agents) {
    if (agent.slug) bySlug[agent.slug] = agent.agentId;
    if (agent.operatorGithubId) {
      if (!byOperator[agent.operatorGithubId]) byOperator[agent.operatorGithubId] = [];
      byOperator[agent.operatorGithubId].push(agent.slug);
    }
  }
  for (const slugsForOperator of Object.values(byOperator)) slugsForOperator.sort();

  if (JSON.stringify(root.bySlug ?? {}) !== JSON.stringify(bySlug)) errors.push("bySlug does not match agents.");
  if (JSON.stringify(root.byOperator ?? {}) !== JSON.stringify(byOperator)) errors.push("byOperator does not match agents.");
  return { errors, index: { version: 1, agents, bySlug, byOperator } };
}

export function assertAgentIndex(value) {
  const result = validateAgentIndex(value);
  if (result.errors.length) throw new Error(`The Git-reviewed agent index is invalid: ${result.errors.join(" ")}`);
  return result.index;
}

export function serialiseAgentIndex(value) {
  return `${JSON.stringify(assertAgentIndex(value), null, 2)}\n`;
}

export function agentForSlug(index, slug) {
  const validated = assertAgentIndex(index);
  const normalizedSlug = String(slug ?? "");
  const agentId = validated.bySlug[normalizedSlug];
  return agentId ? validated.agents.find((agent) => agent.agentId === agentId) ?? null : null;
}

export function agentOwner(index, slug) {
  return agentForSlug(index, slug)?.operatorGithubId ?? null;
}

export function agentsForOperator(index, operatorGithubId) {
  const validated = assertAgentIndex(index);
  const id = String(operatorGithubId ?? "");
  return validated.agents.filter((agent) => agent.operatorGithubId === id);
}

export function updateAgentIndex(index, { operatorGithubId, operatorGithubLogin, slug }) {
  const validated = assertAgentIndex(index);
  const id = String(operatorGithubId ?? "");
  const login = String(operatorGithubLogin ?? "");
  const normalizedSlug = String(slug ?? "");
  if (!/^\d+$/.test(id) || !LOGIN_PATTERN.test(login) || !SLUG_PATTERN.test(normalizedSlug)) {
    throw new TypeError("A valid verified operator identity and agent slug are required.");
  }

  const owner = agentOwner(validated, normalizedSlug);
  if (owner && owner !== id) throw new Error("That public agent slug is already in use.");
  const owned = agentsForOperator(validated, id);
  if (!owner && owned.length >= MAX_AGENTS_PER_OPERATOR) {
    throw new Error(`One operator may register at most ${MAX_AGENTS_PER_OPERATOR} agents.`);
  }

  const agentId = agentIdFor(id, normalizedSlug);
  const agents = validated.agents.filter((agent) => agent.agentId !== agentId);
  agents.push({
    agentId,
    operatorGithubId: id,
    operatorGithubLogin: login,
    slug: normalizedSlug,
    path: `content/agents/${normalizedSlug}.md`,
  });
  agents.sort(compareAgents);

  const bySlug = {};
  const byOperator = {};
  for (const agent of agents) {
    bySlug[agent.slug] = agent.agentId;
    if (!byOperator[agent.operatorGithubId]) byOperator[agent.operatorGithubId] = [];
    byOperator[agent.operatorGithubId].push(agent.slug);
  }
  for (const slugsForOperator of Object.values(byOperator)) slugsForOperator.sort();
  return { version: 1, agents, bySlug, byOperator };
}
