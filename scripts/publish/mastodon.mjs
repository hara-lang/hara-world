import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPublishMode, parseArgs, required } from "../lib/cli.mjs";
import { loadRelease, socialPayload, writeReceipt } from "../lib/release.mjs";

const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const social = JSON.parse(await readFile(path.join(releaseDirectory, manifest.assets.social), "utf8"));
const projection = socialPayload(manifest, social, "mastodon");
const payload = {
  status: projection.status,
  visibility: process.env.MASTODON_VISIBILITY || projection.visibility || "public",
  language: projection.language ?? "en"
};

if (!isPublishMode(args)) {
  console.log(JSON.stringify({ mode: "dry-run", channel: "mastodon", payload }, null, 2));
  process.exit(0);
}

const baseUrl = required(process.env.MASTODON_BASE_URL, "MASTODON_BASE_URL").replace(/\/$/, "");
const accessToken = required(process.env.MASTODON_ACCESS_TOKEN, "MASTODON_ACCESS_TOKEN");
const response = await fetch(`${baseUrl}/api/v1/statuses`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "idempotency-key": manifest.releaseId
  },
  body: JSON.stringify(payload)
});
const text = await response.text();
let result;
try { result = JSON.parse(text); } catch { result = text; }
if (!response.ok) throw new Error(`Mastodon publish failed (${response.status}): ${text}`);
const receipt = await writeReceipt(releaseDirectory, "mastodon", {
  state: "published",
  id: result.id,
  url: result.url,
  uri: result.uri
});
console.log(JSON.stringify(receipt, null, 2));
