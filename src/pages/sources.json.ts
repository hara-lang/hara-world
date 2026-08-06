import type { APIRoute } from "astro";
import { sourceRegistry } from "../lib/sources";

export const GET: APIRoute = async () => {
  const sources = sourceRegistry.sources.map(({ contact: _contact, ...source }) => source);
  return new Response(JSON.stringify({
    version: sourceRegistry.version,
    generatedAt: new Date().toISOString(),
    sources
  }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    }
  });
};
