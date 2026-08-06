# Hara World

**Hara World** is the publication, community, and distribution layer for the Hara Lisp ecosystem. It combines an Astro publication, Git-reviewed contributor profiles, permissioned Discord and RSS/Atom intake, a Neon-backed mailing-list and identity ledger, newsletter generation, automated short-video production, and review-first social publishing.

The governing idea is simple:

> One canonical record. Many labelled projections.

An approved article may produce a website page, RSS and JSON Feed entries, newsletter Markdown, platform-specific copy, a narration script, captions, a vertical storyboard, and a private YouTube upload. Profiles, source registrations, and automated intake are likewise reviewable Git records.

## What ships in the first release

- Static Astro site for `world.hara-lang.org`, using `@hara-lang/visual-language`.
- Original dispatches, releases, field notes, and labelled syndicated articles.
- RSS 2.0 and JSON Feed 1.1.
- Public contributor profiles keyed by stable numeric GitHub identity.
- Central GitHub sign-in through Hara Identity, followed by an audience-bound World session for authenticated profile proposals.
- GitHub App-backed profile changes that open draft pull requests rather than writing directly to the publication branch.
- Public source and Discord-channel registries with explicit review boundaries.
- Scheduled feed and Discord-pin importers that open draft pull requests rather than publishing unchecked content.
- Neon consent, subscriber-lifecycle, community-account, and one-time handoff ledgers.
- Provider-independent release bundles.
- Deterministic `1080 × 1920` short-video rendering with captions and optional TTS audio.
- Buttondown draft, Bluesky, Mastodon, private YouTube upload, and managed-publisher webhook adapters.
- GitHub Actions for validation, intake, release generation, and protected publishing.

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

## Community identity and profiles

GitHub OAuth is owned only by `id.hara-lang.org`. World creates random state and an S256 PKCE verifier, receives a one-time code at its exact callback, exchanges it server-to-server, records the handoff ID in Neon, and signs a separate two-hour host-only session.

Profile edits at `/me` use that verified session. User-editable fields are converted into deterministic Markdown on a dedicated Git branch, and a narrowly scoped GitHub App opens a draft pull request. Stable GitHub ID, current login, reviewed roles, and existing verified links cannot be supplied by the browser. Merge remains the publication event.

Apply the database migrations and configure the variables documented in [docs/community-identity.md](./docs/community-identity.md) before enabling the flow. GitHub identity is not automatically linked to newsletter email consent or package-publishing authority.

## Mailing list

Hara World owns the consent and lifecycle record in Neon while Buttondown performs double opt-in confirmation, email delivery, unsubscribes, and subscriber self-service.

Apply the database migration with the pooled connection string from the Neon `neondb` Connect dialog:

```bash
DATABASE_URL='postgresql://…' npm run database:migrate
```

The public form posts to `/api/newsletter/subscribe`. A signed Buttondown webhook at `/api/newsletter/buttondown` then reconciles confirmation, unsubscription, suppression, and deletion back into Neon. Configure these Netlify environment variables before enabling the form in production:

```text
DATABASE_URL
BUTTONDOWN_API_KEY
BUTTONDOWN_WEBHOOK_SECRET
HARA_WORLD_SITE=https://world.hara-lang.org
PUBLIC_HARA_WORLD_MANAGE_SUBSCRIPTION_URL=https://buttondown.com/login?subscriber=1
```

Export only active subscribers as CSV:

```bash
DATABASE_URL='postgresql://…' npm run newsletter:export > subscribers.csv
```

See [docs/mailing-list.md](./docs/mailing-list.md) for setup, webhook, privacy, and launch checks.

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

Fetch reviewed Discord pins locally with:

```bash
npm run discord:sync -- --dry-run
npm run discord:sync
```

The scheduled workflows write deterministic Markdown into reviewed intake branches and open draft PRs. Merge is the editorial approval event.

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

The site is an Astro static build with Netlify Functions:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
Node version: 24
```

Run all database migrations before accepting signups or authenticated profile proposals. Store database, handoff, session, GitHub App, webhook, and publisher credentials as encrypted Netlify or protected GitHub Actions environment variables. They must not be committed to source control.

## Licence

Code is available under the [MIT License](./LICENSE). Article and profile licensing is declared separately and remains distinct from the software licence.
