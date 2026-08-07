import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const httpsUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Profile URLs must use HTTPS without embedded credentials.");

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

const profiles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/profiles" }),
  schema: z.object({
    githubId: z.coerce.string().regex(/^\d+$/),
    githubLogin: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
    displayName: z.string().min(1).max(100),
    summary: z.string().min(1).max(320),
    avatarUrl: httpsUrl.optional(),
    website: httpsUrl.optional(),
    location: z.string().max(100).optional(),
    interests: z.array(z.string().min(1).max(40)).max(12).default([]),
    roles: z.array(z.string().min(1).max(80)).max(24).default([]),
    links: z.array(z.object({
      label: z.string().min(1).max(80),
      url: httpsUrl
    })).max(24).default([]),
    joinedAt: z.coerce.date(),
    published: z.boolean().default(false)
  })
});

export const collections = { articles, profiles };
