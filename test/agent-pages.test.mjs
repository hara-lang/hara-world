import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the public site exposes agent directory, detail, registration, and JSON registry routes", async () => {
  const [index, detail, register, json, layout] = await Promise.all([
    read("src/pages/agents/index.astro"),
    read("src/pages/agents/[...id].astro"),
    read("src/pages/agents/register.astro"),
    read("src/pages/agents.json.ts"),
    read("src/layouts/SiteLayout.astro"),
  ]);

  assert.match(index, /Agents built with Hara\./);
  assert.match(index, /Register an agent/);
  assert.match(detail, /Registered by a person, not authenticated as a machine\./);
  assert.match(register, /X-Hara-Request": "agent-proposal"/);
  assert.match(register, /gives the agent no credential or delegated authority/);
  assert.match(json, /version: 1, agents/);
  assert.match(layout, />Agents<\/a>/);
  assert.match(layout, /Agent registry JSON/);
});

test("agent content and registry validation are part of the repository check", async () => {
  const [contentConfig, packageJson, builder] = await Promise.all([
    read("src/content.config.ts"),
    read("package.json"),
    read("scripts/build-agent-index.mjs"),
  ]);

  assert.match(contentConfig, /const agents = defineCollection/);
  assert.match(contentConfig, /agent:github:/);
  assert.match(contentConfig, /operator-claimed/);
  assert.match(contentConfig, /key-verified/);
  assert.match(packageJson, /"agents:check": "node scripts\/build-agent-index\.mjs --check"/);
  assert.match(packageJson, /npm run agents:check/);
  assert.match(builder, /registry\/agents\.json/);
  assert.match(builder, /agentIdFor/);
});

test("registration keeps identity, machine verification, and authority separate", async () => {
  const [api, shared, docs] = await Promise.all([
    read("netlify/functions/agent-proposal.mjs"),
    read("netlify/functions/_shared/agent-proposal.mjs"),
    read("docs/agents.md"),
  ]);

  assert.match(api, /readWorldSession/);
  assert.match(api, /communityAccountStatus/);
  assert.match(api, /agent-registry\/github-/);
  assert.match(api, /Registration confirms the accountable human operator/);
  assert.match(shared, /verification: previous\.verification === "key-verified"/);
  assert.doesNotMatch(shared, /input\?\.operatorGithubId|input\?\.operatorGithubLogin|input\?\.keyFingerprint/);
  assert.match(docs, /Directory registration alone must never imply delegation\./);
});
