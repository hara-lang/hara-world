import { randomUUID } from "node:crypto";
import { createButtondownSubscriber } from "./_shared/buttondown.mjs";
import { getDatabase } from "./_shared/neon-http.mjs";
import {
  CONSENT_TEXT_VERSION,
  isConsentGranted,
  isValidEmail,
  mapButtondownType,
  normalizeEmail,
  normalizeRequestId,
  projectButtondownSubscriber,
  sanitizeSource,
  selectInterests
} from "./_shared/newsletter.mjs";
import { getEnv } from "./_shared/env.mjs";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set([new URL(request.url).origin]);
  try {
    allowed.add(new URL(getEnv("HARA_LEARN_SITE", "https://learn.hara-lang.org")).origin);
  } catch {
    // The request origin remains allowed even if configuration is malformed.
  }
  return allowed.has(origin);
}

async function readBody(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  const body = Object.fromEntries(form.entries());
  body.interests = form.getAll("interests");
  return body;
}

export default async function newsletterSubscribe(request, context = {}) {
  if (request.method !== "POST") return json(405, { ok: false, message: "Method not allowed." });
  if (!allowedOrigin(request)) return json(403, { ok: false, message: "Origin not allowed." });

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json(400, { ok: false, message: "The signup request could not be read." });
  }

  if (String(body?.company ?? "").trim()) {
    return json(202, { ok: true, state: "received", message: "Your request was received." });
  }

  const email = normalizeEmail(body?.email);
  if (!isValidEmail(email)) {
    return json(400, { ok: false, field: "email", message: "Enter a valid email address." });
  }
  if (!isConsentGranted(body?.consent)) {
    return json(400, { ok: false, field: "consent", message: "Consent is required to join the mailing list." });
  }

  const requestId = normalizeRequestId(body?.requestId, randomUUID());
  const interests = selectInterests(body?.interests);
  const source = sanitizeSource(body?.source);
  const site = getEnv("HARA_LEARN_SITE", "https://learn.hara-lang.org");
  const sourceUrl = `${site.replace(/\/$/, "")}/newsletter`;
  const consentEvidence = {
    request_id: requestId,
    form: source,
    interests,
    double_opt_in: true
  };

  let db;
  let ledger;
  try {
    db = getDatabase();
    const upsert = await db.query(
      `INSERT INTO hara_learn.mailing_list_subscribers (
         email, status, interests, consent_at, consent_source, consent_text_version, consent_evidence,
         provider, updated_at
       ) VALUES ($1, 'pending', $2::jsonb, now(), $3, $4, $5::jsonb, 'buttondown', now())
       ON CONFLICT (email_normalized) DO UPDATE SET
         email = EXCLUDED.email,
         interests = EXCLUDED.interests,
         consent_at = now(),
         consent_source = EXCLUDED.consent_source,
         consent_text_version = EXCLUDED.consent_text_version,
         consent_evidence = EXCLUDED.consent_evidence,
         updated_at = now(),
         last_error = NULL
       RETURNING id, email, email_normalized, status, provider_subscriber_id, provider_type, consent_at`,
      [email, JSON.stringify(interests), source, CONSENT_TEXT_VERSION, JSON.stringify(consentEvidence)]
    );
    ledger = upsert.rows[0];
    if (!ledger) throw new Error("The subscriber ledger did not return a record.");
  } catch (error) {
    console.error("Newsletter ledger signup failed", {
      requestId,
      status: error?.status,
      name: error?.name
    });
    return json(503, {
      ok: false,
      state: "retry",
      message: "We could not record the subscription request. Please try again shortly."
    });
  }

  try {
    const providerSubscriber = await createButtondownSubscriber({
      email,
      interests,
      sourceUrl,
      requestId,
      consentTextVersion: CONSENT_TEXT_VERSION,
      ipAddress: context.ip
    });
    const providerPayload = projectButtondownSubscriber(providerSubscriber);
    const status = mapButtondownType(providerSubscriber.type);

    await db.query(
      `UPDATE hara_learn.mailing_list_subscribers
       SET provider_subscriber_id = $2,
           provider_type = $3,
           status = $4,
           confirmed_at = CASE WHEN $4 = 'active' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
           unsubscribed_at = CASE WHEN $4 = 'unsubscribed' THEN COALESCE(unsubscribed_at, now()) ELSE unsubscribed_at END,
           suppressed_at = CASE WHEN $4 = 'suppressed' THEN COALESCE(suppressed_at, now()) ELSE suppressed_at END,
           deleted_at = CASE WHEN $4 = 'deleted' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
           provider_payload = $5::jsonb,
           last_provider_event_at = now(),
           last_error = NULL,
           updated_at = now()
       WHERE id = $1`,
      [ledger.id, providerSubscriber.id ?? null, providerSubscriber.type ?? null, status, JSON.stringify(providerPayload)]
    );
  } catch (error) {
    await db.query(
      `UPDATE hara_learn.mailing_list_subscribers
       SET status = CASE WHEN status = 'pending' THEN 'error' ELSE status END,
           last_error = $2,
           updated_at = now()
       WHERE id = $1`,
      [ledger.id, String(error?.message ?? "Delivery provider error").slice(0, 500)]
    );
    console.error("Newsletter provider signup failed", {
      requestId,
      status: error?.status,
      name: error?.name
    });
    return json(503, {
      ok: false,
      state: "retry",
      message: "We could not send the confirmation request. Please try again shortly."
    });
  }

  return json(202, {
    ok: true,
    state: "check-inbox",
    message: "Your request was received. Check your inbox if confirmation is required."
  });
}

export const config = {
  path: "/api/newsletter/subscribe",
  method: "POST",
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
