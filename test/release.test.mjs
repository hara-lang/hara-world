import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("builds a review-first release bundle from an article", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "hara-learn-release-"));
  try {
    await run(process.execPath, [
      "scripts/build-release.mjs",
      "--article=2026-08-06-a-publication-for-the-programmable-world",
      `--output=${output}`
    ], root);
    const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
    const social = JSON.parse(await readFile(path.join(output, "social.json"), "utf8"));
    const captions = await readFile(path.join(output, "captions.srt"), "utf8");
    assert.equal(manifest.requiresEditorialReview, true);
    assert.equal(manifest.policy.youtube, "private");
    assert.equal(manifest.policy.buttondown, "draft");
    assert.ok(Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(social.bluesky.text)).length <= 300);
    assert.ok(social.bluesky.text.endsWith(manifest.article.url));
    assert.ok(social.mastodon.status.endsWith(manifest.article.url));
    assert.ok(social.x.text.endsWith(manifest.article.url));
    assert.match(captions, /00:00:00,000 -->/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `${command} exited ${code}`)));
  });
}
