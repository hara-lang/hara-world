import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import subscribe, { config as subscribeConfig } from "../netlify/functions/newsletter-subscribe.mjs";
import webhook, { config as webhookConfig } from "../netlify/functions/newsletter-buttondown.mjs";
import {
  extractButtondownEvent,
  isValidEmail,
  mapButtondownType,
  normalizeEmail,
  projectButtondownSubscriber,
  selectInterests
} from "../netlify/functions/_shared/newsletter.mjs";
import { verifyHmacSha256, webhookEventKey } from "../netlify/functions/_shared/security.mjs";

test("normalizes and validates email addresses", () => {
  assert.equal(normalizeEmail("  Reader@Example.COM "), "reader@example.com");
  assert.equal(isValidEmail("reader@example.com"), true);
  assert.equal(isValidEmail("reader@example"), false);
  assert.equal(isValidEmail("reader..name@example.com"), false);
});

test("selects only supported interests and supplies the dispatch default", () => {
  assert.deepEqual(selectInterests(["dispatch", "releases", "dispatch", "unknown"]), ["dispatch", "releases"]);
  assert.deepEqual(selectInterests([]), ["dispatch"]);
});

test("maps Buttondown subscriber types to the local lifecycle", () => {
  assert.equal(mapButtondownType("unactivated"), "pending");
  assert.equal(mapButtondownType("regular"), "active");
  assert.equal(mapButtondownType("unsubscribed"), "unsubscribed");
  assert.equal(mapButtondownType("complained"), "suppressed");
  assert.equal(mapButtondownType("regular", "subscriber.deleted"), "deleted");
});

test("verifies Buttondown HMAC signatures over the raw request body", () => {
  const body = JSON.stringify({ type: "subscriber.created", data: { id: "sub_1" } });
  const secret = "correct horse battery staple";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyHmacSha256(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyHmacSha256(`${body} `, `sha256=${signature}`, secret), false);
  assert.equal(webhookEventKey(null, body).length, 64);
});

test("extracts and minimizes Buttondown subscriber events", () => {
  const event = extractButtondownEvent({
    id: "evt_1",
    type: "subscriber.type.changed",
    data: {
      subscriber: {
        id: "sub_1",
        email_address: "Reader@Example.com",
        type: "regular",
        ip_address: "203.0.113.4",
        metadata: { hara_world_interests: ["dispatch"] }
      }
    }
  });
  assert.equal(event.eventId, "evt_1");
  assert.equal(event.email, "reader@example.com");
  const projection = projectButtondownSubscriber(event.subscriber);
  assert.equal(projection.email_address, "reader@example.com");
  assert.equal("ip_address" in projection, false);
});


test("exports modern Netlify handlers and routed function configuration", () => {
  assert.equal(typeof subscribe, "function");
  assert.equal(subscribeConfig.path, "/api/newsletter/subscribe");
  assert.equal(subscribeConfig.rateLimit.aggregateBy.includes("ip"), true);
  assert.equal(typeof webhook, "function");
  assert.equal(webhookConfig.path, "/api/newsletter/buttondown");
});
