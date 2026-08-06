# Hara World architecture

## Product boundary

Hara World is not a universal social-media dashboard. It is an editorial publication with an outbox.

```text
writers and feeds
       │
       ▼
source registry ──► generated article PRs
       │                    │
       │                    ▼
       └──────────────► editorial review
                            │ merge
                            ▼
                    canonical article
                            │
           ┌────────────────┼─────────────────┐
           ▼                ▼                 ▼
       RSS / JSON       newsletter        release bundle
                                                │
                         ┌───────────────┬──────┼──────────────┐
                         ▼               ▼      ▼              ▼
                      Bluesky         Mastodon YouTube   managed publisher
```

The canonical Markdown article is human-readable, diffable, portable, and independent of any distribution vendor.

## Four layers

### 1. Publication

Astro content collections render articles and expose RSS 2.0 and JSON Feed 1.1. The website carries provenance, labels, dates, corrections, licensing, and automation disclosures.

### 2. Intake

`registry/sources.json` records approved RSS/Atom sources. `scripts/sync-feeds.mjs`:

- accepts only reviewed active sources;
- rejects non-HTTPS and private-network destinations;
- limits redirects, response size, and request duration;
- normalises RSS and Atom entries;
- sanitises imported content into Markdown;
- writes deterministic article filenames and fingerprints;
- updates `registry/sync-state.json`;
- leaves publication to a draft PR and editorial merge.

The importer cannot infer permission. Rights live in the registry.

### 3. Release algebra

`scripts/build-release.mjs` maps one approved article into a release directory. The release manifest separates article facts from channel policy:

```json
{
  "article": { "id": "…", "url": "…", "canonicalUrl": "…" },
  "policy": {
    "buttondown": "draft",
    "youtube": "private",
    "managedSocial": "review"
  },
  "assets": {
    "newsletter": "newsletter.md",
    "social": "social.json",
    "storyboard": "storyboard.json"
  }
}
```

This is intentionally provider-independent. A new publisher consumes the release object instead of changing the content model.

### 4. Outbox

Each publisher is a small credentialed adapter. It receives a release bundle and returns a receipt. Credentials never enter article content or the static site build.

Direct adapters:

- Buttondown draft creation;
- Bluesky post creation;
- Mastodon status creation with an idempotency key;
- YouTube resumable upload through an OAuth refresh token.

Managed adapter:

- multipart webhook with the release manifest, platform projections, captions, and rendered video;
- suitable for a separately audited n8n, Buffer, custom worker, or platform-specific service;
- used where user confirmation, app review, media-container workflows, or policy requirements make blind cross-posting inappropriate.

## Video pipeline

The vertical-video path is deterministic:

1. article body is reduced to a short narration sequence;
2. a timed storyboard and SRT captions are generated;
3. `sharp` renders material Hara frames from SVG;
4. an optional TTS endpoint returns narration audio;
5. FFmpeg produces H.264/AAC `1080 × 1920` MP4;
6. YouTube receives a private upload for review by default.

This first version favours typography, diagrams, code, and product captures over generic stock footage. Later renderers can implement the same storyboard contract using Remotion, Blender, or a Hara-native media runtime.

## Trust model

- **Merge is approval.** Feed polling is not approval.
- **Publish is explicit.** Adapter scripts default to dry-run.
- **Closed networks are not the source of truth.** Public posts point back to the canonical article.
- **Receipts are data.** Platform identifiers and URLs are written as structured files and can later be signed into Hestia.
- **Automation is disclosed.** Generated copy, synthetic narration, and imported text are visible in article or release metadata.
- **Rights are revocable.** Pausing a source stops future intake; corrections and takedowns are handled in the canonical record.

## Future modules

The core should remain small. Likely add-ons are:

- GitHub OAuth submission UI backed by issues or pull requests;
- editorial queue and preview dashboard;
- digest composer for multi-article weekly editions;
- long-form Kernel Sessions renderer;
- analytics importer using platform receipts rather than tracking pixels in articles;
- Hestia-signed release manifests and publication receipts;
- multilingual projections with human review;
- podcast RSS generated from approved narration editions.
