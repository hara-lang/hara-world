import { getButtondownSubscriber } from "./_shared/buttondown.mjs";
import { requiredEnv } from "./_shared/env.mjs";
import { getDatabase } from "./_shared/neon-http.mjs";
import {
  extractButtondownEvent,
  isValidEmail,
  mapButtondownType,
  projectButtondownSubscriber
} from "./_shared/newsletter.mjs";
import { verifyHmacSha256, webhookEventKey } from "./_shared/security.mjs";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function recordEvent(db, eventKey, eventType, payload) {
  const result = await db.query(
    `INSERT INTO hara_learn.mailing_list_provider_events (
       provider, event_key, event_type, payload, attempts, received_at, last_attempt_at
     ) VALUES ('buttondown', $1, $2, $3::jsonb, 1, now(), now())
     ON CONFLICT (provider, event_key) DO UPDATE SET
       attempts = hara_learn.mailing_list_provider_events.attempts + 1,
       last_attempt_at = now(),
       error = NULL
     RETURNING processed_at`,
    [eventKey, eventType, JSON.stringify(payload)]
  );
  return result.rows[0]?.processed_at ?? null;
}

async function finishEvent(db, eventKey, error = null) {
  await db.query(
    `UPDATE hara_learn.mailing_list_provider_events
     SET processed_at = CASE WHEN $2::text IS NULL THEN now() ELSE processed_at END,
         error = $2,
         last_attempt_at = now()
     WHERE provider = 'buttondown' AND event_key = $1`,
    [eventKey, error]
  );
}

async function syncSubscriber(db, subscriber, eventType) {
  const projection = projectButtondownSubscriber(subscriber);
  const email = projection.email_address;
  if (!isValidEmail(email)) throw new Error("Buttondown event did not resolve to a valid subscriber email.");
  const status = mapButtondownType(projection.type, eventType);
  const interests = projection.metadata?.hara_learn_interests;
  const normalizedInterests = Array.isArray(interests) && interests.length ? interests : ["dispatch"];

  await db.query(
    `INSERT INTO hara_learn.mailing_list_subscribers (
       email, status, provider, provider_subscriber_id, provider_type, interests,
       consent_at, consent_source, consent_text_version, consent_evidence,
       confirmed_at, unsubscribed_at, suppressed_at, deleted_at,
       last_provider_event_at, provider_payload, updated_at
     ) VALUES (
       $1, $2, 'buttondown', $3, $4, $5::jsonb,
       now(), 'buttondown-provider', 'provider-managed', '{"provider_managed":true}'::jsonb,
       CASE WHEN $2 = 'active' THEN now() ELSE NULL END,
       CASE WHEN $2 = 'unsubscribed' THEN now() ELSE NULL END,
       CASE WHEN $2 = 'suppressed' THEN now() ELSE NULL END,
       CASE WHEN $2 = 'deleted' THEN now() ELSE NULL END,
       now(), $6::jsonb, now()
     )
     ON CONFLICT (email_normalized) DO UPDATE SET
       status = EXCLUDED.status,
       provider = 'buttondown',
       provider_subscriber_id = EXCLUDED.provider_subscriber_id,
       provider_type = EXCLUDED.provider_type,
       interests = CASE
         WHEN jsonb_array_length(EXCLUDED.interests) > 0 THEN EXCLUDED.interests
         ELSE hara_learn.mailing_list_subscribers.interests
       END,
       confirmed_at = CASE WHEN EXCLUDED.status = 'active'
         THEN COALESCE(hara_learn.mailing_list_subscribers.confirmed_at, now())
         ELSE hara_learn.mailing_list_subscribers.confirmed_at END,
       unsubscribed_at = CASE WHEN EXCLUDED.status = 'unsubscribed'
         THEN COALESCE(hara_learn.mailing_list_subscribers.unsubscribed_at, now())
         ELSE hara_learn.mailing_list_subscribers.unsubscribed_at END,
       suppressed_at = CASE WHEN EXCLUDED.status = 'suppressed'
         THEN COALESCE(hara_learn.mailing_list_subscribers.suppressed_at, now())
         ELSE hara_learn.mailing_list_subscribers.suppressed_at END,
       deleted_at = CASE WHEN EXCLUDED.status = 'deleted'
         THEN COALESCE(hara_learn.mailing_list_subscribers.deleted_at, now())
         ELSE hara_learn.mailing_list_subscribers.deleted_at END,
       last_provider_event_at = now(),
       provider_payload = EXCLUDED.provider_payload,
       last_error = NULL,
       updated_at = now()`,
    [
      email,
      status,
      projection.id,
      projection.type,
      JSON.stringify(normalizedInterests),
      JSON.stringify(projection)
    ]
  );
}

export default async function buttondownWebhook(request) {
  if (request.method !== "POST") return json(405, { ok: false, message: "Method not allowed." });

  const rawBody = await request.text();
  const signature = request.headers.get("x-buttondown-signature");
  const secret = requiredEnv("BUTTONDOWN_WEBHOOK_SECRET");
  if (!verifyHmacSha256(rawBody, signature, secret)) {
    return json(401, { ok: false, message: "Invalid webhook signature." });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { ok: false, message: "Invalid JSON payload." });
  }

  const event = extractButtondownEvent(payload);
  const eventKey = webhookEventKey(event.eventId, rawBody);
  const eventProjection = {
    event_id: event.eventId,
    event_type: event.eventType,
    subscriber_id: event.subscriberId,
    email_address: event.email || null
  };
  const db = getDatabase();
  const processedAt = await recordEvent(db, eventKey, event.eventType, eventProjection);
  if (processedAt) return json(200, { ok: true, duplicate: true });

  try {
    let subscriber = event.subscriber;
    const reference = event.subscriberId || event.email;
    if (reference) {
      try {
        subscriber = await getButtondownSubscriber(reference);
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
    }

    const deletedEvent = event.eventType.toLowerCase().includes("deleted");
    const projected = projectButtondownSubscriber(subscriber);
    if (deletedEvent && !isValidEmail(projected.email_address) && event.subscriberId) {
      const deleted = await db.query(
        `UPDATE hara_learn.mailing_list_subscribers
         SET status = 'deleted',
             provider_type = 'removed',
             deleted_at = COALESCE(deleted_at, now()),
             last_provider_event_at = now(),
             last_error = NULL,
             updated_at = now()
         WHERE provider = 'buttondown' AND provider_subscriber_id = $1`,
        [event.subscriberId]
      );
      if (!deleted.rowCount) {
        await finishEvent(db, eventKey);
        return json(200, { ok: true, ignored: true });
      }
    } else {
      if (!subscriber || !Object.keys(subscriber).length) {
        await finishEvent(db, eventKey);
        return json(200, { ok: true, ignored: true });
      }
      if (!subscriber.type && deletedEvent) subscriber = { ...subscriber, type: "removed" };
      await syncSubscriber(db, subscriber, event.eventType);
    }

    await finishEvent(db, eventKey);
    return json(200, { ok: true });
  } catch (error) {
    const message = String(error?.message ?? "Webhook processing failed").slice(0, 500);
    await finishEvent(db, eventKey, message);
    console.error("Buttondown webhook processing failed", {
      eventKey,
      eventType: event.eventType,
      status: error?.status,
      name: error?.name
    });
    return json(502, { ok: false, message: "Webhook processing failed." });
  }
}

export const config = {
  path: "/api/newsletter/buttondown",
  method: "POST"
};
