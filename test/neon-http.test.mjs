import assert from "node:assert/strict";
import test from "node:test";
import { createNeonHttpClient, neonFetchEndpoint, NeonHttpError } from "../netlify/functions/_shared/neon-http.mjs";

const connectionString = "postgresql://user:secret@ep-winter-shape-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require";

test("derives the Neon HTTP SQL endpoint without exposing credentials", () => {
  assert.equal(
    neonFetchEndpoint(connectionString),
    "https://api.ap-southeast-2.aws.neon.tech/sql"
  );
});

test("sends parameterized queries and maps array rows to objects", async () => {
  let observed;
  const client = createNeonHttpClient(connectionString, {
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response(JSON.stringify({
        command: "SELECT",
        rowCount: 1,
        fields: [{ name: "email" }, { name: "status" }],
        rows: [["reader@example.com", "active"]]
      }), { status: 200 });
    }
  });
  const result = await client.query("SELECT $1::text AS email, $2::text AS status", ["reader@example.com", "active"]);
  assert.equal(observed.url, "https://api.ap-southeast-2.aws.neon.tech/sql");
  assert.equal(observed.options.headers["Neon-Raw-Text-Output"], "true");
  assert.deepEqual(JSON.parse(observed.options.body), {
    query: "SELECT $1::text AS email, $2::text AS status",
    params: ["reader@example.com", "active"]
  });
  assert.deepEqual(result.rows, [{ email: "reader@example.com", status: "active" }]);
});

test("maps Neon errors without echoing the connection string", async () => {
  const client = createNeonHttpClient(connectionString, {
    fetchImpl: async () => new Response(JSON.stringify({ message: "relation does not exist", code: "42P01" }), { status: 400 })
  });
  await assert.rejects(
    () => client.query("SELECT * FROM missing"),
    (error) => error instanceof NeonHttpError
      && error.code === "42P01"
      && !error.message.includes("secret")
  );
});
