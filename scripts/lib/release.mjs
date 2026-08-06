import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function loadRelease(target, root = process.cwd()) {
  const releaseDirectory = path.resolve(root, target);
  const manifestPath = path.join(releaseDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { releaseDirectory, manifest, manifestPath };
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeReceipt(releaseDirectory, channel, value) {
  const receipt = {
    version: 1,
    channel,
    recordedAt: new Date().toISOString(),
    ...value
  };
  await writeJson(path.join(releaseDirectory, "receipts", `${channel}.json`), receipt);
  return receipt;
}

export function socialPayload(manifest, social, channel) {
  const payload = social[channel];
  if (!payload) throw new Error(`No ${channel} projection exists in this release.`);
  return payload;
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const details = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${options?.method ?? "GET"} ${url} failed (${response.status}): ${details}`);
  }
  return { response, body };
}
