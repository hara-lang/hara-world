import { createHash } from "node:crypto";

export const POST_TYPES = Object.freeze(["note", "question", "showcase", "release", "lesson"]);
export const POST_PROPOSAL_MARKER = "<!-- hara-world-post-proposal -->";

const POST_TYPE_SET = new Set(POST_TYPES);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function cleanText(value, maximum, { required = false, collapse = false } = {}) {
  let text = String(value ?? "").replace(/\0/g, "").trim();
  if (collapse) text = text.replace(/\s+/g, " ");
  if (required && !text) throw new Error("A required post field is missing.");
  if (text.length > maximum) throw new Error(`A post field exceeds ${maximum} characters.`);
  return text;
}

export function slugifyPostTitle(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function normalizeSlug(value, title) {
  const slug = cleanText(value || slugifyPostTitle(title), 64, { required: true }).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error("Post slug must contain lowercase letters, numbers, and single hyphens.");
  }
  return slug;
}

function normalizeTopic(value) {
  const topic = slugifyPostTitle(cleanText(value, 80, { collapse: true }));
  if (!topic || topic.length > 40) throw new Error("Topics must become 1–40 character kebab-case labels.");
  return topic;
}

function normalizeTopics(value) {
  const input = Array.isArray(value) ? value : String(value ?? "").split(",");
  const output = [];
  const seen = new Set();
  for (const entry of input) {
    if (!String(entry ?? "").trim()) continue;
    const topic = normalizeTopic(entry);
    if (seen.has(topic)) continue;
    seen.add(topic);
    output.push(topic);
    if (output.length > 8) throw new Error("A community post may contain at most eight topics.");
  }
  return output;
}

function assertSafeMarkdown(body) {
  if (/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*?)?>/i.test(body)) {
    throw new Error("Community posts cannot contain raw HTML.");
  }
  if (/\]\(\s*(?:javascript|data|vbscript):/i.test(body)) {
    throw new Error("Community post Markdown contains an unsafe link target.");
  }
  return body;
}

export function assertDraftId(value) {
  const id = String(value ?? "").toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error("A valid post draft ID is required.");
  return id;
}

export function assertPostIdentity(identity) {
  if (!identity || !/^\d+$/.test(String(identity.id ?? "")) || !GITHUB_LOGIN_PATTERN.test(String(identity.login ?? ""))) {
    throw new TypeError("A verified World GitHub identity is required.");
  }
  return {
    id: String(identity.id),
    login: String(identity.login),
    name: cleanText(identity.name || identity.login, 100, { required: true, collapse: true }),
  };
}

export function normalizePostDraft(input, existing = null) {
  const source = existing ? { ...existing, ...(input ?? {}) } : (input ?? {});
  const title = cleanText(source.title, 160, { required: true, collapse: true });
  const postType = cleanText(source.postType, 40, { required: true }).toLowerCase();
  if (!POST_TYPE_SET.has(postType)) {
    throw new Error(`Post type must be one of: ${POST_TYPES.join(", ")}.`);
  }
  const body = assertSafeMarkdown(cleanText(source.body, 50_000, { required: true }));
  return {
    slug: normalizeSlug(source.slug, title),
    postType,
    title,
    description: cleanText(source.description, 320, { required: true, collapse: true }),
    body,
    topics: normalizeTopics(source.topics),
  };
}

export function postContentSha256(post) {
  const normalized = normalizePostDraft(post);
  const canonical = JSON.stringify({
    slug: normalized.slug,
    postType: normalized.postType,
    title: normalized.title,
    description: normalized.description,
    topics: normalized.topics,
    body: normalized.body,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function postProposalBranch(identity, draftId) {
  const author = assertPostIdentity(identity);
  const shortId = assertDraftId(draftId).replace(/-/g, "").slice(0, 16);
  return `post/github-${author.id}/${shortId}`;
}

export function postProposalPath(identity, draft, submittedAt) {
  const author = assertPostIdentity(identity);
  const post = normalizePostDraft(draft);
  const date = new Date(submittedAt);
  if (!Number.isFinite(date.valueOf())) throw new Error("A valid submission time is required.");
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `content/articles/community/${year}/${month}/${author.id}-${post.slug}.md`;
}

function scalar(value) {
  if (Array.isArray(value) || typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function kindForPostType(postType) {
  return postType === "release" ? "release" : "dispatch";
}

export function buildPostDocument({ identity, draft, submittedAt }) {
  const author = assertPostIdentity(identity);
  const post = normalizePostDraft(draft);
  const date = new Date(submittedAt);
  if (!Number.isFinite(date.valueOf())) throw new Error("A valid submission time is required.");
  const frontmatter = {
    title: post.title,
    description: post.description,
    publishedAt: date.toISOString(),
    author: author.name,
    authorGithubId: author.id,
    authorGithubLogin: author.login,
    kind: kindForPostType(post.postType),
    postType: post.postType,
    topics: post.topics,
    draft: false,
    featured: false,
    generated: false,
    video: false,
    newsletter: true,
    social: false,
  };
  const ordered = [
    "title", "description", "publishedAt", "author", "authorGithubId", "authorGithubLogin",
    "kind", "postType", "topics", "draft", "featured", "generated", "video", "newsletter", "social",
  ];
  return [
    "---",
    ...ordered.map((key) => `${key}: ${scalar(frontmatter[key])}`),
    "---",
    "",
    post.body,
    "",
  ].join("\n");
}

export function postPullRequestBody({ identity, draft, draftId, contentSha256 }) {
  const author = assertPostIdentity(identity);
  const post = normalizePostDraft(draft);
  const id = assertDraftId(draftId);
  const fingerprint = String(contentSha256 ?? postContentSha256(post));
  return [
    POST_PROPOSAL_MARKER,
    `<!-- hara-world-post:draft:${id} -->`,
    `<!-- hara-world-author:github:${author.id} -->`,
    `<!-- hara-world-content-sha256:${fingerprint} -->`,
    "## Hara World community post proposal",
    "",
    `Prepared from the authenticated World session for \`github:${author.id}\` (\`@${author.login}\`).`,
    "",
    `- Type: \`${post.postType}\``,
    `- Topics: ${post.topics.length ? post.topics.map((topic) => `\`${topic}\``).join(", ") : "none"}`,
    "- The stable GitHub identity and current login came from Hara Identity, not from editable form fields.",
    "- The submitted Markdown is rendered through the community-content safety allowlist.",
    "- This branch is reusable: resubmitting the same private draft updates this proposal instead of opening PR spam.",
    "- Merge remains the publication event; the proposal does not write directly to `main`.",
  ].join("\n");
}
