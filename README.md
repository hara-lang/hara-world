# Hara World

**Hara World** is the publication, community, and distribution layer for the Hara Lisp ecosystem. It combines an Astro publication, Git-reviewed contributor profiles, reviewed Discord and RSS/Atom intake, a Neon-backed consent and identity ledger, newsletter generation, automated short-video production, and review-first social publishing.

The governing idea is simple:

> One canonical record. Many labelled projections.

An approved article may produce a website page, RSS and JSON Feed entries, newsletter Markdown, platform-specific copy, a narration script, captions, a vertical storyboard, and a private YouTube upload. Profiles, source registrations, and automated intake are likewise reviewable Git records.

## What ships

- Static Astro site for `world.hara-lang.org`, using `@hara-lang/visual-language`.
- Original dispatches, releases, field notes, and labelled syndicated articles.
- RSS 2.0 and JSON Feed 1.1.
- Public contributor profiles keyed by stable numeric GitHub identity.
- Central GitHub sign-in through Hara Identity, followed by an audience-bound World session for authenticated writes.
- GitHub App-backed profile proposals that open draft pull requests rather than writing directly to the publication branch.
- Public source and Discord-channel registries with explicit review boundaries.
- Scheduled feed and Discord-pin importers that open draft pull requests.
- Neon consent, subscriber-lifecycle, community-account, and one-time handoff ledgers.
- Provider-independent release bundles and deterministic vertical-video rendering.
- Buttondown draft, Bluesky, Mastodon, private YouTube upload, and managed-publisher webhook adapters.

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

## Community identity and profiles

GitHub OAuth is owned only by `id.hara-lang.org`. World creates random state and an S256 PKCE verifier, receives a one-time code at its exact callback, exchanges it server-to-server, records the handoff ID in Neon, and signs a separate two-hour host-only session.

Profile edits at `/me` use that verified session. User-editable fields are converted into deterministic Markdown on a dedicated Git branch, and a narrowly scoped GitHub App opens a draft pull request. Stable GitHub ID, current login, reviewed roles, and existing verified links cannot be supplied by the browser. Merge remains the publication event.

Apply the database migrations and configure the variables documented in [docs/community-identity.md](./docs/community-identity.md) before enabling the flow.

## Mailing list

Hara World owns the consent and lifecycle record in Neon while Buttondown performs double opt-in confirmation, email delivery, unsubscribes, and subscriber self-service.

```bash
DATABASE_URL='postgresql://…' npm run database:migrate
```

The public form posts to `/api/newsletter/subscribe`; a signed Buttondown webhook at `/api/newsletter/buttondown` reconciles provider state. Newsletter email consent is not automatically linked to a GitHub identity.

See [docs/mailing-list.md](./docs/mailing-list.md).

## Content and intake

Add canonical articles below `content/articles/`. Register external publications through the source-submission issue form or `registry/sources.json`. Reviewed Discord channels live in `registry/discord-channels.json`. Both automated importers create draft pull requests; polling or pinning is never itself publication approval.

```bash
npm run sources:check
npm run feeds:sync -- --dry-run
npm run discord:sync -- --dry-run
```

## Build and distribute a release

```bash
npm run release:build -- --article=<article-id>
npm run video:render -- --release=.hara-world/releases/<article-id>
```

Publisher adapters remain dry-run unless `--publish` is supplied:

```bash
npm run publish:buttondown -- --release=<release-directory>
npm run publish:bluesky -- --release=<release-directory>
npm run publish:mastodon -- --release=<release-directory>
npm run publish:youtube -- --release=<release-directory>
npm run publish:webhook -- --release=<release-directory>
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [EDITORIAL.md](./EDITORIAL.md), and [docs/operations.md](./docs/operations.md).

## Deployment

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
Node version: 24
```

Run all migrations before enabling signups or authenticated profile proposals. Store database, handoff, session, GitHub App, webhook, and publisher credentials only as encrypted Netlify variables or protected GitHub Actions secrets.

## Licence

Code is available under the [MIT License](./LICENSE). Article and profile licensing remains distinct from the software licence.
