import { getEnv } from "./_shared/env.mjs";
import { createGitHubAppClient } from "./_shared/github-app.mjs";
import { getDatabase } from "./_shared/neon-http.mjs";
import { identityOriginForRequest, readLearnAuthConfig, learnOrigin } from "./_shared/learn-auth.mjs";

function check(name, ok, code = ok ? "ready" : "unavailable") {
  return { name, ready: Boolean(ok), code };
}

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  return String(getEnv(name, fallback) ?? fallback).trim();
}

function permissionsReady(permissions = {}) {
  const checksReadable = permissions.checks === "read" || permissions.checks === "write";
  return permissions.contents === "write"
    && permissions.pull_requests === "write"
    && checksReadable;
}

function refPath(branch) {
  return String(branch).split("/").map(encodeURIComponent).join("/");
}

export async function checkLearnReadiness(request, options = {}) {
  const env = options.env ?? {};
  const issuer = learnOrigin(request.url);
  const centralIssuer = identityOriginForRequest(request.url, env);
  const checks = [];
  let authConfig;
  try {
    authConfig = readLearnAuthConfig(env, request.url);
    checks.push(check("learn-auth", true));
  } catch {
    checks.push(check("learn-auth", false, "learn-auth-not-configured"));
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(new URL("/.well-known/hara-handoff", centralIssuer), {
      headers: { Accept: "application/json", "User-Agent": "hara-learn-readiness" },
      cache: "no-store",
    });
    const payload = await response.json();
    const registered = response.ok
      && payload?.configured === true
      && payload?.issuer === centralIssuer
      && Array.isArray(payload?.codeChallengeMethodsSupported)
      && payload.codeChallengeMethodsSupported.includes("S256")
      && payload.clients?.some?.((client) => client.id === "learn" && client.redirectUri === `${issuer}/api/auth/callback`);
    checks.push(check("identity-handoff", registered, registered ? "ready" : "identity-handoff-invalid"));
  } catch {
    checks.push(check("identity-handoff", false, "identity-handoff-unreachable"));
  }

  try {
    const db = options.db ?? getDatabase();
    const result = await db.query(
      `SELECT
         to_regclass('hara_learn.community_accounts')::text AS accounts,
         to_regclass('hara_learn.community_identity_handoffs')::text AS handoffs,
         to_regclass('hara_learn.community_post_drafts')::text AS post_drafts,
         to_regclass('hara_learn.community_post_events')::text AS post_events,
         to_regclass('hara_learn.community_proposals')::text AS proposals,
         to_regclass('hara_learn.community_proposal_events')::text AS proposal_events`,
    );
    const row = result.rows[0] ?? {};
    const migrated = row.accounts === "hara_learn.community_accounts"
      && row.handoffs === "hara_learn.community_identity_handoffs"
      && row.post_drafts === "hara_learn.community_post_drafts"
      && row.post_events === "hara_learn.community_post_events"
      && row.proposals === "hara_learn.community_proposals"
      && row.proposal_events === "hara_learn.community_proposal_events";
    checks.push(check("database", migrated, migrated ? "ready" : "proposal-lifecycle-migration-missing"));
  } catch {
    checks.push(check("database", false, "database-unreachable"));
  }

  const webhookSecret = envValue(env, "HARA_LEARN_GITHUB_WEBHOOK_SECRET");
  const webhookReady = webhookSecret.length >= 32;
  checks.push(check("github-proposal-webhook", webhookReady, webhookReady ? "ready" : "github-webhook-not-configured"));

  try {
    const client = options.githubClient ?? await createGitHubAppClient({
      env,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? Date.now(),
    });
    const permissionOk = permissionsReady(client.installationPermissions);
    const repository = await client.request(`/repos/${client.repository}`);
    const ref = await client.request(`/repos/${client.repository}/git/ref/heads/${refPath(client.baseBranch)}`);
    const repositoryOk = repository?.full_name === client.repository && typeof ref?.object?.sha === "string";
    checks.push(check("github-community-publisher", permissionOk && repositoryOk,
      !permissionOk ? "github-permissions-insufficient" : repositoryOk ? "ready" : "github-repository-invalid"));
  } catch {
    checks.push(check("github-community-publisher", false, "github-app-unreachable"));
  }

  const ready = Boolean(authConfig) && checks.every((item) => item.ready);
  return {
    ready,
    issuer,
    centralIssuer,
    checkedAt: new Date(options.now ?? Date.now()).toISOString(),
    checks,
  };
}

export default async function learnReadiness(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`${JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } })}\n`, {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const body = await checkLearnReadiness(request);
  return new Response(request.method === "HEAD" ? null : `${JSON.stringify(body)}\n`, {
    status: body.ready ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = {
  path: "/.well-known/hara-learn-readiness",
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
