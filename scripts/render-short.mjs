import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import sharp from "sharp";
import { parseArgs, required } from "./lib/cli.mjs";
import { loadRelease } from "./lib/release.mjs";

const run = promisify(execFile);
const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const storyboard = JSON.parse(await readFile(path.join(releaseDirectory, manifest.assets.storyboard), "utf8"));
const framesDirectory = path.join(releaseDirectory, "frames");
await mkdir(framesDirectory, { recursive: true });

const framePaths = [];
for (const scene of storyboard.scenes) {
  const framePath = path.join(framesDirectory, `frame-${String(scene.index).padStart(3, "0")}.png`);
  await sharp(Buffer.from(sceneSvg(scene, storyboard))).png().toFile(framePath);
  framePaths.push({ framePath, duration: scene.durationSeconds });
}

const concatPath = path.join(framesDirectory, "frames.txt");
const concat = framePaths.flatMap(({ framePath, duration }) => [
  `file '${escapeConcatPath(framePath)}'`,
  `duration ${duration}`
]);
concat.push(`file '${escapeConcatPath(framePaths.at(-1).framePath)}'`);
await writeFile(concatPath, `${concat.join("\n")}\n`);

const narrationPath = await resolveNarration(args, releaseDirectory, manifest);
const outputPath = path.resolve(args.output ?? path.join(releaseDirectory, manifest.assets.video));
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const videoInput = ["-y", "-f", "concat", "-safe", "0", "-i", concatPath];
const videoOptions = [
  "-vf", `fps=${storyboard.format.framesPerSecond},format=yuv420p`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  "-movflags", "+faststart"
];

if (narrationPath) {
  await run(ffmpeg, [
    ...videoInput,
    "-i", narrationPath,
    ...videoOptions,
    "-filter_complex", "[1:a]apad[audio]",
    "-map", "0:v:0", "-map", "[audio]",
    "-t", String(storyboard.durationSeconds),
    "-c:a", "aac", "-b:a", "160k",
    outputPath
  ], { maxBuffer: 10 * 1024 * 1024 });
} else {
  await run(ffmpeg, [
    ...videoInput,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    ...videoOptions,
    "-map", "0:v:0", "-map", "1:a:0",
    "-t", String(storyboard.durationSeconds),
    "-c:a", "aac", "-b:a", "128k",
    outputPath
  ], { maxBuffer: 10 * 1024 * 1024 });
}

console.log(JSON.stringify({ outputPath, durationSeconds: storyboard.durationSeconds, narration: narrationPath ?? "silent" }, null, 2));

async function resolveNarration(parsedArgs, directory, releaseManifest) {
  if (parsedArgs.audio) return path.resolve(parsedArgs.audio);
  const endpoint = process.env.HARA_LEARN_TTS_ENDPOINT;
  if (!endpoint) return null;

  const narration = await readFile(path.join(directory, releaseManifest.assets.narration), "utf8");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.HARA_LEARN_TTS_TOKEN ? { authorization: `Bearer ${process.env.HARA_LEARN_TTS_TOKEN}` } : {})
    },
    body: JSON.stringify({
      text: narration,
      voice: process.env.HARA_LEARN_TTS_VOICE || "hara-learn",
      format: "mp3",
      releaseId: releaseManifest.releaseId
    })
  });
  if (!response.ok) throw new Error(`TTS endpoint failed (${response.status}): ${await response.text()}`);
  const audioPath = path.join(directory, "narration.mp3");
  await writeFile(audioPath, Buffer.from(await response.arrayBuffer()));
  return audioPath;
}

function sceneSvg(scene, story) {
  const width = story.format.width;
  const height = story.format.height;
  const headline = wrap(scene.headline, 21, 5);
  const body = wrap(scene.body, 34, 7);
  const progress = ((scene.startSeconds + scene.durationSeconds) / story.durationSeconds) * 780;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050608"/><stop offset=".55" stop-color="#151920"/><stop offset="1" stop-color="#080a0d"/></linearGradient>
      <radialGradient id="pulse" cx="82%" cy="18%" r="66%"><stop offset="0" stop-color="#2f7cff" stop-opacity=".30"/><stop offset="1" stop-color="#2f7cff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#bg)"/>
    <rect width="1080" height="1920" fill="url(#pulse)"/>
    <path d="M90 0V1920M990 0V1920M0 240H1080M0 1680H1080" stroke="#dfe7f0" stroke-opacity=".10"/>
    <path d="M1050 90 720 420 1050 750" fill="none" stroke="#dfe7f0" stroke-opacity=".16" stroke-width="2"/>
    <path d="M900 -40 580 280 900 600 1220 280Z" fill="none" stroke="#2f7cff" stroke-opacity=".32" stroke-width="3"/>
    <g transform="translate(90 110)">
      <rect width="78" height="78" rx="16" fill="#080a0d" stroke="#dfe7f0" stroke-opacity=".22"/>
      <path fill="#f4f6f8" d="M13 13h16v23h20V13h16v52H49V48H29v17H13z"/>
      <path fill="#2f7cff" d="M34 13h12v12H34z"/>
    </g>
    <text x="190" y="160" fill="#f4f6f8" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">Hara Learn</text>
    <text x="90" y="330" fill="#8db2ff" font-family="monospace" font-size="24" letter-spacing="5">${escapeXml(scene.eyebrow.toUpperCase())}</text>
    <text x="90" y="520" fill="#f4f6f8" font-family="Arial, Helvetica, sans-serif" font-size="${headline.length > 3 ? 78 : 90}" font-weight="650" letter-spacing="-3">${tspans(headline, 108)}</text>
    <text x="90" y="${950 + Math.max(0, headline.length - 3) * 92}" fill="#a0a8b1" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="400">${tspans(body, 60)}</text>
    <rect x="90" y="1740" width="780" height="4" rx="2" fill="#dfe7f0" fill-opacity=".12"/>
    <rect x="90" y="1740" width="${progress.toFixed(1)}" height="4" rx="2" fill="#2f7cff"/>
    <text x="90" y="1825" fill="#6f7882" font-family="monospace" font-size="22" letter-spacing="3">LEARN / ${String(scene.index + 1).padStart(2, "0")}</text>
    <text x="990" y="1825" text-anchor="end" fill="#6f7882" font-family="monospace" font-size="22">HARA-LANG.ORG</text>
  </svg>`;
}

function wrap(value, maximum, maximumLines) {
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maximum || !line) line = candidate;
    else { lines.push(line); line = word; }
    if (lines.length === maximumLines) break;
  }
  if (line && lines.length < maximumLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1).replace(/[.,;:!?]?$/, "")}…`;
  }
  return lines;
}

function tspans(lines, lineHeight) {
  return lines.map((line, index) => `<tspan x="90" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("");
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);
}

function escapeConcatPath(value) {
  return path.resolve(value).replace(/\\/g, "/").replace(/'/g, "'\\''");
}
