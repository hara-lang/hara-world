import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { fetchPublicFeed } from "../netlify/functions/_shared/feed-probe.mjs";
import { parseArgs } from "./lib/cli.mjs";
import { contentHash, serialiseFrontmatter, slugify, stripHtml, truncate } from "./lib/article.mjs";

const args = parseArgs();
const root = process.cwd();
const registryPath = path.resolve(root, args.registry ?? "registry/sources.json");
const statePath = path.resolve(root, args.state ?? "registry/sync-state.json");
const articleDirectory = path.resolve(root, "content/articles/syndicated");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const state = await loadState(statePath);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: false,
  trimValues: true
});
const created = [];

for (const source of registry.sources.filter((entry) => entry.status === "active")) {
  const { xml } = await fetchPublicFeed(source.feed, {
    timeoutMs: 20_000,
    maximumBytes: 5 * 1024 * 1024,
  });
  const parsed = parser.parse(xml);
  const items = normaliseFeed(parsed)
    .sort((left, right) => dateValue(right.publishedAt) - dateValue(left.publishedAt))
    .slice(0, Number(args.max ?? source.maxItemsPerRun ?? 5));
  const seen = new Set(state.seen[source.id] ?? []);

  for (const item of items.reverse()) {
    if (!item.title || !item.url) continue;
    item.url = normaliseArticleUrl(item.url, source.homepage);
    if (!item.url) continue;
    const fingerprint = contentHash(`${source.id}\n${item.id || item.url}\n${item.title}`, 24);
    if (seen.has(fingerprint)) continue;
    const publishedAt = validDate(item.publishedAt) ?? new Date();
    if (publishedAt.valueOf() > Date.now() + 86_400_000) continue;
    const datePrefix = publishedAt.toISOString().slice(0, 10);
    const filename = `${datePrefix}-${slugify(item.title) || "entry"}-${source.id}-${fingerprint.slice(0, 8)}.md`;
    const target = path.join(articleDirectory, filename);
    const description = truncate(stripHtml(item.summary || item.content || item.title), 260);
    const body = articleBody(source, item, description);
    const frontmatter = serialiseFrontmatter({
      title: item.title,
      description,
      publishedAt: publishedAt.toISOString(),
      author: item.author || source.defaultAuthor || source.name,
      kind: "syndicated",
      topics: source.topics,
      canonicalUrl: item.url,
      sourceId: source.id,
      sourceTitle: source.name,
      license: source.license,
      disclosure: `Imported from the registered ${source.name} feed. The text and metadata were normalised automatically; editorial review occurs in the pull request.`,
      draft: false,
      featured: false,
      generated: true,
      video: false,
      newsletter: true,
      social: false
    });

    if (!args.dryRun) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${frontmatter}${body.trim()}\n`);
    }
    seen.add(fingerprint);
    created.push({ source: source.id, title: item.title, target: path.relative(root, target), canonicalUrl: item.url });
  }
  state.seen[source.id] = Array.from(seen).slice(-1000);
}

if (created.length > 0) {
  state.updatedAt = new Date().toISOString();
  if (!args.dryRun) await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}
console.log(JSON.stringify({ dryRun: Boolean(args.dryRun), createdCount: created.length, created }, null, 2));

async function loadState(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    return { version: 1, seen: {}, ...value };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, updatedAt: null, seen: {} };
    throw error;
  }
}

function normaliseFeed(value) {
  const rssItems = value?.rss?.channel?.item;
  const atomItems = value?.feed?.entry;
  const items = arrayify(rssItems ?? atomItems ?? []);
  return items.map((item) => ({
    id: text(item.guid ?? item.id ?? item.link),
    title: text(item.title),
    url: linkValue(item.link),
    publishedAt: text(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]),
    author: authorValue(item.author ?? item["dc:creator"]),
    summary: richText(item.summary ?? item.description),
    content: richText(item["content:encoded"] ?? item.content ?? item.description)
  }));
}

function articleBody(source, item, description) {
  const original = `[Read the original at ${source.name} →](${item.url})`;
  if (source.syndication === "link") {
    return `${description}\n\n${original}\n`;
  }
  if (source.syndication === "full") {
    const markdown = htmlToMarkdown(item.content || item.summary || description);
    return `${markdown}\n\n---\n\n${original}\n`;
  }
  const excerpt = escapeMarkdownText(truncate(stripHtml(item.content || item.summary || description), 900));
  return `> ${excerpt}\n\n${original}\n`;
}

function htmlToMarkdown(value) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(h1|h2|h3|p|div|section|article|blockquote|li)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/[^>]+>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\n/)
    .map((line) => escapeMarkdownText(stripHtml(line).trim()))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function escapeMarkdownText(value) {
  return String(value).replace(/([\\`*_[\]<>])/g, "\\$1");
}

function normaliseArticleUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function arrayify(value) { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text(value["#text"] ?? value.name ?? value.href ?? value["@_href"]);
  return "";
}
function richText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(richText).join("\n");
  if (typeof value === "object") return String(value["#text"] ?? value.__cdata ?? text(value));
  return String(value);
}
function linkValue(value) {
  const links = arrayify(value);
  const alternate = links.find((link) => typeof link === "object" && (!link["@_rel"] || link["@_rel"] === "alternate"));
  return text(alternate ?? links[0]);
}
function authorValue(value) { return text(value?.name ?? value); }
function validDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : date; }
function dateValue(value) { return validDate(value)?.valueOf() ?? 0; }
