import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isPublishMode, parseArgs, required } from "../lib/cli.mjs";
import { fetchJson, loadRelease, writeReceipt } from "../lib/release.mjs";

const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const metadata = JSON.parse(await readFile(path.join(releaseDirectory, manifest.assets.youtube), "utf8"));
const videoPath = path.resolve(args.video ?? path.join(releaseDirectory, metadata.media));
const payload = {
  snippet: metadata.snippet,
  status: {
    ...metadata.status,
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || metadata.status.privacyStatus || "private"
  }
};

if (!isPublishMode(args)) {
  console.log(JSON.stringify({ mode: "dry-run", channel: "youtube", videoPath, payload }, null, 2));
  process.exit(0);
}

const clientId = required(process.env.YOUTUBE_CLIENT_ID, "YOUTUBE_CLIENT_ID");
const clientSecret = required(process.env.YOUTUBE_CLIENT_SECRET, "YOUTUBE_CLIENT_SECRET");
const refreshToken = required(process.env.YOUTUBE_REFRESH_TOKEN, "YOUTUBE_REFRESH_TOKEN");
const fileInfo = await stat(videoPath);
if (!fileInfo.isFile()) throw new Error(`YouTube media is not a file: ${videoPath}`);

const tokenBody = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  refresh_token: refreshToken,
  grant_type: "refresh_token"
});
const { body: token } = await fetchJson("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: tokenBody
});

const initiation = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token.access_token}`,
    "content-type": "application/json; charset=UTF-8",
    "x-upload-content-length": String(fileInfo.size),
    "x-upload-content-type": "video/mp4"
  },
  body: JSON.stringify(payload)
});
if (!initiation.ok) throw new Error(`YouTube upload initiation failed (${initiation.status}): ${await initiation.text()}`);
const uploadUrl = initiation.headers.get("location");
if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");

const video = await readFile(videoPath);
const upload = await fetch(uploadUrl, {
  method: "PUT",
  headers: {
    "content-length": String(video.byteLength),
    "content-type": "video/mp4"
  },
  body: video
});
const uploadText = await upload.text();
let result;
try { result = JSON.parse(uploadText); } catch { result = uploadText; }
if (!upload.ok) throw new Error(`YouTube upload failed (${upload.status}): ${uploadText}`);
const receipt = await writeReceipt(releaseDirectory, "youtube", {
  state: payload.status.privacyStatus,
  id: result.id,
  url: `https://youtu.be/${result.id}`,
  studioUrl: `https://studio.youtube.com/video/${result.id}/edit`,
  response: result
});
console.log(JSON.stringify(receipt, null, 2));
