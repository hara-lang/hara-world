import assert from "node:assert/strict";
import test from "node:test";
import { recordIdentityHandoff } from "../netlify/functions/_shared/community-accounts.mjs";

const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  handoffIssuer: "https://id.hara-lang.org",
  handoffAudience: "world",
  handoffExpiresAt: "2026-08-07T00:01:00.000Z",
  id: "6685337",
  login: "zcaudate",
  name: "Chris",
  avatarUrl: "https://avatars.githubusercontent.com/u/6685337?v=4",
  profileUrl: "https://github.com/zcaudate",
};

test("uses the handoff ID as replay boundary and excludes suspended accounts", async () => {
  let captured;
  const accepted = await recordIdentityHandoff(IDENTITY, {
    db: {
      async query(text, params) {
        captured = { text, params };
        return { rows: [{ accepted: false }] };
      },
    },
  });
  assert.equal(accepted, false);
  assert.match(captured.text, /ON CONFLICT \(handoff_id\) DO NOTHING/);
  assert.match(captured.text, /status <> 'active'/);
  assert.match(captured.text, /community_accounts\.status = 'active'/);
  assert.equal(captured.params[0], IDENTITY.handoffId);
  assert.equal(captured.params[1], IDENTITY.id);
});

test("rejects browser-shaped identity input before touching the database", async () => {
  let called = false;
  await assert.rejects(
    recordIdentityHandoff({ handoffId: "short", id: "not-numeric" }, {
      db: { async query() { called = true; return { rows: [] }; } },
    }),
    /verified identity handoff/,
  );
  assert.equal(called, false);
});
