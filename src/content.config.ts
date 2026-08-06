import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/articles" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: z.string().min(1),
    kind: z.enum(["dispatch", "syndicated", "release", "field-note"]).default("dispatch"),
    topics: z.array(z.string()).default([]),
    canonicalUrl: z.string().url().optional(),
    sourceId: z.string().optional(),
    sourceTitle: z.string().optional(),
    license: z.string().optional(),
    disclosure: z.string().optional(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    generated: z.boolean().default(false),
    video: z.boolean().default(false),
    newsletter: z.boolean().default(true),
    social: z.boolean().default(true)
  })
});

export const collections = { articles };
