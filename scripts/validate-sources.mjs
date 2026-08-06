import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateRegistry } from "./lib/source-registry.mjs";

const registryPath = path.resolve(process.argv[2] ?? "registry/sources.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const errors = validateRegistry(registry);
if (errors.length) {
  console.error(`Source registry is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Source registry valid: ${registry.sources.length} source${registry.sources.length === 1 ? "" : "s"}.`);
