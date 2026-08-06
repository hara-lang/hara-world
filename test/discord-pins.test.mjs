import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDiscordArticle,
  fetchPinnedItems,
  sanitizeDiscordMarkdown,
  syncDiscordPins,
  validateDiscordConfig,
} from "../scripts/sync-discord-pins.mjs";

const CHANNEL = { id: "123456789012345678", slug: "announcements", title: "Announcements", active: true, topics: ["community"] };
const GUILD = "999999999999999999";

function pin(id, pinnedAt, content = "Release **today** <@123> @everyone") {
  return {
    pinned_at: pinnedAt,
    message: {
      id,
      channel_id: CHANNEL.id,
      timestamp: "2026-08-07T00:00:00.000Z",
      edited_timestamp: null,
      content,
      author: { id: "42", username: "maintainer", global_name: "Hara Maintainer" },
      attachments: [{ filename: "release-notes.pdf", url: "https://cdn.discordapp.com/secret" }],
      embeds: [{ title: "Release notes", description: "Read <#456> before upgrading.", url: "https://hara-lang.org/release" }],
    },
  };
}

test("sanitises Discord mentions before publication", () => {
  const value = sanitizeDiscordMarkdown("<@123> <@!124> <@&125> <#126> @everyone @here");
  assert.equal(value, "@user @user @role #channel everyone here");
  assert.doesNotMatch(value, /<[@#]/);
});

test("builds deterministic Git-reviewed announcement Markdown", () => {
  const article = buildDiscordArticle(pin("777777777777777777", "2026-08-07T01:00:00.000Z"), CHANNEL, GUILD);
  assert.equal(article.fileName, "2026-08-07-discord-announcements-777777777777777777.md");
  assert.match(article.markdown, /kind: "field-note"/);
  assert.match(article.markdown, /"announcement","discord","announcements","community"/);
  assert.match(article.markdown, /canonicalUrl: "https:\/\/discord\.com\/channels\//);
  assert.match(article.markdown, /Publication still requires Git review and merge/);
  assert.match(article.markdown, /release-notes\.pdf/);
  assert.doesNotMatch(article.markdown, /cdn\.discordapp\.com/);
  assert.doesNotMatch(article.markdown, /<@123>|@everyone|<#456>/);
  assert.equal(article.sha256.length, 64);
});

test("uses the paginated Discord messages pins endpoint", async () => {
  const calls = [];
  const pages = [
    { items: [pin("2", "2026-08-07T02:00:00.000Z"), pin("1", "2026-08-07T01:00:00.000Z")], has_more: true },
    { items: [pin("0", "2026-08-07T00:00:00.000Z")], has_more: false },
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json(pages.shift());
  };
  const items = await fetchPinnedItems(CHANNEL.id, "token", { fetchImpl, apiBase: "https://discord.example/api/v10" });
  assert.equal(items.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, `/api/v10/channels/${CHANNEL.id}/messages/pins`);
  assert.equal(calls[0].url.searchParams.get("limit"), "50");
  assert.equal(calls[1].url.searchParams.get("before"), "2026-08-07T01:00:00.000Z");
  assert.equal(calls[0].init.headers.Authorization, "Bot token");
});

test("rejects duplicate channels and active channels without a guild", () => {
  assert.throws(() => validateDiscordConfig({ version: 1, guildId: GUILD, channels: [CHANNEL, CHANNEL] }), /more than once/);
  assert.throws(() => validateDiscordConfig({ version: 1, guildId: "", channels: [CHANNEL] }), /guildId/);
});

test("an empty reviewed registry does not need a Discord token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hara-discord-pins-"));
  try {
    await mkdir(path.join(root, "registry"), { recursive: true });
    await writeFile(path.join(root, "registry/discord-channels.json"), `${JSON.stringify({ version: 1, guildId: "", channels: [] }, null, 2)}\n`);
    const result = await syncDiscordPins({ root, token: "", fetchImpl: () => { throw new Error("fetch should not run"); } });
    assert.deepEqual(result.state, { version: 1, guildId: "", channels: {} });
    assert.match(await readFile(path.join(root, "registry/discord-sync-state.json"), "utf8"), /"channels": \{\}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
