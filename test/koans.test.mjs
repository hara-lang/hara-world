import assert from "node:assert/strict";
import test from "node:test";
import koans from "../content/koans.json" with { type: "json" };
import { normalizeCompletion, peerSolutions, saveCompletion } from "../netlify/functions/_shared/koans.mjs";

test("publishes thirty unique, versioned koans with browser checks", () => {
  assert.equal(koans.length, 30);
  assert.equal(new Set(koans.map(({ id }) => id)).size, 30);
  assert.equal(new Set(koans.map(({ slug }) => slug)).size, 30);
  for (const koan of koans) {
    assert.match(koan.id, /^\d{3}$/);
    assert.equal(koan.version, 1);
    assert.ok(koan.tests.length > 0);
    assert.ok(koan.tests.every((check) => check.includes("__")));
  }
});

test("accepts only a current browser-passed source result", () => {
  const accepted = normalizeCompletion({ koanId: "001", version: 1, source: " 3 ", passed: true });
  assert.equal(accepted.source, "3");
  assert.match(accepted.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => normalizeCompletion({ koanId: "001", version: 1, source: "3", passed: false }), /browser-verified/);
  assert.throws(() => normalizeCompletion({ koanId: "001", version: 2, source: "3", passed: true }), /changed/);
  assert.throws(() => normalizeCompletion({ koanId: "999", version: 1, source: "3", passed: true }), /Unknown/);
});

test("stores accepted source only and gates peer source behind viewer completion", async () => {
  const calls = [];
  const db = { async query(text, params) { calls.push({ text, params }); return { rows: [{}] }; } };
  const completion = normalizeCompletion({ koanId: "001", version: 1, source: "3", passed: true });
  await saveCompletion("42", completion, { db });
  await peerSolutions("42", koans[0], { db });
  assert.match(calls[0].text, /ON CONFLICT/);
  assert.doesNotMatch(calls[0].text, /attempt/i);
  assert.match(calls[1].text, /EXISTS[\s\S]*viewer\.github_user_id/);
  assert.match(calls[1].text, /a\.status = 'active'/);
});
