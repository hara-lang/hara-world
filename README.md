# Hara Learn

**Hara Learn** is the community, syndication, and distribution layer for the Hara Lisp ecosystem. It combines an Astro publication, first-party community submission forms, Git-reviewed people and agent records, permissioned Discord and RSS/Atom intake, a Neon-backed mailing-list and identity ledger, newsletter generation, automated short-video production, and review-first social publishing.

The governing idea is simple:

> One canonical record. Many labelled projections.

An approved post may produce a website page, RSS and JSON Feed entries, newsletter Markdown, platform-specific copy, a narration script, captions, a vertical storyboard, and a private YouTube upload. Profiles, agent registrations, source registrations, and automated intake are likewise reviewable Git records.

## What ships in the first release

- Static Astro site for `learn.hara-lang.org`, using `@hara-lang/visual-language`.
- Original community posts, releases, field notes, and labelled syndicated articles.
- RSS 2.0 and JSON Feed 1.1.
- First-party forms for posts, profiles, agents, publication feeds, and newsletter signup.
- Public contributor profiles keyed by stable numeric GitHub identity.
- Public human-owned agent registrations with a separate machine-verification boundary.
- Central GitHub sign-in through Hara Identity, followed by an audience-bound Learn session for authenticated proposals.
- GitHub App-backed proposal branches and draft pull requests rather than direct writes to the publication branch.
- Public source and Discord-channel registries with explicit review boundaries.
- Scheduled feed and Discord-pin importers that open draft pull requests rather than publishing unchecked content.
- Neon consent, subscriber-lifecycle, community-account, one-time handoff, koan-progress, and private community-post draft ledgers.
- Provider-independent release bundles.
- Deterministic `1080 × 1920` short-video rendering with captions and optional TTS audio.
- Buttondown draft, Bluesky, Mastodon, private YouTube upload, and managed-publisher webhook adapters.
- GitHub Actions for validation, intake, proposal scope, release generation, and protected publishing.

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

`npm run check` validates source, profile, and agent registries, runs the Node test suite, builds the brand asset, and performs a complete Astro production build.

## Community identity and first-party forms

GitHub OAuth is owned only by `id.hara-lang.org`. Learn creates random state and an S256 PKCE verifier, receives a one-time code at its exact callback, exchanges it server-to-server, records the handoff ID in Neon, and signs a separate two-hour host-only session.

The primary community forms remain on Hara Learn:

```text
/post             native community posts
/me               public contributor profile
/agents/register  human-owned agent registration
/submit            RSS or Atom source registration
```

The server supplies stable GitHub identity fields from the verified session. User-editable fields are converted into deterministic records on dedicated Git branches, and a narrowly scoped GitHub App opens or updates reusable draft pull requests. The browser cannot choose identity, reviewed authority, proposal branches, or pull-request metadata. Merge remains the publication or registration event.

Apply the database migrations and configure the variables documented in [docs/community-identity.md](./docs/community-identity.md) before enabling authenticated flows. GitHub identity is not automatically linked to newsletter email consent, package-publishing authority, agent runtime authority, or source activation.

See [docs/community-posts.md](./docs/community-posts.md), [docs/agents.md](./docs/agents.md), and [docs/source-submissions.md](./docs/source-submissions.md) for the individual trust boundaries.

## Mailing list

Hara Learn owns the consent and lifecycle record in Neon while Buttondown performs double opt-in confirmation, email delivery, unsubscribes, and subscriber self-service.

Apply the database migration with the pooled connection string from the Neon `neondb` Connect dialog:

```bash
DATABASE_URL='postgresql://…' npm run database:migrate
```

The public form posts to `/api/newsletter/subscribe`. A signed Buttondown webhook at `/api/newsletter/buttondown` then reconciles confirmation, unsubscription, suppression, and deletion back into Neon. Configure these Netlify environment variables before enabling the form in production:

```text
DATABASE_URL
BUTTONDOWN_API_KEY
BUTTONDOWN_WEBHOOK_SECRET
HARA_LEARN_SITE=https://learn.hara-lang.org
PUBLIC_HARA_LEARN_MANAGE_SUBSCRIPTION_URL=https://buttondown.com/login?subscriber=1
```

Export only active subscribers as CSV:

```bash
DATABASE_URL='postgresql://…' npm run newsletter:export > subscribers.csv
```

See [docs/mailing-list.md](./docs/mailing-list.md) for setup, webhook, privacy, and launch checks.

## Add a community post

Use `/post` after establishing a Learn session. Private draft state is stored in Neon. Submission asks the GitHub App to create or update a deterministic Markdown proposal under `content/articles/community/`; merge publishes the post to the website and public feeds.

Maintainers may still add reviewed Markdown directly below `content/articles/`:

```md
---
title: "A precise title"
description: "A one-sentence description."
publishedAt: 2026-08-17T10:00:00+10:00
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

Use the first-party form at `/submit`. It safely probes the RSS or Atom feed, attaches the verified registrant identity, and asks the Hara Learn GitHub App to prepare one reusable draft pull request. The browser does not write an issue or edit GitHub fields directly.

A source is not activated until its owner or authorised representative supplies and reviewers verify:

- a stable HTTPS homepage and RSS/Atom URL;
- a public HTTPS contact path for corrections or revocation;
- a relevance statement and stable topic set;
- a syndication mode: `link`, `excerpt`, or `full`;
- a permission basis: `owner`, `authorised`, or `open-licence`;
- an explicit licence when open licensing or full-text republication depends on one.

New form submissions enter with `status: proposed`. Merge records the proposal; activation remains a separate reviewed status change.

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

The bundle appears under `.hara-learn/releases/<article-id>/` and includes:

- `manifest.json` — canonical metadata, policies, channel state, and asset paths;
- `newsletter.md` — provider-independent Markdown;
- `social.json` — Bluesky, Mastodon, X, LinkedIn, Instagram, and TikTok projections;
- `storyboard.json` — timed vertical-video scenes;
- `narration.txt` and `captions.srt`;
- `youtube.json` — upload metadata.

Render the video:

```bash
npm run video:render -- \
  --release=.hara-learn/releases/2026-08-06-a-publication-for-the-programmable-world
```

Without a narration provider, the render contains a silent audio track and fully legible on-screen copy. Set `HARA_LEARN_TTS_ENDPOINT` to a service that accepts `{ text, voice, format, releaseId }` and returns MP3 bytes, or pass `--audio=/path/to/narration.mp3`.

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

Run all database migrations before accepting signups or private community-post drafts. Store database, handoff, session, GitHub App, webhook, and publisher credentials as encrypted Netlify or protected GitHub Actions environment variables. They must not be committed to source control.

The source, profile, and agent proposal forms reuse the existing Learn session and GitHub App and do not require an additional database migration.

## Licence

Code is available under the [MIT License](./LICENSE). Article, profile, agent, and syndicated-source licensing remains distinct from the software licence.
