const ALLOWED_TAGS = new Set([
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "kbd", "li", "ol", "p", "pre", "span", "strong", "sub", "sup", "table", "tbody",
  "td", "th", "thead", "tr", "ul",
]);

function documentPaths(file) {
  return [file?.path, ...(Array.isArray(file?.history) ? file.history : [])]
    .filter(Boolean)
    .map(String);
}

export function isCommunityDocument(file) {
  const paths = documentPaths(file);
  if (paths.some((value) => /(?:^|[\\/])content[\\/]profiles[\\/][^\\/]+\.md$/i.test(value))) return true;
  if (paths.some((value) => /(?:^|[\\/])content[\\/]articles[\\/]community[\\/].+\.md$/i.test(value))) return true;
  const frontmatter = file?.data?.astro?.frontmatter ?? {};
  if (/^\d+$/.test(String(frontmatter.githubId ?? ""))) return true;
  return /^\d+$/.test(String(frontmatter.authorGithubId ?? "")) && typeof frontmatter.postType === "string";
}

function plainText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.value ?? "");
  if (node.type === "element" && node.tagName === "img") {
    const alt = String(node.properties?.alt ?? "").trim();
    return alt ? `[Image: ${alt}]` : "";
  }
  return Array.isArray(node.children) ? node.children.map(plainText).join("") : "";
}

function safeHref(value) {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const href = value.trim();
  if (href.startsWith("//")) return null;
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) {
    return { href, external: false };
  }
  try {
    const url = new URL(href);
    if (url.username || url.password || !["https:", "mailto:"].includes(url.protocol)) return null;
    const external = url.protocol === "https:" && ![
      "world.hara-lang.org",
      "world.testing.hara-lang.org",
    ].includes(url.hostname);
    return { href: url.toString(), external };
  } catch {
    return null;
  }
}

function sanitizeProperties(node) {
  const source = node.properties && typeof node.properties === "object" ? node.properties : {};
  const properties = {};
  if (node.tagName === "a") {
    const target = safeHref(source.href);
    if (!target) {
      node.tagName = "span";
      node.properties = {};
      return;
    }
    properties.href = target.href;
    if (typeof source.title === "string" && source.title.length <= 300) properties.title = source.title;
    if (target.external) properties.rel = ["nofollow", "ugc", "noopener", "noreferrer"];
  } else if (node.tagName === "code") {
    const classes = Array.isArray(source.className) ? source.className : [];
    const safeClasses = classes.filter((value) => /^language-[A-Za-z0-9_-]{1,64}$/.test(String(value)));
    if (safeClasses.length) properties.className = safeClasses;
  } else if (node.tagName === "ol" && Number.isSafeInteger(source.start)) {
    properties.start = source.start;
  } else if (["td", "th"].includes(node.tagName) && ["left", "center", "right"].includes(source.align)) {
    properties.align = source.align;
  }
  node.properties = properties;
}

function sanitizeChildren(children = []) {
  const output = [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    if (["comment", "doctype", "raw"].includes(child.type)) continue;
    if (child.type === "text") {
      output.push({ type: "text", value: String(child.value ?? "") });
      continue;
    }
    if (child.type !== "element") continue;
    if (child.tagName === "img") {
      const replacement = plainText(child);
      if (replacement) output.push({ type: "text", value: replacement });
      continue;
    }
    child.children = sanitizeChildren(child.children);
    if (!ALLOWED_TAGS.has(child.tagName)) {
      const replacement = plainText(child);
      if (replacement) output.push({ type: "text", value: replacement });
      continue;
    }
    sanitizeProperties(child);
    output.push(child);
  }
  return output;
}

export function sanitizeCommunityMarkdownTree(tree) {
  if (!tree || typeof tree !== "object") return tree;
  tree.children = sanitizeChildren(tree.children);
  return tree;
}

export default function safeCommunityMarkdown() {
  return (tree, file) => {
    if (isCommunityDocument(file)) sanitizeCommunityMarkdownTree(tree);
  };
}
