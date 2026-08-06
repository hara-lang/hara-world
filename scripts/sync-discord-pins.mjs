import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE = "https://discord.com/api/v10";
const DEFAULT_CONFIG = "registry/discord-channels.json";
const DEFAULT_STATE = "registry/discord-sync-state.json";
const DEFAULT_OUTPUT = "content/articles/discord";
const DISCORD_ID = /^\d+$/;
const CHANNEL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArgs(argv = process.argv.slice(2)) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) output[key] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) output[key] = argv[++index];
    else output[key] = true;
  }
  return output;
}

function serialiseFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${Array.isArray(value) || typeof value === "string" ? JSON.stringify(value) : String(value)}`);
  }
  return `${lines.join("\n")}\n---\n\n`;
}

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function truncate(value, maximum, suffix = "…") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  const available = Math.max(0, maximum - suffix.length);
  const probe = text.slice(0, available + 1);
  const boundary = probe.lastIndexOf(" ");
  const clipped = boundary >= Math.floor(available * 0.55) ? probe.slice(0, boundary) : text.slice(0, available);
  return `${clipped.trimEnd()}${suffix}`;
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[~*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function contentHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeIsoDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`Discord ${label} is missing or invalid.`);
  return date.toISOString();
}

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeIfChanged(filePath, value) {
  let existing = null;
  try { existing = await readFile(filePath, "utf8"); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing === value) return false;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
  return true;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function validateDiscordConfig(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.channels)) {
    throw new Error("Discord channel configuration must use version 1 and contain a channels array.");
  }

  const seen = new Set();
  const channels = input.channels.map((channel, index) => {
    const id = String(channel?.id ?? "");
    const slug = String(channel?.slug ?? "");
    const title = String(channel?.title ?? "").trim();
    if (!DISCORD_ID.test(id)) throw new Error(`Discord channel ${index + 1} has an invalid numeric id.`);
    if (!CHANNEL_SLUG.test(slug)) throw new Error(`Discord channel ${id} has an invalid slug.`);
    if (!title) throw new Error(`Discord channel ${id} requires a title.`);
    if (seen.has(id)) throw new Error(`Discord channel ${id} is configured more than once.`);
    seen.add(id);
    return {
      id,
      slug,
      title,
      active: channel.active !== false,
      topics: Array.isArray(channel.topics) ? channel.topics.map(String).filter(Boolean) : [],
    };
  });

  const guildId = String(input.guildId ?? "");
  if (channels.some((channel) => channel.active) && !DISCORD_ID.test(guildId)) {
    throw new Error("An active Discord channel requires a numeric guildId.");
  }
  return { version: 1, guildId, channels };
}

export function sanitizeDiscordMarkdown(value) {
  return String(value ?? "")
    .replace(/<@!?\d+>/g, "@user")
    .replace(/<@&\d+>/g, "@role")
    .replace(/<#\d+>/g, "#channel")
    .replace(/@everyone\b/g, "everyone")
    .replace(/@here\b/g, "here")
    .replace(/\r\n?/g, "\n")
    .replace(/\0/g, "")
    .trim();
}

export function discordMessageUrl(guildId, channelId, messageId) {
  for (const [label, value] of [["guild", guildId], ["channel", channelId], ["message", messageId]]) {
    if (!DISCORD_ID.test(String(value))) throw new Error(`Discord ${label} id is invalid.`);
  }
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function embedMarkdown(embeds = []) {
  const sections = [];
  for (const embed of embeds) {
    const title = sanitizeDiscordMarkdown(embed?.title);
    const description = sanitizeDiscordMarkdown(embed?.description);
    const url = safeHttpUrl(embed?.url);
    if (!title && !description && !url) continue;
    if (title) sections.push(`### ${title}`);
    if (description) sections.push(description);
    if (url) sections.push(`[Open linked material](${url})`);
  }
  return sections;
}

function attachmentMarkdown(attachments = []) {
  const filenames = attachments
    .map((attachment) => String(attachment?.filename ?? "").replace(/[\r\n]/g, " ").trim())
    .filter(Boolean);
  if (!filenames.length) return [];
  return [
    "### Source attachments",
    ...filenames.map((filename) => `- ${filename} — open the original Discord message to retrieve this file.`),
  ];
}

export function buildDiscordArticle(item, channel, guildId) {
  const message = item?.message ?? item;
  const messageId = String(message?.id ?? "");
  const channelId = String(message?.channel_id ?? channel?.id ?? "");
  const sourceUrl = discordMessageUrl(guildId, channelId, messageId);
  const content = sanitizeDiscordMarkdown(message?.content);
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  const embedSections = embedMarkdown(embeds);
  const publishedAt = safeIsoDate(message?.timestamp, "message timestamp");
  const pinnedAt = safeIsoDate(item?.pinned_at ?? message?.timestamp, "pin timestamp");
  const updatedAt = message?.edited_timestamp ? safeIsoDate(message.edited_timestamp, "edited timestamp") : undefined;
  const author = String(message?.member?.nick ?? message?.author?.global_name ?? message?.author?.username ?? "Hara community").trim() || "Hara community";
  const firstLine = content.split("\n").map((line) => stripMarkdown(line)).find(Boolean);
  const firstEmbedTitle = embeds.map((embed) => stripMarkdown(embed?.title)).find(Boolean);
  const title = truncate(firstLine || firstEmbedTitle || `${channel.title} announcement`, 88);
  const descriptionSource = stripMarkdown([content, ...embedSections].join(" "));
  const description = truncate(descriptionSource || `A pinned announcement from ${channel.title} in the Hara Discord.`, 220);
  const date = publishedAt.slice(0, 10);
  const fileName = `${date}-discord-${slugify(channel.slug)}-${messageId}.md`;
  const topics = [...new Set(["announcement", "discord", channel.slug, ...channel.topics])];
  const body = [
    `> Imported from a pinned message in **${channel.title}**. Publication still requires Git review and merge.`,
    content,
    ...embedSections,
    ...attachmentMarkdown(Array.isArray(message?.attachments) ? message.attachments : []),
    "### Source",
    `[Open the original pinned message on Discord](${sourceUrl})`,
  ].filter(Boolean).join("\n\n");
  const markdown = serialiseFrontmatter({
    title,
    description,
    publishedAt,
    updatedAt,
    author,
    kind: "field-note",
    topics,
    canonicalUrl: sourceUrl,
    sourceId: `discord:${messageId}`,
    sourceTitle: `Hara Discord / ${channel.title}`,
    disclosure: "Generated from a reviewed Discord pin intake. Merge is the publication event.",
    draft: false,
    featured: false,
    generated: true,
    video: false,
    newsletter: true,
    social: true,
  }) + `${body}\n`;

  return {
    messageId,
    channelId,
    sourceUrl,
    pinnedAt,
    fileName,
    markdown,
    sha256: contentHash(markdown),
  };
}

