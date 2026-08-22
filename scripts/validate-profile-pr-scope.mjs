import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./lib/article.mjs";
import { assertProfileIndex } from "../netlify/functions/_shared/profile-index.mjs";

const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
const match = branch.match(/^profile\/github-(\d+)$/);
if (!match) {
  console.error("Authenticated profile PRs must use profile/github-<numeric-id>.");
  process.exit(1);
}
const githubId = match[1];
const base = process.env.GITHUB_BASE_REF || "main";
const output = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { encoding: "utf8" });
const changed = output.split(/\r?\n/).filter(Boolean).sort();
const profileFiles = changed.filter((file) => /^content\/profiles\/[a-z0-9-]+\.md$/.test(file));
const allowed = new Set([...profileFiles, "registry/profiles.json"]);
const unexpected = changed.filter((file) => !allowed.has(file));
if (profileFiles.length !== 1 || unexpected.length || !changed.includes("registry/profiles.json")) {
  console.error("A profile proposal must change exactly one profile Markdown file and registry/profiles.json.");
  if (unexpected.length) console.error(`Unexpected files: ${unexpected.join(", ")}`);
  process.exit(1);
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (eventPath) {
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const body = String(event.pull_request?.body ?? "");
  if (!body.includes("<!-- hara-learn-profile-proposal -->") || !body.includes(`<!-- hara-learn-profile:github:${githubId} -->`)) {
    console.error("The pull request does not carry the authenticated profile markers.");
    process.exit(1);
  }
}

const profilePath = profileFiles[0];
const profile = parseFrontmatter(await readFile(profilePath, "utf8"));
if (String(profile.data.githubId) !== githubId) {
  console.error("The profile GitHub ID does not match its authenticated proposal branch.");
  process.exit(1);
}
const index = assertProfileIndex(JSON.parse(await readFile("registry/profiles.json", "utf8")));
const slug = path.basename(profilePath, ".md");
if (index.byGithubId[githubId] !== slug || index.bySlug[slug] !== githubId) {
  console.error("The profile index does not match the proposed profile identity and slug.");
  process.exit(1);
}
console.log(`Verified authenticated profile proposal for github:${githubId}.`);
