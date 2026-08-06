import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNeonHttpClient } from "../../netlify/functions/_shared/neon-http.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = path.join(root, "database", "migrations");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL to the Neon PostgreSQL connection string.");

const db = createNeonHttpClient(databaseUrl, { timeoutMs: 30_000 });
await db.transaction([
  "CREATE SCHEMA IF NOT EXISTS hara_world",
  `CREATE TABLE IF NOT EXISTS hara_world.schema_migrations (
     name text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`
]);

const files = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

for (const name of files) {
  const applied = await db.query(
    "SELECT name FROM hara_world.schema_migrations WHERE name = $1",
    [name]
  );
  if (applied.rows.length) {
    console.log(`skip ${name}`);
    continue;
  }

  const source = await readFile(path.join(migrationDirectory, name), "utf8");
  const statements = source
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (!statements.length) throw new Error(`Migration ${name} contains no SQL statements.`);

  await db.transaction([
    ...statements,
    { text: "INSERT INTO hara_world.schema_migrations (name) VALUES ($1)", params: [name] }
  ]);
  console.log(`apply ${name} (${statements.length} statements)`);
}
