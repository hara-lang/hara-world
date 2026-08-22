import type { APIRoute } from "astro";
import { getArticles, articlePath } from "../lib/articles";
import { SITE } from "../lib/site";

export const GET: APIRoute = async (context) => {
  const articles = await getArticles();
  const site = context.site ?? new URL("https://learn.hara-lang.org");
  const feedUrl = new URL("/feed.json", site).toString();

  return new Response(JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: SITE.name,
    home_page_url: site.toString(),
    feed_url: feedUrl,
    description: SITE.description,
    language: "en-AU",
    authors: [{ name: "Hara Learn", url: site.toString() }],
    items: articles.map((article) => {
      const url = new URL(articlePath(article), site).toString();
      return {
        id: url,
        url,
        external_url: article.data.canonicalUrl,
        title: article.data.title,
        summary: article.data.description,
        content_text: article.data.description,
        date_published: article.data.publishedAt.toISOString(),
        date_modified: article.data.updatedAt?.toISOString(),
        authors: [{ name: article.data.author }],
        tags: article.data.topics,
        _hara_world: {
          kind: article.data.kind,
          source_id: article.data.sourceId,
          generated: article.data.generated
        }
      };
    })
  }, null, 2), {
    headers: {
      "content-type": "application/feed+json; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    }
  });
};
