import { createSign } from "node:crypto";
import { getEnv } from "./env.mjs";

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  return String(getEnv(name, fallback) ?? fallback).trim();
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizePrivateKey(value) {
  return String(value).replace(/\\n/g, "\n").trim();
}

export function createGitHubAppJwt({ appId, privateKey, now = Date.now() }) {
  if (!/^\d+$/.test(String(appId))) throw new Error("HARA_WORLD_GITHUB_APP_ID must be numeric.");
  const key = normalizePrivateKey(privateKey);
  if (!key.includes("BEGIN") || !key.includes("PRIVATE KEY")) throw new Error("HARA_WORLD_GITHUB_APP_PRIVATE_KEY is invalid.");
  const seconds = Math.floor(now / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({ iat: seconds - 60, exp: seconds + 9 * 60, iss: String(appId) });
  const input = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(key).toString("base64url")}`;
}

export function readGitHubAppConfig(env = {}) {
  const appId = envValue(env, "HARA_WORLD_GITHUB_APP_ID");
  const privateKey = normalizePrivateKey(envValue(env, "HARA_WORLD_GITHUB_APP_PRIVATE_KEY"));
  const installationId = envValue(env, "HARA_WORLD_GITHUB_INSTALLATION_ID");
  const repository = envValue(env, "HARA_WORLD_GITHUB_REPOSITORY", "hara-lang/hara-world");
  const baseBranch = envValue(env, "HARA_WORLD_GITHUB_BASE_BRANCH", "main");
  if (
    !/^\d+$/.test(appId)
    || !/^\d+$/.test(installationId)
    || !privateKey.includes("BEGIN")
    || !privateKey.includes("PRIVATE KEY")
  ) {
    throw new Error("The Hara World GitHub App is not configured.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("HARA_WORLD_GITHUB_REPOSITORY must use owner/name syntax.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(baseBranch) || baseBranch.includes("..")) {
    throw new Error("HARA_WORLD_GITHUB_BASE_BRANCH is invalid.");
  }
  return { appId, privateKey, installationId, repository, baseBranch };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
}

export async function createGitHubAppClient({
  config,
  env = {},
  fetchImpl = fetch,
  now = Date.now(),
  apiBase = "https://api.github.com",
} = {}) {
  const resolved = config ?? readGitHubAppConfig(env);
  const jwt = createGitHubAppJwt({ appId: resolved.appId, privateKey: resolved.privateKey, now });
  const tokenResponse = await fetchImpl(`${apiBase}/app/installations/${resolved.installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "hara-world",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const tokenPayload = await readJson(tokenResponse);
  if (!tokenResponse.ok || typeof tokenPayload?.token !== "string") {
    throw new Error(`GitHub App installation token failed (${tokenResponse.status}).`);
  }

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenPayload.token}`,
        "Content-Type": "application/json",
        "User-Agent": "hara-world",
        "X-GitHub-Api-Version": "2022-11-28",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const error = new Error(payload?.message || `GitHub request failed (${response.status}).`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return { ...resolved, request };
}
