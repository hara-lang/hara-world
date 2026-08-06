import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isPublishMode, parseArgs, required } from "../lib/cli.mjs";
import { loadRelease, writeReceipt } from "../lib/release.mjs";

const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const social = JSON.parse(await readFile(path.join(releaseDirectory, manifest.assets.social), "utf8"));
const videoPath = path.join(releaseDirectory, manifest.assets.video);
const captionsPath = path.join(releaseDirectory, manifest.assets.captions);
const channels = String(args.channels ?? "linkedin,instagram,x,tiktok").split(",").map((value) => value.trim()).filter(Boolean);
const envelope = {
  version: 1,
  releaseId: manifest.releaseId,
  requestedAt: new Date().toISOString(),
  requiresReview: true,
  channels,
  article: manifest.article,
  projections: Object.fromEntries(channels.map((channel) => [channel, social[channel]]).filter(([, projection]) => projection))
};

if (!isPublishMode(args)) {
  console.log(JSON.stringify({ mode: "dry-run", channel: "managed-social", envelope, videoPath }, null, 2));
  process.exit(0);
}

const endpoint = required(process.env.HARA_PUBLISH_WEBHOOK_URL, "HARA_PUBLISH_WEBHOOK_URL");
const form = new FormData();
form.set("release", new Blob([JSON.stringify(envelope)], { type: "application/json" }), "release.json");
form.set("social", new Blob([JSON.stringify(social)], { type: "application/json" }), "social.json");
form.set("captions", new Blob([await readFile(captionsPath)], { type: "application/x-subrip" }), "captions.srt");
try {
  const info = await stat(videoPath);
  if (info.isFile()) form.set("video", new Blob([await readFile(videoPath)], { type: "video/mp4" }), "short.mp4");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const response = await fetch(endpoint, {
  method: "POST",
  headers: process.env.HARA_PUBLISH_WEBHOOK_SECRET
    ? { authorization: `Bearer ${process.env.HARA_PUBLISH_WEBHOOK_SECRET}` }
    : {},
  body: form
});
const text = await response.text();
let result;
try { result = text ? JSON.parse(text) : {}; } catch { result = { body: text }; }
if (!response.ok) throw new Error(`Managed publisher webhook failed (${response.status}): ${text}`);
const receipt = await writeReceipt(releaseDirectory, "managed-social", {
  state: "queued-for-review",
  channels,
  response: result
});
console.log(JSON.stringify(receipt, null, 2));
