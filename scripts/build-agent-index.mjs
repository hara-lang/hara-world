import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./lib/article.mjs";
import { agentIdFor, serialiseAgentIndex, validateAgentIndex } from "../netlify/functions/_shared/agent-index.mjs";

const root = process.cwd();
const agentDirectory = path.join(root, "content", "agents");
const outputPath = path.join(root, "registry", "agents.json");
const check = process.argv.includes("--check");
const entries = await readdir(agentDirectory, { withFileTypes: true });
const agents = [];
const errors = [];

for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  const slug = entry.name.slice(0, -3);
  const source = await readFile(path.join(agentDirectory, entry.name), "utf8");
  const { data } = parseFrontmatter(source);
  const operatorGithubId = String(data.operatorGithubId ?? "");
  const operatorGithubLogin = String(data.operatorGithubLogin ?? "");
  const agentId = String(data.agentId ?? "");
  if (data.published !== true && data.published !== false) errors.push(`${entry.name}: published must be boolean.`);
  if (typeof data.name !== "string" || !data.name.trim()) errors.push(`${entry.name}: name is required.`);
  if (typeof data.summary !== "string" || !data.summary.trim()) errors.push(`${entry.name}: summary is required.`);
  try {
    const expected = agentIdFor(operatorGithubId, slug);
    if (agentId !== expected) errors.push(`${entry.name}: agentId must be ${expected}.`);
  } catch (error) {
    errors.push(`${entry.name}: ${error.message}`);
  }
  agents.push({
    agentId,
    operatorGithubId,
    operatorGithubLogin,
    slug,
    path: `content/agents/${entry.name}`,
  });
}

agents.sort((left, right) => {
  const owner = left.operatorGithubId.localeCompare(right.operatorGithubId, "en", { numeric: true });
  return owner || left.slug.localeCompare(right.slug);
});
const bySlug = {};
const byOperator = {};
for (const agent of agents) {
  bySlug[agent.slug] = agent.agentId;
  if (!byOperator[agent.operatorGithubId]) byOperator[agent.operatorGithubId] = [];
  byOperator[agent.operatorGithubId].push(agent.slug);
}
for (const slugs of Object.values(byOperator)) slugs.sort();

const candidate = { version: 1, agents, bySlug, byOperator };
const validation = validateAgentIndex(candidate);
errors.push(...validation.errors);
if (errors.length) {
  console.error(`Agent registry is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const expected = serialiseAgentIndex(validation.index);
if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current !== expected) {
    console.error("registry/agents.json is stale. Run npm run agents:index and commit the result.");
    process.exit(1);
  }
  console.log(`Agent index valid: ${agents.length} agent${agents.length === 1 ? "" : "s"}.`);
} else {
  await writeFile(outputPath, expected);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${agents.length} agent${agents.length === 1 ? "" : "s"}.`);
}
