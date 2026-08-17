import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const DEFAULT_ACCEPT = "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: false,
  trimValues: true,
});

export function isPrivateAddress(address) {
  const input = String(address ?? "").toLowerCase();
  if (input.includes(":")) {
    if (input.startsWith("::ffff:")) return isPrivateAddress(input.slice(7));
    return input === "::1"
      || input === "::"
      || input.startsWith("fc")
      || input.startsWith("fd")
      || input.startsWith("fe8")
      || input.startsWith("fe9")
      || input.startsWith("fea")
      || input.startsWith("feb")
      || input.startsWith("ff")
      || input.startsWith("2001:db8");
  }
  const parts = input.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224
    || (a === 192 && b === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0);
}

export async function assertPublicHttpsUrl(value, { lookupImpl = dnsLookup } = {}) {
  let url;
  try { url = value instanceof URL ? new URL(value) : new URL(String(value)); }
  catch { throw new Error("Feed URL must be an absolute HTTPS URL."); }
  if (url.toString().length > 2048) throw new Error("Feed URL is too long.");
  if (url.protocol !== "https:") throw new Error("Feed URL must use HTTPS.");
  if (url.username || url.password) throw new Error("Feed URL must not contain embedded credentials.");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Feed host must be a public Internet host.");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookupImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("Feed host did not resolve to an address.");
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Feed host resolves to a private or reserved address.");
  }
  return url;
}

export async function readLimitedBody(response, maximumBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error(`Feed response exceeds ${maximumBytes} bytes.`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumBytes) throw new Error(`Feed response exceeds ${maximumBytes} bytes.`);
    return text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`Feed response exceeds ${maximumBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPublicFeed(initialUrl, {
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
  timeoutMs = 15_000,
  maximumBytes = 2 * 1024 * 1024,
  maximumRedirects = 5,
} = {}) {
  let current = await assertPublicHttpsUrl(initialUrl, { lookupImpl });
  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: DEFAULT_ACCEPT,
        "user-agent": "HaraWorldFeedProbe/0.1 (+https://world.hara-lang.org/about)",
      },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirect === maximumRedirects) throw new Error("Feed has too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Feed redirect did not provide a Location header.");
      current = await assertPublicHttpsUrl(new URL(location, current), { lookupImpl });
      continue;
    }
    if (!response.ok) throw new Error(`Feed request failed with HTTP ${response.status}.`);
    const xml = await readLimitedBody(response, maximumBytes);
    return { xml, finalUrl: current.toString(), contentType: response.headers.get("content-type") ?? "" };
  }
  throw new Error("Feed has too many redirects.");
}

export function parseFeedPreview(xml, { finalUrl = "" } = {}) {
  const source = String(xml ?? "").trim();
  if (!source) throw new Error("Feed response was empty.");
  const validity = XMLValidator.validate(source, { allowBooleanAttributes: true });
  if (validity !== true) throw new Error("Feed response is not valid XML.");
  const parsed = parser.parse(source);
  const rss = parsed?.rss?.channel;
  const atom = parsed?.feed;
  const channel = rss ?? atom;
  if (!channel) throw new Error("XML is neither an RSS channel nor an Atom feed.");
  const format = rss ? "rss" : "atom";
  const rawItems = rss ? channel.item : channel.entry;
  const entries = arrayify(rawItems).slice(0, 5).map((item) => ({
    title: text(item?.title),
    url: linkValue(item?.link),
    publishedAt: text(item?.pubDate ?? item?.published ?? item?.updated ?? item?.["dc:date"]),
    author: authorValue(item?.author ?? item?.["dc:creator"]),
  })).filter((item) => item.title || item.url);
  const homepage = linkValue(rss?.link ?? atom?.link);
  return {
    format,
    title: text(channel.title),
    homepage: normalisePublicLink(homepage, finalUrl),
    language: text(channel.language ?? channel["dc:language"]),
    author: authorValue(channel.author ?? channel.managingEditor ?? channel.webMaster),
    entryCount: arrayify(rawItems).length,
    entries: entries.map((entry) => ({
      ...entry,
      url: normalisePublicLink(entry.url, homepage || finalUrl),
    })),
  };
}

export async function probeFeed(feedUrl, options = {}) {
  const fetched = await fetchPublicFeed(feedUrl, options);
  return {
    requestedUrl: String(feedUrl),
    finalUrl: fetched.finalUrl,
    contentType: fetched.contentType,
    ...parseFeedPreview(fetched.xml, { finalUrl: fetched.finalUrl }),
  };
}

function normalisePublicLink(value, base) {
  if (!value) return "";
  try {
    const url = new URL(value, base || undefined);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function arrayify(value) {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text(value["#text"] ?? value.name ?? value.href ?? value["@_href"]);
  return "";
}

function linkValue(value) {
  const links = arrayify(value);
  const alternate = links.find((link) => typeof link === "object" && (!link["@_rel"] || link["@_rel"] === "alternate"));
  return text(alternate ?? links[0]);
}

function authorValue(value) {
  return text(value?.name ?? value);
}
