import { envFlag, getEnv, requiredEnv } from "./env.mjs";

const API_BASE = "https://api.buttondown.com/v1";

export class ButtondownError extends Error {
  constructor(message, { status = 500, response = null } = {}) {
    super(message);
    this.name = "ButtondownError";
    this.status = status;
    this.response = response;
  }
}

function safeMessage(body, status) {
  const value = body?.detail ?? body?.message ?? body?.error;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  return `Buttondown request failed with HTTP ${status}.`;
}

export async function buttondownRequest(
  path,
  { method = "GET", body, idempotencyKey, collisionBehavior, fetchImpl = globalThis.fetch } = {}
) {
  const apiKey = requiredEnv("BUTTONDOWN_API_KEY");
  const headers = {
    authorization: `Token ${apiKey}`,
    accept: "application/json"
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = String(idempotencyKey).slice(0, 200);
  if (collisionBehavior) headers["X-Buttondown-Collision-Behavior"] = collisionBehavior;
  if (envFlag("BUTTONDOWN_BYPASS_FIREWALL", false)) {
    headers["X-Buttondown-Bypass-Firewall"] = "true";
  }

  const response = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = raw ? { detail: raw.slice(0, 500) } : {};
  }

  if (!response.ok) {
    throw new ButtondownError(safeMessage(parsed, response.status), {
      status: response.status,
      response: parsed
    });
  }
  return parsed;
}

export async function createButtondownSubscriber({
  email,
  interests,
  sourceUrl,
  requestId,
  consentTextVersion,
  ipAddress,
  fetchImpl
}) {
  const payload = {
    email_address: email,
    referrer_url: sourceUrl,
    metadata: {
      hara_learn_request_id: requestId,
      hara_learn_interests: interests,
      hara_learn_consent_version: consentTextVersion
    }
  };
  if (envFlag("BUTTONDOWN_FORWARD_IP", true) && ipAddress) payload.ip_address = ipAddress;
  if (envFlag("BUTTONDOWN_USE_TAGS", false)) {
    payload.tags = ["hara-learn", ...interests.map((interest) => `hara-learn:${interest}`)];
  }

  try {
    return await buttondownRequest("/subscribers", {
      method: "POST",
      body: payload,
      idempotencyKey: `hara-learn-${requestId}`,
      collisionBehavior: "add",
      fetchImpl
    });
  } catch (error) {
    if (!(error instanceof ButtondownError) || ![400, 409].includes(error.status)) throw error;
    return getButtondownSubscriber(email, { fetchImpl });
  }
}

export function getButtondownSubscriber(idOrEmail, { fetchImpl } = {}) {
  return buttondownRequest(`/subscribers/${encodeURIComponent(idOrEmail)}`, { fetchImpl });
}

export function getButtondownPortalUrl() {
  return getEnv("PUBLIC_HARA_LEARN_MANAGE_SUBSCRIPTION_URL", "https://buttondown.com/login?subscriber=1");
}
