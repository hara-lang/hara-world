import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function parseFrontmatter(source) {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    return { data: {}, body: source };
  }

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("Article has an unterminated frontmatter block.");

  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`Unsupported frontmatter line: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    data[key] = parseScalar(value);
  }

  return { data, body: source.slice(match[0].length) };
}

function parseScalar(value) {
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { /* handled below */ }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    try { return JSON.parse(value); } catch {
      return value.slice(1, -1).split(",").map((item) => parseScalar(item.trim())).filter(Boolean);
    }
  }

  return value;
}

export function serialiseFrontmatter(data) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${serialiseScalar(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function serialiseScalar(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

export function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[~*_]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(html) {
  return decodeEntities(String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return named[entity.toLowerCase()] ?? _;
  });
}

export function truncate(value, maximum, suffix = "…") {
  const text = String(value ?? "").trim();
  if (text.length <= maximum) return text;
  const available = Math.max(0, maximum - suffix.length);
  const probe = text.slice(0, available + 1);
  const boundary = probe.lastIndexOf(" ");
  const clipped = boundary >= Math.floor(available * 0.55)
    ? probe.slice(0, boundary)
    : text.slice(0, available);
  return `${clipped.trimEnd()}${suffix}`;
}

export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

export function contentHash(value, length = 12) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function splitForNarration(markdown, description) {
  const source = markdown.replace(/```[\s\S]*?```/g, "").trim();
  const headingPattern = /^##\s+(.+)$/gm;
  const matches = Array.from(source.matchAll(headingPattern));
  const segments = [];
  const introEnd = matches[0]?.index ?? source.length;
  const intro = sectionExcerpt(source.slice(0, introEnd));
  if (intro) {
    segments.push({
      headline: headlineFromText(intro),
      narration: intro
    });
  } else if (description) {
    segments.push({ headline: headlineFromText(description), narration: description });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? source.length;
    const excerpt = sectionExcerpt(source.slice(bodyStart, bodyEnd));
    if (!excerpt) continue;
    segments.push({
      headline: stripMarkdown(match[1]),
      narration: `${stripMarkdown(match[1])}. ${excerpt}`
    });
  }

  return segments.slice(0, 5);
}

function sectionExcerpt(markdown) {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map(stripMarkdown)
    .filter((paragraph) => paragraph.length > 25 && !paragraph.startsWith("http"));
  if (!paragraphs.length) return "";
  return completeSentenceExcerpt(paragraphs[0], 210);
}

function completeSentenceExcerpt(value, maximum) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let output = "";
  for (const sentence of sentences) {
    const candidate = output ? `${output} ${sentence}` : sentence;
    if (candidate.length > maximum) break;
    output = candidate;
  }
  return output || truncate(text, maximum);
}

function headlineFromText(value) {
  const sentence = String(value).split(/(?<=[.!?])\s+/)[0] || value;
  return truncate(sentence, 78);
}

export async function findArticle(articleId, root = process.cwd()) {
  const contentDirectory = path.resolve(root, "content/articles");
  const normalised = String(articleId ?? "").replace(/\.md$/, "");
  if (!normalised || normalised.includes("..") || path.isAbsolute(normalised)) {
    throw new Error("Article ID must be a relative content identifier.");
  }

  const directPath = path.resolve(contentDirectory, `${normalised}.md`);
  if (!directPath.startsWith(`${contentDirectory}${path.sep}`)) {
    throw new Error("Article path escapes content/articles.");
  }

  try {
    const source = await readFile(directPath, "utf8");
    return { id: normalised, filePath: directPath, source, ...parseFrontmatter(source) };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const files = await walkMarkdown(contentDirectory);
  const candidate = files.find((file) => path.basename(file, ".md") === normalised);
  if (!candidate) throw new Error(`Article not found: ${articleId}`);
  const source = await readFile(candidate, "utf8");
  const id = path.relative(contentDirectory, candidate).replace(/\\/g, "/").replace(/\.md$/, "");
  return { id, filePath: candidate, source, ...parseFrontmatter(source) };
}

async function walkMarkdown(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walkMarkdown(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) output.push(target);
  }
  return output;
}
