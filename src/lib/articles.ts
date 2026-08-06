import { getCollection, type CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">;

export async function getArticles(): Promise<Article[]> {
  const entries = await getCollection("articles", ({ data }) => !data.draft);
  return entries.sort((left, right) => right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf());
}

export function articlePath(article: Article): string {
  return `/articles/${article.id}`;
}

export function articleUrl(article: Article, site: URL): string {
  return new URL(articlePath(article), site).toString();
}
