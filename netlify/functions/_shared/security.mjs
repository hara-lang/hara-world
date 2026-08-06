import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyHmacSha256(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) return false;
  const supplied = String(signatureHeader).trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function webhookEventKey(eventId, rawBody) {
  return eventId ? String(eventId).slice(0, 200) : sha256Hex(rawBody);
}
