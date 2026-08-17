import { getEnv } from "./_shared/env.mjs";
import { readGitHubAppConfig } from "./_shared/github-app.mjs";
import {
  identityOriginForRequest,
  isWorldAuthConfigured,
  worldOrigin,
} from "./_shared/world-auth.mjs";

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  return String(getEnv(name, fallback) ?? fallback).trim();
}

export function discoveryPayload(request, env = {}) {
  const issuer = worldOrigin(request.url);
  const centralIssuer = identityOriginForRequest(request.url, env);
  const authConfigured = isWorldAuthConfigured(env, request.url);
  let gitPublisherConfigured = false;
  try {
    readGitHubAppConfig(env);
    gitPublisherConfigured = true;
  } catch {}
  const databaseConfigured = Boolean(envValue(env, "DATABASE_URL"));
  return {
    issuer,
    centralIssuer,
    configured: authConfigured && gitPublisherConfigured && databaseConfigured,
    readinessEndpoint: `${issuer}/.well-known/hara-world-readiness`,
    authentication: {
      configured: authConfigured,
      startEndpoint: `${issuer}/api/auth/start`,
      callbackEndpoint: `${issuer}/api/auth/callback`,
      sessionEndpoint: `${issuer}/api/auth/session`,
      logoutEndpoint: `${issuer}/api/auth/logout`,
      handoffDiscoveryEndpoint: `${centralIssuer}/.well-known/hara-handoff`,
      accountStatusEnforced: true,
      frontChannelLogout: true,
    },
    profiles: {
      configured: gitPublisherConfigured,
      endpoint: `${issuer}/api/profile`,
      editor: `${issuer}/me`,
      index: "registry/profiles.json",
      management: "git-pull-request",
      publicationBoundary: "merge",
      oneOpenProposalPerIdentity: true,
    },
    agents: {
      configured: gitPublisherConfigured,
      endpoint: `${issuer}/api/agents`,
      directory: `${issuer}/agents`,
      registration: `${issuer}/agents/register`,
      publicRegistry: `${issuer}/agents.json`,
      index: "registry/agents.json",
      management: "git-pull-request",
      publicationBoundary: "merge",
      ownership: "verified-human-operator",
      machineAuthentication: "separate",
    },
    sources: {
      configured: authConfigured && gitPublisherConfigured,
      endpoint: `${issuer}/api/sources`,
      probeEndpoint: `${issuer}/api/sources/probe`,
      form: `${issuer}/submit`,
      directory: `${issuer}/sources`,
      publicRegistry: `${issuer}/sources.json`,
      opml: `${issuer}/sources.opml`,
      index: "registry/sources.json",
      management: "git-pull-request",
      publicationBoundary: "merge",
      activationBoundary: "reviewed-status-change",
      networkPolicy: "public-https-only",
    },
    posts: {
      configured: authConfigured && gitPublisherConfigured && databaseConfigured,
      endpoint: `${issuer}/api/posts`,
      composer: `${issuer}/post`,
      draftAuthority: "neon-postgresql",
      publicationAuthority: "git-merge",
    },
    database: {
      configured: databaseConfigured,
      authority: "neon-postgresql",
    },
  };
}

export default async function worldDiscovery(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`${JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } })}\n`, {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const body = discoveryPayload(request);
  return new Response(request.method === "HEAD" ? null : `${JSON.stringify(body)}\n`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = { path: "/.well-known/hara-world" };
