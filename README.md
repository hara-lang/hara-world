# Hara World

**Hara World** is the publication and distribution layer for the Hara Lisp community. It combines an Astro publication, a permissioned RSS/Atom source registry, newsletter generation, automated short-video production, and review-first social publishing.

The governing idea is simple:

> One canonical article. Many labelled projections.

An approved article may produce a website page, RSS and JSON Feed entries, newsletter Markdown, platform-specific copy, a narration script, captions, a vertical storyboard, and a private YouTube upload. The article remains the source of truth.

## What ships in the first release

- Static Astro site for `world.hara-lang.org`, using `@hara-lang/visual-language`.
- Original dispatches, releases, field notes, and labelled syndicated articles.
- RSS 2.0 and JSON Feed 1.1.
- Public source registry with explicit permission and syndication modes.
- Scheduled feed importer that opens a draft pull request rather than publishing unchecked content.
- Provider-independent release bundles.
- Deterministic `1080 × 1920` short-video rendering with captions and optional TTS audio.
- Buttondown draft, Bluesky, Mastodon, private YouTube upload, and managed-publisher webhook adapters.
- GitHub Actions for validation, feed intake, release generation, and protected publishing.

## Local development

Requirements: Node.js 24 and, for video rendering, FFmpeg.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run check
```

`npm run check` validates the source registry, runs the Node test suite, builds the brand asset, and performs a complete Astro production build.

## Add an article

Create a Markdown file below `content/articles/`:

```md
---
title: "A precise title"
description: "A one-sentence description."
publishedAt: 2026-08-06T10:00:00+10:00
author: "Your name"
kind: "dispatch"
topics: ["hara", "lisp"]
draft: false
featured: false
video: true
newsletter: true
social: true
---

Your article begins here.
```

Kinds are `dispatch`, `syndicated`, `release`, and `field-note`.

## Register a publication

Use the source-submission issue form or add an entry to `registry/sources.json`. A source is not activated until its owner or authorised representative supplies:

- a stable HTTPS homepage and RSS/Atom URL;
- a contact path for corrections or revocation;
- a syndication mode: `link`, `excerpt`, or `full`;
- a permission basis: `owner`, `authorised`, or `open-licence`;
- an explicit licence when open licensing or full-text republication depends on one.

Validate the registry with:

```bash
npm run sources:check
```

Fetch active sources locally with:

```bash
npm run feeds:sync -- --dry-run
npm run feeds:sync
```

The scheduled workflow writes deterministic Markdown into `content/articles/syndicated/` and opens a draft PR. Merge is the editorial approval event.

## Build a release bundle

```bash
npm run release:build -- \
  --article=2026-08-06-a-publication-for-the-programmable-world
```

The bundle appears under `.hara-world/releases/<article-id>/` and includes:

- `manifest.json` — canonical metadata, policies, channel state, and asset paths;
- `newsletter.md` — provider-independent Markdown;
- `social.json` — Bluesky, Mastodon, X, LinkedIn, Instagram, and TikTok projections;
- `storyboard.json` — timed vertical-video scenes;
- `narration.txt` and `captions.srt`;
- `youtube.json` — upload metadata.

Render the video:

```bash
npm run video:render -- \
  --release=.hara-world/releases/2026-08-06-a-publication-for-the-programmable-world
```

Without a narration provider, the render contains a silent audio track and fully legible on-screen copy. Set `HARA_WORLD_TTS_ENDPOINT` to a service that accepts `{ text, voice, format, releaseId }` and returns MP3 bytes, or pass `--audio=/path/to/narration.mp3`.

## Publish adapters

Every adapter is a dry run unless `--publish` is supplied.

```bash
npm run publish:buttondown -- --release=<release-directory>
npm run publish:bluesky -- --release=<release-directory>
npm run publish:mastodon -- --release=<release-directory>
npm run publish:youtube -- --release=<release-directory>
npm run publish:webhook -- --release=<release-directory>
```

With `--publish`:

- Buttondown creates a **draft** email.
- YouTube uploads with `YOUTUBE_PRIVACY_STATUS=private` by default.
- Bluesky and Mastodon publish the reviewed projection.
- The webhook sends a review package to a managed publisher for platforms whose APIs or policies need a separate integration.

Receipts are written below `<release-directory>/receipts/`.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [EDITORIAL.md](./EDITORIAL.md), and [docs/operations.md](./docs/operations.md) before enabling production publishing.

## Deployment

The site is a static Astro build and is ready for Netlify:

```text
Build command: npm run build
Publish directory: dist
Node version: 24
```

Set `PUBLIC_HARA_WORLD_NEWSLETTER_URL` after the mailing-list landing page exists. Keep all publisher credentials in a protected GitHub Actions environment named `hara-world-publishing`; they are not required by the website build.

## Licence

Code is available under the [MIT License](./LICENSE). Article licensing is declared per article and remains distinct from the software licence.
