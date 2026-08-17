import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const httpsUrl = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Community URLs must use HTTPS without embedded credentials.");

const githubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/);
const agentLabel = z.string().min(1).max(60);
const agentInterface = z.enum(["web", "chat", "cli", "repl", "api", "mcp", "email", "discord", "other"]);

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/articles" }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: z.string().min(1),
    authorGithubId: z.coerce.string().regex(/^\d+$/).optional(),
    authorGithubLogin: githubLogin.optional(),
    kind: z.enum(["dispatch", "syndicated", "release", "field-note"]).default("dispatch"),
    postType: z.enum(["note", "question", "showcase", "release", "lesson"]).optional(),
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
  }).superRefine((article, context) => {
    const hasId = Boolean(article.authorGithubId);
    const hasLogin = Boolean(article.authorGithubLogin);
    if (hasId !== hasLogin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Native community posts must provide both authorGithubId and authorGithubLogin.",
      });
    }
    if (article.postType && !hasId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A typed community post must carry its server-verified GitHub author identity.",
      });
    }
  })
});

const profiles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/profiles" }),
  schema: z.object({
    githubId: z.coerce.string().regex(/^\d+$/),
    githubLogin,
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

const agents = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/agents" }),
  schema: z.object({
    agentId: z.string().regex(/^agent:github:\d+:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/),
    operatorGithubId: z.coerce.string().regex(/^\d+$/),
    operatorGithubLogin: githubLogin,
    operatorDisplayName: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    summary: z.string().min(1).max(320),
    status: z.enum(["experimental", "active", "paused", "retired"]).default("experimental"),
    availability: z.enum(["public", "request", "private", "local"]).default("private"),
    operationMode: z.enum(["interactive", "supervised", "scheduled", "autonomous"]).default("supervised"),
    capabilities: z.array(agentLabel).max(12).default([]),
    interfaces: z.array(agentInterface).max(9).default([]),
    haraPackages: z.array(z.string().min(1).max(120).regex(/^[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,119})$/)).max(16).default([]),
    runtime: z.string().min(1).max(160).optional(),
    website: httpsUrl.optional(),
    source: httpsUrl.optional(),
    documentation: httpsUrl.optional(),
    verification: z.enum(["operator-claimed", "key-verified"]).default("operator-claimed"),
    keyFingerprint: z.string().min(8).max(240).optional(),
    attestations: z.array(z.object({
      label: z.string().min(1).max(80),
      url: httpsUrl
    })).max(24).default([]),
    registeredAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    published: z.boolean().default(false)
  }).superRefine((agent, context) => {
    if (agent.verification === "key-verified" && !agent.keyFingerprint) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Key-verified agents must carry a reviewed public-key fingerprint.",
      });
    }
  })
});

export const collections = { articles, profiles, agents };
