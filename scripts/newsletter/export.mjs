import { createNeonHttpClient } from "../../netlify/functions/_shared/neon-http.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL before exporting the mailing list.");
const db = createNeonHttpClient(databaseUrl, { timeoutMs: 30_000 });

const result = await db.query(
  `SELECT email, interests, confirmed_at
   FROM hara_learn.mailing_list_active
   ORDER BY confirmed_at NULLS LAST, email`
);

function csv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

process.stdout.write("email,interests,confirmed_at\n");
for (const row of result.rows) {
  let interests = row.interests;
  try {
    const parsed = typeof interests === "string" ? JSON.parse(interests) : interests;
    interests = Array.isArray(parsed) ? parsed.join("|") : "";
  } catch {
    interests = "";
  }
  process.stdout.write(`${csv(row.email)},${csv(interests)},${csv(row.confirmed_at)}\n`);
}
