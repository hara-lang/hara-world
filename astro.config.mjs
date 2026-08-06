import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: process.env.HARA_WORLD_SITE ?? "https://world.hara-lang.org",
  output: "static",
  trailingSlash: "never",
  build: {
    format: "directory"
  },
  integrations: [sitemap()]
});
