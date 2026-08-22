import type { APIRoute } from "astro";
import { sourceRegistry } from "../lib/sources";

export const GET: APIRoute = async () => {
  const outlines = sourceRegistry.sources
    .filter((source) => source.status === "active")
    .map((source) => `    <outline type="rss" text="${escapeXml(source.name)}" title="${escapeXml(source.name)}" htmlUrl="${escapeXml(source.homepage)}" xmlUrl="${escapeXml(source.feed)}" />`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Hara Learn sources</title></head>\n  <body>\n${outlines}\n  </body>\n</opml>\n`;
  return new Response(body, {
    headers: {
      "content-type": "text/x-opml; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    }
  });
};

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
  })[character] ?? character);
}
