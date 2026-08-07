import assert from "node:assert/strict";
import test from "node:test";
import {
  communityAccountStatus,
  isCommunityAccountActive,
  recordIdentityHandoff,
} from "../netlify/functions/_shared/community-accounts.mjs";

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

test("consumes a handoff only after an active account upsert succeeds", async () => {
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
  const accountPosition = captured.text.indexOf("account_upsert AS");
  const handoffPosition = captured.text.indexOf("accepted AS");
  assert.ok(accountPosition >= 0 && accountPosition < handoffPosition);
  assert.match(captured.text, /FROM account_upsert/);
  assert.match(captured.text, /community_accounts\.status = 'active'/);
  assert.match(captured.text, /ON CONFLICT \(handoff_id\) DO NOTHING/);
  assert.equal(captured.params[0], IDENTITY.handoffId);
  assert.equal(captured.params[1], IDENTITY.id);
});

test("checks current community status for every sensitive operation", async () => {
  const db = { async query() { return { rows: [{ status: "suspended" }] }; } };
  assert.equal(await communityAccountStatus("6685337", { db }), "suspended");
  assert.equal(await isCommunityAccountActive("6685337", { db }), false);
  assert.equal(await communityAccountStatus("6685337", { db: { async query() { return { rows: [] }; } } }), "missing");
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
