import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./lib/article.mjs";
import { serialiseProfileIndex, validateProfileIndex } from "../netlify/functions/_shared/profile-index.mjs";

const root = process.cwd();
const profileDirectory = path.join(root, "content", "profiles");
const outputPath = path.join(root, "registry", "profiles.json");
const check = process.argv.includes("--check");
const entries = await readdir(profileDirectory, { withFileTypes: true });
const profiles = [];
const errors = [];

for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
  const slug = entry.name.slice(0, -3);
  const source = await readFile(path.join(profileDirectory, entry.name), "utf8");
  const { data } = parseFrontmatter(source);
  const githubId = String(data.githubId ?? "");
  const githubLogin = String(data.githubLogin ?? "");
  if (data.published !== true && data.published !== false) errors.push(`${entry.name}: published must be boolean.`);
  if (typeof data.displayName !== "string" || !data.displayName.trim()) errors.push(`${entry.name}: displayName is required.`);
  profiles.push({ githubId, githubLogin, slug, path: `content/profiles/${entry.name}` });
}
profiles.sort((left, right) => left.githubId.localeCompare(right.githubId, "en", { numeric: true }));
const byGithubId = {};
const bySlug = {};
for (const profile of profiles) {
  byGithubId[profile.githubId] = profile.slug;
  bySlug[profile.slug] = profile.githubId;
}
const candidate = { version: 1, profiles, byGithubId, bySlug };
const validation = validateProfileIndex(candidate);
errors.push(...validation.errors);
if (errors.length) {
  console.error(`Profile registry is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
const expected = serialiseProfileIndex(validation.index);
if (check) {
  let current = "";
  try { current = await readFile(outputPath, "utf8"); } catch {}
  if (current !== expected) {
    console.error("registry/profiles.json is stale. Run npm run profiles:index and commit the result.");
    process.exit(1);
  }
  console.log(`Profile index valid: ${profiles.length} profile${profiles.length === 1 ? "" : "s"}.`);
} else {
  await writeFile(outputPath, expected);
  console.log(`Wrote ${path.relative(root, outputPath)} with ${profiles.length} profile${profiles.length === 1 ? "" : "s"}.`);
}
