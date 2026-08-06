import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, required } from "./lib/cli.mjs";
import { contentHash, findArticle, splitForNarration, stripMarkdown, truncate } from "./lib/article.mjs";
import { writeJson } from "./lib/release.mjs";

const args = parseArgs();
const articleId = required(args.article ?? args._[0] ?? process.env.HARA_WORLD_ARTICLE, "--article");
const article = await findArticle(articleId);
const site = new URL(process.env.HARA_WORLD_SITE ?? "https://world.hara-lang.org");
const articleUrl = new URL(`/articles/${article.id}`, site).toString();
const canonicalUrl = article.data.canonicalUrl || articleUrl;
const outputDirectory = path.resolve(args.output ?? `.hara-world/releases/${article.id}`);
const plainBody = stripMarkdown(article.body);
const hash = contentHash(article.source);
const releaseId = `${article.id.replaceAll("/", "-")}-${hash}`;
const generatedAt = new Date().toISOString();

validateArticle(article);
await mkdir(outputDirectory, { recursive: true });

const social = buildSocial({
  title: article.data.title,
  description: article.data.description,
  author: article.data.author,
  topics: article.data.topics ?? [],
  articleUrl,
  canonicalUrl
});
const storyboard = buildStoryboard(article, articleUrl);
const captions = buildCaptions(storyboard.scenes);
const narration = storyboard.scenes.map((scene) => scene.narration).join("\n\n");
const newsletter = buildNewsletter(article, articleUrl, plainBody);
const youtube = buildYouTube(article, articleUrl, narration);

const manifest = {
  version: 1,
  releaseId,
  generatedAt,
  requiresEditorialReview: true,
  article: {
    id: article.id,
    title: article.data.title,
    description: article.data.description,
    author: article.data.author,
    kind: article.data.kind,
    publishedAt: new Date(article.data.publishedAt).toISOString(),
    updatedAt: article.data.updatedAt ? new Date(article.data.updatedAt).toISOString() : undefined,
    topics: article.data.topics ?? [],
    url: articleUrl,
    canonicalUrl,
    sourceId: article.data.sourceId,
    sourceTitle: article.data.sourceTitle,
    license: article.data.license,
    generated: article.data.generated === true,
    disclosure: article.data.disclosure
  },
  policy: {
    buttondown: "draft",
    bluesky: "review",
    mastodon: "review",
    youtube: "private",
    managedSocial: "review",
    attributionRequired: true,
    canonicalLinkRequired: true
  },
  assets: {
    newsletter: "newsletter.md",
    social: "social.json",
    storyboard: "storyboard.json",
    narration: "narration.txt",
    captions: "captions.srt",
    youtube: "youtube.json",
    video: "short.mp4"
  },
  channels: {
    website: { state: "canonical", url: articleUrl },
    rss: { state: "canonical", url: new URL("/feed.xml", site).toString() },
    jsonFeed: { state: "canonical", url: new URL("/feed.json", site).toString() },
    buttondown: { state: "draft" },
    bluesky: { state: "draft" },
    mastodon: { state: "draft" },
    youtube: { state: "private" },
    managedSocial: { state: "draft" }
  }
};

await Promise.all([
  writeJson(path.join(outputDirectory, "manifest.json"), manifest),
  writeJson(path.join(outputDirectory, "social.json"), social),
  writeJson(path.join(outputDirectory, "storyboard.json"), storyboard),
  writeJson(path.join(outputDirectory, "youtube.json"), youtube),
  writeFile(path.join(outputDirectory, "newsletter.md"), newsletter),
  writeFile(path.join(outputDirectory, "narration.txt"), `${narration}\n`),
  writeFile(path.join(outputDirectory, "captions.srt"), captions),
  writeFile(path.join(outputDirectory, "README.md"), buildReleaseReadme(manifest))
]);

console.log(JSON.stringify({ releaseId, article: article.id, outputDirectory, assets: manifest.assets }, null, 2));

function validateArticle(value) {
  const requiredFields = ["title", "description", "publishedAt", "author", "kind"];
  for (const field of requiredFields) {
    if (!value.data[field]) throw new Error(`Article frontmatter is missing ${field}.`);
  }
  const date = new Date(value.data.publishedAt);
  if (Number.isNaN(date.valueOf())) throw new Error("Article publishedAt is not a valid date.");
}

function buildSocial({ title, description, author, topics, articleUrl: url, canonicalUrl: canonical }) {
  const attribution = author === "Hara World" ? "Hara World" : `By ${author}`;
  const tags = topics.slice(0, 3).map((topic) => `#${topic.replace(/[^a-z0-9]/gi, "")}`).filter((tag) => tag.length > 1).join(" ");
  const compactLead = `${title}\n\n${description}`;
  const mastodonLead = `${title}\n\n${description}\n\n${attribution}${tags ? `\n\n${tags}` : ""}`;
  const linkedInLead = `${title}\n\n${description}\n\n${attribution}. Read the canonical edition on Hara World:`;

  return {
    version: 1,
    canonicalUrl: canonical,
    bluesky: {
      text: composeWithUrl(compactLead, url, 300),
      language: "en",
      requiresReview: true
    },
    mastodon: {
      status: composeWithUrl(mastodonLead, url, 500),
      visibility: "public",
      language: "en",
      requiresReview: true
    },
    x: {
      text: composeWithUrl(compactLead, url, 280),
      requiresReview: true
    },
    linkedin: {
      commentary: composeWithUrl(linkedInLead, url, 2800),
      article: { source: url, title, description },
      requiresReview: true
    },
    instagram: {
      caption: truncate(`${title}\n\n${description}\n\n${attribution}. Link in profile or Hara World.\n\n${tags}`, 2200),
      media: "short.mp4",
      requiresReview: true
    },
    tiktok: {
      caption: truncate(`${title} — ${description} ${tags}`, 2200),
      media: "short.mp4",
      requiresCreatorConfirmation: true
    }
  };
}