export async function fetchPinnedItems(channelId, token, {
  fetchImpl = fetch,
  apiBase = DEFAULT_API_BASE,
  maximumPages = 20,
} = {}) {
  if (!DISCORD_ID.test(String(channelId))) throw new Error("Discord channel id is invalid.");
  if (!token) throw new Error("DISCORD_BOT_TOKEN is required for active channels.");

  const output = new Map();
  let before = null;
  for (let page = 0; page < maximumPages; page += 1) {
    const url = new URL(`${String(apiBase).replace(/\/$/, "")}/channels/${channelId}/messages/pins`);
    url.searchParams.set("limit", "50");
    if (before) url.searchParams.set("before", before);
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bot ${token}`,
        "User-Agent": "hara-world-discord-pins/1",
      },
    });
    if (!response.ok) {
      const detail = truncate(await response.text().catch(() => ""), 180);
      throw new Error(`Discord pin request failed for channel ${channelId}: ${response.status}${detail ? ` ${detail}` : ""}`);
    }
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) throw new Error("Discord pin response did not contain an items array.");
    for (const item of items) {
      const id = String(item?.message?.id ?? item?.id ?? "");
      if (DISCORD_ID.test(id)) output.set(id, item);
    }
    if (Array.isArray(payload) || payload?.has_more !== true || items.length === 0) break;
    const cursors = items.map((item) => item?.pinned_at).filter(Boolean).sort();
    const nextBefore = cursors[0];
    if (!nextBefore || nextBefore === before) break;
    before = nextBefore;
  }
  return [...output.values()];
}

export async function syncDiscordPins({
  root = process.cwd(),
  configPath = DEFAULT_CONFIG,
  statePath = DEFAULT_STATE,
  outputPath = DEFAULT_OUTPUT,
  token = process.env.DISCORD_BOT_TOKEN,
  guildIdOverride = process.env.DISCORD_GUILD_ID,
  dryRun = false,
  fetchImpl = fetch,
} = {}) {
  const absoluteConfig = path.resolve(root, configPath);
  const absoluteState = path.resolve(root, statePath);
  const absoluteOutput = path.resolve(root, outputPath);
  const config = validateDiscordConfig(await readJson(absoluteConfig, null));
  const guildId = String(guildIdOverride || config.guildId || "");
  const activeChannels = config.channels.filter((channel) => channel.active);
  if (activeChannels.length && !DISCORD_ID.test(guildId)) throw new Error("A numeric Discord guild id is required.");
  if (activeChannels.length && !token) throw new Error("DISCORD_BOT_TOKEN is required for active channels.");

  const changes = [];
  const nextChannels = {};
  for (const channel of activeChannels) {
    const items = await fetchPinnedItems(channel.id, token, { fetchImpl });
    const pins = {};
    for (const item of items) {
      const article = buildDiscordArticle(item, channel, guildId);
      const target = path.join(absoluteOutput, article.fileName);
      const relativeTarget = path.relative(root, target).replace(/\\/g, "/");
      pins[article.messageId] = {
        path: relativeTarget,
        pinnedAt: article.pinnedAt,
        sourceUrl: article.sourceUrl,
        sha256: article.sha256,
      };
      if (dryRun) {
        changes.push(relativeTarget);
      } else if (await writeIfChanged(target, article.markdown)) {
        changes.push(relativeTarget);
      }
    }
    nextChannels[channel.id] = {
      slug: channel.slug,
      title: channel.title,
      pins: sortedObject(pins),
    };
  }

  const nextState = {
    version: 1,
    guildId,
    channels: sortedObject(nextChannels),
  };
  const stateText = `${JSON.stringify(nextState, null, 2)}\n`;
  if (!dryRun && await writeIfChanged(absoluteState, stateText)) changes.push(statePath);
  return { changes, state: nextState };
}

async function main() {
  const args = parseArgs();
  const result = await syncDiscordPins({
    configPath: args.config || DEFAULT_CONFIG,
    statePath: args.state || DEFAULT_STATE,
    outputPath: args.output || DEFAULT_OUTPUT,
    dryRun: args.dryRun === true || args.dryRun === "true",
  });
  if (!result.changes.length) console.log("Discord pin intake is already current.");
  else console.log(`Discord pin intake proposed ${result.changes.length} changed file(s):\n${result.changes.join("\n")}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
