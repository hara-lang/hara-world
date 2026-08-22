import { communityAccountStatus } from "./_shared/community-accounts.mjs";
import { completedKoans, koanById, normalizeCompletion, peerSolutions, saveCompletion } from "./_shared/koans.mjs";
import { clearLearnSessionCookie, json, readLearnSession, sameOrigin } from "./_shared/learn-auth.mjs";

function error(status, code, message, headers) { return json(status, { error: { code, message } }, headers); }

export async function handle(request, options = {}) {
  const env = options.env ?? {};
  const path = new URL(request.url).pathname;
  const identity = readLearnSession(request, env, options.now ?? Date.now());
  if (!identity) return error(401, "LEARN_SESSION_REQUIRED", "Sign in to save progress or reveal peer solutions.");
  let status;
  try { status = await (options.communityAccountStatusImpl ?? communityAccountStatus)(identity.id, options); }
  catch { return error(503, "LEARN_ACCOUNT_CHECK_FAILED", "Learn could not verify the community account."); }
  if (status !== "active") return error(403, "LEARN_ACCOUNT_INACTIVE", "This Hara Learn account is not active.", { "Set-Cookie": clearLearnSessionCookie(request.url) });

  const deps = { db: options.db };
  if (path === "/api/koans/progress" && request.method === "GET") {
    return json(200, { ok: true, completions: await completedKoans(identity.id, deps) });
  }
  const match = path.match(/^\/api\/koans\/([0-9]{3})\/(completion|solutions)$/);
  if (!match) return error(404, "NOT_FOUND", "Unknown koan endpoint.");
  const koan = koanById(match[1]);
  if (!koan) return error(404, "KOAN_NOT_FOUND", "Unknown koan.");
  if (match[2] === "solutions" && request.method === "GET") {
    const solutions = await peerSolutions(identity.id, koan, deps);
    if (!solutions.length) return error(403, "KOAN_UNSOLVED", "Solve this koan before viewing peer solutions.");
    return json(200, { ok: true, koan: { id: koan.id, version: koan.version }, solutions });
  }
  if (match[2] !== "completion" || request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Unsupported koan operation.");
  if (!sameOrigin(request, env) || request.headers.get("x-hara-request") !== "koan-completion") {
    return error(403, "KOAN_REQUEST_REJECTED", "The completion must come from Hara Learn.");
  }
  let completion;
  try { completion = normalizeCompletion(await request.json()); }
  catch (cause) { return error(400, "KOAN_COMPLETION_INVALID", cause.message); }
  return json(201, { ok: true, completion: await saveCompletion(identity.id, completion, deps), verification: "browser-self-reported" });
}

export default async (request) => handle(request);
export const config = { path: "/api/koans/*", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
