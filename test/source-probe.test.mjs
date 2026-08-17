import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicHttpsUrl,
  fetchPublicFeed,
  isPrivateAddress,
  parseFeedPreview,
  probeFeed,
  readLimitedBody,
} from "../netlify/functions/_shared/feed-probe.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("classifies private, loopback, documentation, and public addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "::1", "fc00::1", "2001:db8::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
  assert.equal(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
});

test("accepts only credential-free public HTTPS feed targets", async () => {
  assert.equal((await assertPublicHttpsUrl("https://example.com/feed.xml", { lookupImpl: publicLookup })).hostname, "example.com");
  await assert.rejects(() => assertPublicHttpsUrl("http://example.com/feed.xml", { lookupImpl: publicLookup }), /HTTPS/);
  await assert.rejects(() => assertPublicHttpsUrl("https://user:secret@example.com/feed.xml", { lookupImpl: publicLookup }), /credentials/);
  await assert.rejects(() => assertPublicHttpsUrl("https://localhost/feed.xml", { lookupImpl: publicLookup }), /public Internet host/);
  await assert.rejects(() => assertPublicHttpsUrl("https://private.example/feed.xml", {
    lookupImpl: async () => [{ address: "10.0.0.8", family: 4 }],
  }), /private or reserved/);
});

test("revalidates every redirect before issuing the next request", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private.xml" } });
  };
  await assert.rejects(() => fetchPublicFeed("https://example.com/feed.xml", {
    fetchImpl,
    lookupImpl: publicLookup,
  }), /private or reserved/);
  assert.equal(requests, 1);
});

test("caps feed response bytes even when content length is absent", async () => {
  const response = new Response("x".repeat(64));
  await assert.rejects(() => readLimitedBody(response, 16), /exceeds 16 bytes/);
});

test("parses RSS and Atom metadata without processing active content", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Hara Notes</title><link>https://example.com/</link><language>en-AU</language><item><title>First post</title><link>https://example.com/first</link><pubDate>Mon, 17 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Hara Atom</title><link rel="alternate" href="https://example.com/"/><entry><title>Entry</title><link href="https://example.com/entry"/><updated>2026-08-17T00:00:00Z</updated></entry></feed>`;
  const rssPreview = parseFeedPreview(rss, { finalUrl: "https://example.com/feed.xml" });
  const atomPreview = parseFeedPreview(atom, { finalUrl: "https://example.com/atom.xml" });
  assert.equal(rssPreview.format, "rss");
  assert.equal(rssPreview.title, "Hara Notes");
  assert.equal(rssPreview.entries[0].url, "https://example.com/first");
  assert.equal(atomPreview.format, "atom");
  assert.equal(atomPreview.homepage, "https://example.com/");
  assert.equal(atomPreview.entries[0].title, "Entry");
  assert.throws(() => parseFeedPreview("<html><body>Not a feed</body></html>"), /neither an RSS channel nor an Atom feed/);
});

test("returns the final canonical URL and parsed preview from one safe probe", async () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Redirected</title><link>https://example.com/</link></channel></rss>`;
  const result = await probeFeed("https://example.com/feed", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/rss+xml" },
    }),
  });
  assert.equal(result.finalUrl, "https://example.com/feed");
  assert.equal(result.title, "Redirected");
  assert.equal(result.format, "rss");
});
