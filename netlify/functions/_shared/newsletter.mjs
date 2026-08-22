export const CONSENT_TEXT_VERSION = "2026-08-06";
export const DEFAULT_INTEREST = "dispatch";
export const ALLOWED_INTERESTS = Object.freeze(["dispatch", "releases"]);

const ACTIVE_BUTTONDOWN_TYPES = new Set([
  "regular",
  "premium",
  "gifted",
  "trialed",
  "churning",
  "churned",
  "past_due",
  "unpaid",
  "upcoming"
]);
const SUPPRESSED_BUTTONDOWN_TYPES = new Set(["blocked", "complained", "undeliverable"]);

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64 || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (domain.length > 253 || !domain.includes(".")) return false;

  return domain.split(".").every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

export function selectInterests(value) {
  const requested = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  const interests = [...new Set(
    requested
      .map((entry) => String(entry).trim().toLowerCase())
      .filter((entry) => ALLOWED_INTERESTS.includes(entry))
  )];
  return interests.length ? interests : [DEFAULT_INTEREST];
}

export function isConsentGranted(value) {
  return value === true || /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

export function sanitizeSource(value, fallback = "learn-newsletter") {
  const source = String(value ?? fallback).trim().slice(0, 120);
  return /^[a-z0-9][a-z0-9._:/-]*$/i.test(source) ? source : fallback;
}

export function normalizeRequestId(value, fallback) {
  const id = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : fallback;
}

export function mapButtondownType(type, eventType = "") {
  const normalized = String(type ?? "").toLowerCase();
  const event = String(eventType ?? "").toLowerCase();
  if (event.includes("deleted") || normalized === "removed") return "deleted";
  if (ACTIVE_BUTTONDOWN_TYPES.has(normalized)) return "active";
  if (normalized === "unactivated") return "pending";
  if (normalized === "unsubscribed") return "unsubscribed";
  if (normalized === "paused") return "paused";
  if (SUPPRESSED_BUTTONDOWN_TYPES.has(normalized)) return "suppressed";
  return "pending";
}

export function extractButtondownEvent(payload) {
  const eventType = String(
    payload?.type
      ?? payload?.event_type
      ?? payload?.event?.type
      ?? payload?.event
      ?? "unknown"
  );
  const candidate = payload?.data?.subscriber
    ?? payload?.data?.object
    ?? payload?.data
    ?? payload?.subscriber
    ?? payload?.object
    ?? {};
  const eventId = payload?.id ?? payload?.event_id ?? payload?.event?.id ?? null;
  const subscriberId = candidate?.id ?? payload?.subscriber_id ?? payload?.subject_id ?? null;
  const email = normalizeEmail(candidate?.email_address ?? candidate?.email ?? payload?.email_address ?? payload?.email);

  return {
    eventId: eventId ? String(eventId) : null,
    eventType,
    subscriberId: subscriberId ? String(subscriberId) : null,
    email: isValidEmail(email) ? email : "",
    subscriber: candidate && typeof candidate === "object" ? candidate : {}
  };
}

export function projectButtondownSubscriber(subscriber = {}) {
  return {
    id: subscriber.id ?? null,
    email_address: normalizeEmail(subscriber.email_address ?? subscriber.email),
    type: subscriber.type ?? null,
    tags: Array.isArray(subscriber.tags)
      ? subscriber.tags.map((tag) => typeof tag === "string" ? tag : tag?.name).filter(Boolean)
      : [],
    source: subscriber.source ?? null,
    creation_date: subscriber.creation_date ?? null,
    unsubscription_date: subscriber.unsubscription_date ?? null,
    undeliverability_date: subscriber.undeliverability_date ?? null,
    metadata: subscriber.metadata && typeof subscriber.metadata === "object"
      ? {
          hara_learn_request_id: subscriber.metadata.hara_learn_request_id ?? null,
          hara_learn_interests: Array.isArray(subscriber.metadata.hara_learn_interests)
            ? subscriber.metadata.hara_learn_interests
            : [],
          hara_learn_consent_version: subscriber.metadata.hara_learn_consent_version ?? null
        }
      : {}
  };
}
