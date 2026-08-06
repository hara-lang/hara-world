import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPublishMode, parseArgs, required } from "../lib/cli.mjs";
import { fetchJson, loadRelease, socialPayload, writeReceipt } from "../lib/release.mjs";

const args = parseArgs();
const target = required(args.release ?? args._[0], "--release");
const { releaseDirectory, manifest } = await loadRelease(target);
const social = JSON.parse(await readFile(path.join(releaseDirectory, manifest.assets.social), "utf8"));
const projection = socialPayload(manifest, social, "bluesky");
const record = {
  $type: "app.bsky.feed.post",
  text: projection.text,
  createdAt: new Date().toISOString(),
  langs: [projection.language ?? "en"],
  ...linkFacet(projection.text)
};

if (!isPublishMode(args)) {
  console.log(JSON.stringify({ mode: "dry-run", channel: "bluesky", record }, null, 2));
  process.exit(0);
}

const identifier = required(process.env.BLUESKY_HANDLE, "BLUESKY_HANDLE");
const password = required(process.env.BLUESKY_APP_PASSWORD, "BLUESKY_APP_PASSWORD");
const service = (process.env.BLUESKY_SERVICE_URL ?? "https://bsky.social").replace(/\/$/, "");
const { body: session } = await fetchJson(`${service}/xrpc/com.atproto.server.createSession`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier, password })
});
const { body: response } = await fetchJson(`${service}/xrpc/com.atproto.repo.createRecord`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${session.accessJwt}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    repo: session.did,
    collection: "app.bsky.feed.post",
    record
  })
});
const rkey = String(response.uri).split("/").at(-1);
const publicUrl = `https://bsky.app/profile/${session.handle}/post/${rkey}`;
const receipt = await writeReceipt(releaseDirectory, "bluesky", {
  state: "published",
  id: response.uri,
  cid: response.cid,
  url: publicUrl
});
console.log(JSON.stringify(receipt, null, 2));

function linkFacet(text) {
  const match = text.match(/https:\/\/\S+$/m);
  if (!match || match.index === undefined) return {};
  const uri = match[0].replace(/[),.;!?]+$/, "");
  const start = text.indexOf(uri, match.index);
  return {
    facets: [{
      index: {
        byteStart: Buffer.byteLength(text.slice(0, start)),
        byteEnd: Buffer.byteLength(text.slice(0, start + uri.length))
      },
      features: [{ $type: "app.bsky.richtext.facet#link", uri }]
    }]
  };
}
