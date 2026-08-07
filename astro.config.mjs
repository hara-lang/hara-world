import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import safeCommunityMarkdown from "./src/lib/safe-community-markdown.mjs";

export default defineConfig({
  site: process.env.HARA_WORLD_SITE ?? "https://world.hara-lang.org",
  output: "static",
  trailingSlash: "never",
  build: { format: "directory" },
  markdown: { rehypePlugins: [safeCommunityMarkdown] },
  integrations: [sitemap()]
});
