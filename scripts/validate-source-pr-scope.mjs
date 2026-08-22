import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { assertSourceRegistry } from "../netlify/functions/_shared/source-proposal.mjs";

const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
const match = branch.match(/^source-registry\/github-(\d+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
if (!match) {
  console.error("Authenticated source PRs must use source-registry/github-<numeric-id>/<source-id>.");
  process.exit(1);
}
const [, githubId, sourceId] = match;
const base = process.env.GITHUB_BASE_REF || "main";
const changedOutput = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { encoding: "utf8" });
const changed = changedOutput.split(/\r?\n/).filter(Boolean).sort();
if (changed.length !== 1 || changed[0] !== "registry/sources.json") {
  console.error("An authenticated source proposal may change only registry/sources.json.");
  if (changed.length) console.error(`Changed files: ${changed.join(", ")}`);
  process.exit(1);
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (eventPath) {
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const body = String(event.pull_request?.body ?? "");
  if (!body.includes("<!-- hara-learn-source-proposal -->") || !body.includes(`<!-- hara-learn-source:github:${githubId}:${sourceId} -->`)) {
    console.error("The pull request does not carry the authenticated source markers.");
    process.exit(1);
  }
}

const next = assertSourceRegistry(JSON.parse(await readFile("registry/sources.json", "utf8")));
const baseSource = execFileSync("git", ["show", `origin/${base}:registry/sources.json`], { encoding: "utf8" });
const previous = assertSourceRegistry(JSON.parse(baseSource));
const previousById = new Map(previous.sources.map((source) => [source.id, source]));
const nextById = new Map(next.sources.map((source) => [source.id, source]));
const ids = new Set([...previousById.keys(), ...nextById.keys()]);
const changedIds = [...ids].filter((id) => JSON.stringify(previousById.get(id) ?? null) !== JSON.stringify(nextById.get(id) ?? null));
if (changedIds.length !== 1 || changedIds[0] !== sourceId) {
  console.error(`The source proposal must change exactly ${sourceId}; changed IDs: ${changedIds.join(", ") || "none"}.`);
  process.exit(1);
}

const proposed = nextById.get(sourceId);
if (!proposed) {
  console.error("The authenticated source proposal cannot delete its registry record.");
  process.exit(1);
}
if (String(proposed.registrantGithubId) !== githubId) {
  console.error("The source registrant does not match the authenticated proposal branch.");
  process.exit(1);
}

const current = previousById.get(sourceId);
if (!current) {
  if (proposed.status !== "proposed") {
    console.error("A new source must enter the registry with status proposed.");
    process.exit(1);
  }
  if (proposed.maxItemsPerRun !== undefined) {
    console.error("A new source proposal cannot choose its polling limit.");
    process.exit(1);
  }
} else {
  if (String(current.registrantGithubId ?? "") !== githubId) {
    console.error("The authenticated registrant does not own the existing source record.");
    process.exit(1);
  }
  if (proposed.status !== current.status) {
    console.error("The public source form cannot change reviewer-controlled activation status.");
    process.exit(1);
  }
  if (proposed.maxItemsPerRun !== current.maxItemsPerRun) {
    console.error("The public source form cannot change reviewer-controlled polling policy.");
    process.exit(1);
  }
  if (proposed.registeredAt !== current.registeredAt) {
    console.error("The original source registration date must be preserved.");
    process.exit(1);
  }
}

console.log(`Verified authenticated source proposal ${sourceId} for github:${githubId}.`);
