import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPublishMode, parseArgs, required } from "../lib/cli.mjs";
import { fetchJson, loadRelease, writeReceipt } from "../lib/release.mjs";

const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const body = await readFile(path.join(releaseDirectory, manifest.assets.newsletter), "utf8");
const payload = {
  subject: manifest.article.title,
  slug: manifest.article.id.split("/").at(-1),
  body,
  description: manifest.article.description,
  canonical_url: manifest.article.url,
  status: "draft",
  metadata: {
    hara_learn_release_id: manifest.releaseId,
    canonical_url: manifest.article.canonicalUrl
  }
};

if (!isPublishMode(args)) {
  console.log(JSON.stringify({ mode: "dry-run", channel: "buttondown", payload }, null, 2));
  process.exit(0);
}

const apiKey = required(process.env.BUTTONDOWN_API_KEY, "BUTTONDOWN_API_KEY");
const { body: response } = await fetchJson("https://api.buttondown.com/v1/emails", {
  method: "POST",
  headers: {
    authorization: `Token ${apiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(payload)
});

const receipt = await writeReceipt(releaseDirectory, "buttondown", {
  state: "draft",
  id: response.id,
  url: response.absolute_url,
  response
});
console.log(JSON.stringify(receipt, null, 2));
