import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getArticles, articlePath } from "../lib/articles";
import { SITE } from "../lib/site";

export const GET: APIRoute = async (context) => {
  const articles = await getArticles();
  const site = context.site ?? new URL("https://world.hara-lang.org");

  return rss({
    title: SITE.name,
    description: SITE.description,
    site,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    customData: `<language>en-au</language><atom:link href="${new URL("/feed.xml", site)}" rel="self" type="application/rss+xml" />`,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.publishedAt,
      link: articlePath(article),
      categories: article.data.topics,
      author: article.data.author,
      customData: article.data.canonicalUrl
        ? `<source url="${escapeXml(article.data.canonicalUrl)}">${escapeXml(article.data.sourceTitle ?? "Original publication")}</source>`
        : undefined
    }))
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