function buildStoryboard(value, url) {
  const segments = splitForNarration(value.body, value.data.description);
  const scenes = [
    {
      type: "title",
      eyebrow: kindLabel(value.data.kind),
      headline: value.data.title,
      body: `By ${value.data.author}`,
      narration: `${value.data.title}. ${value.data.description}`
    },
    ...segments.slice(0, 4).map((segment, index) => ({
      type: index === 0 ? "argument" : "detail",
      eyebrow: `Signal ${String(index + 1).padStart(2, "0")}`,
      headline: truncate(segment.headline, 78),
      body: truncate(segment.narration, 190),
      narration: segment.narration
    })),
    {
      type: "close",
      eyebrow: "Hara World",
      headline: "Read the canonical dispatch.",
      body: new URL(url).host,
      narration: `Read the complete canonical dispatch at ${new URL(url).host}.`
    }
  ];

  let cursor = 0;
  const timed = scenes.map((scene, index) => {
    const words = scene.narration.split(/\s+/).length;
    const durationSeconds = index === 0
      ? Math.max(7, Math.min(13, Math.ceil(words / 2.4)))
      : Math.max(5, Math.min(14, Math.ceil(words / 2.5)));
    const output = { ...scene, index, startSeconds: cursor, durationSeconds };
    cursor += durationSeconds;
    return output;
  });

  return {
    version: 1,
    format: { width: 1080, height: 1920, framesPerSecond: 30, orientation: "vertical" },
    durationSeconds: cursor,
    syntheticNarrationDisclosure: "Visuals and narration may be generated from the approved Hara World article.",
    scenes: timed
  };
}


function kindLabel(kind) {
  return ({ dispatch: "Dispatch", syndicated: "World Feed", release: "Release", "field-note": "Field note" })[kind] ?? "Hara World";
}

function buildCaptions(scenes) {
  return scenes.map((scene, index) => {
    const start = scene.startSeconds;
    const end = start + scene.durationSeconds;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${scene.narration}\n`;
  }).join("\n");
}

function srtTime(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return [hours, minutes, wholeSeconds].map((part) => String(part).padStart(2, "0")).join(":") + `,${String(remainder).padStart(3, "0")}`;
}

function buildNewsletter(value, url, plainBody) {
  const sourceLine = value.data.canonicalUrl
    ? `Originally published by ${value.data.author} at ${value.data.canonicalUrl}.`
    : `Written by ${value.data.author} for Hara World.`;
  return `<!-- buttondown-editor-mode: plaintext -->\n# ${value.data.title}\n\n${value.data.description}\n\n${sourceLine}\n\n${truncate(plainBody, 1100)}\n\n[Read the canonical edition →](${url})\n\n---\n\nHara World publishes independent dispatches, releases, field notes, and permissioned community writing from the Hara Lisp world.\n`;
}

function buildYouTube(value, url, narration) {
  const description = `${value.data.description}\n\nRead the canonical dispatch: ${url}\n\nWritten by ${value.data.author}. Generated visual editions and synthetic narration are disclosed when used.\n\nTopics: ${(value.data.topics ?? []).join(", ")}\n\n${truncate(narration, 1200)}`;
  return {
    version: 1,
    snippet: {
      title: truncate(value.data.title, 100),
      description: truncate(description, 5000),
      tags: ["Hara", "Lisp", ...(value.data.topics ?? [])].slice(0, 15),
      categoryId: "28",
      defaultLanguage: "en"
    },
    status: {
      privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "private",
      selfDeclaredMadeForKids: false
    },
    media: "short.mp4"
  };
}

function buildReleaseReadme(value) {
  return `# Release ${value.releaseId}\n\nCanonical article: ${value.article.url}\n\nThis directory is generated from an approved Hara World article. Review every projection before publication. Default states are draft, review, or private; publisher scripts require an explicit \`--publish\` flag.\n`;
}

function composeWithUrl(lead, url, maximum) {
  const separator = "\n\n";
  const urlLength = graphemeLength(url);
  const leadMaximum = Math.max(0, maximum - urlLength - graphemeLength(separator));
  return `${truncateGraphemes(lead, leadMaximum)}${separator}${url}`;
}

function graphemeLength(value) {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  return Array.from(segmenter.segment(value)).length;
}

function truncateGraphemes(value, maximum) {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  const graphemes = Array.from(segmenter.segment(value), ({ segment }) => segment);
  if (graphemes.length <= maximum) return value;
  return `${graphemes.slice(0, maximum - 1).join("").trim()}…`;
}
