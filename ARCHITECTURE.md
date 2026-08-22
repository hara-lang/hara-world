# Hara Learn architecture

## Product boundary

Hara Learn is the community and syndication layer for the Hara ecosystem.

People may publish native community posts, maintain reviewed public profiles, work through shared lessons, or connect an RSS/Atom publication they already control. The public homepage is a chronological community stream that mixes those native and syndicated posts with clear provenance.

Hara Learn is not a closed social network and does not require writers to surrender their own sites. Canonical ownership stays with the author: a native Learn post has a portable Markdown record, while a syndicated post points back to its canonical URL. Review protects attribution, relevance, permissions, and the shared feed; it is not meant to turn the community into a single editorial voice.

```text
people ──────────────► private drafts ─► native post PRs ─┐
  │                                                        │
  ├──────────────────► public profiles                     ├──► community stream
  │                                                        │          │
own sites ───────────► RSS / Atom intake PRs ─────────────┘          │
                                                                   ▼
                                                      web / RSS / JSON / OPML
                                                                   │
                                                 ┌─────────────────┴──────────────┐
                                                 ▼                                ▼
                                           weekly digest                    release outbox
```

The community stream, people directory, and learning surfaces are the product centre. Newsletter, video, and social projections are downstream distribution mechanisms rather than the identity of the site.

## Public and private planes

Hara Learn deliberately separates mutable workflow state from the public community record.

### Private transactional plane

Neon stores:

- server-verified community accounts and one-time identity handoffs;
- private native-post drafts;
- post proposal state and append-only lifecycle events;
- koan progress;
- mailing-list consent and provider reconciliation.

Private draft rows are never used as the public feed source. A database outage may block new drafts, but it cannot remove already published posts.

### Public portable plane

Git stores:

- merged native and syndicated Markdown posts;
- public profile records;
- source registrations and sync state;
- review history, corrections, and provenance.

Astro builds the website, RSS, JSON Feed, and people directory only from reviewed Git content. Merge remains the publication event.

## Four layers

### 1. Community publication

Astro content collections render native and syndicated posts, public profiles, and lessons. Posts expose RSS 2.0 and JSON Feed 1.1; registered sources are also available as OPML. The website carries provenance, labels, dates, corrections, licensing, and automation disclosures.

Native posts and profiles are portable Git-reviewed records. Syndicated entries preserve their source identity and canonical URL. The homepage presents all approved posts through one chronological community feed.

Native typed posts carry a stable numeric GitHub author ID and the current reviewed GitHub login. Those fields come from Hara Identity through a Learn-local session, not from editable browser fields.

### 2. Intake

#### Native posts

The `/post` composer writes private drafts to Neon. Submitting a draft:

- validates and normalises its post type, title, description, topics, slug, and Markdown;
- derives author identity from the verified Learn session;
- creates deterministic Markdown under `content/articles/community/`;
- resets or creates one stable per-draft proposal branch;
- opens or updates one draft pull request through the narrowly scoped GitHub App;
- records the proposal result in Neon when possible;
- leaves publication to review and merge.

The browser cannot choose the author identity, proposal branch, publication path, reviewed authority, or pull-request metadata. Native community Markdown is rendered through a constrained allowlist that removes active content, embeds, remote images, unsafe URLs, and arbitrary properties.

#### Syndicated feeds

`registry/sources.json` records approved RSS/Atom sources. `scripts/sync-feeds.mjs`:

- accepts only reviewed active sources;
- rejects non-HTTPS and private-network destinations;
- limits redirects, response size, and request duration;
- normalises RSS and Atom entries;
- sanitises imported content into Markdown;
- writes deterministic article filenames and fingerprints;
- updates `registry/sync-state.json`;
- leaves inclusion in the community feed to a draft PR and review.

The importer cannot infer permission. Rights live in the registry.

Profiles follow the same reviewable Git model and are keyed by stable GitHub identity. Profile records and native posts do not grant package, specification, repository, or editorial authority.

### 3. Release algebra

`scripts/build-release.mjs` maps one approved post into a release directory. The release manifest separates article facts from channel policy:

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

Each publisher is a small credentialed adapter. It receives a release bundle and returns a receipt. Credentials never enter post content or the static site build.

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

1. post body is reduced to a short narration sequence;
2. a timed storyboard and SRT captions are generated;
3. `sharp` renders material Hara frames from SVG;
4. an optional TTS endpoint returns narration audio;
5. FFmpeg produces H.264/AAC `1080 × 1920` MP4;
6. YouTube receives a private upload for review by default.

This first version favours typography, diagrams, code, and product captures over generic stock footage. Later renderers can implement the same storyboard contract using Remotion, Blender, or a Hara-native media runtime.

## Trust model

- **Merge is approval.** Draft saving, form submission, feed polling, and PR creation are not publication.
- **Private state is not the public source.** Neon drafts and proposal rows cannot appear in the community feed until reviewed Markdown is merged.
- **Identity is server supplied.** Stable GitHub subjects come from Hara Identity and a Learn-local session, never editable post fields.
- **Canonical ownership is visible.** Native posts retain their reviewed author identity; syndicated posts retain attribution and point back to the author’s site.
- **Proposal branches are reusable.** Resubmission updates one draft PR instead of creating review spam.
- **Git wins after submission.** If GitHub accepts a proposal but Neon state recording fails, the GitHub URL remains authoritative.
- **Publish is explicit.** Adapter scripts default to dry-run.
- **Closed networks are not the source of truth.** Public projections point back to the canonical post.
- **Receipts are data.** Platform identifiers and URLs are written as structured files and can later be signed into Hestia.
- **Automation is disclosed.** Generated copy, synthetic narration, and imported text are visible in post or release metadata.
- **Rights are revocable.** Pausing a source stops future intake; corrections and takedowns are handled in the canonical record.

## Future modules

The core should remain small. Likely add-ons are:

- signed GitHub webhook reconciliation for merged, closed, and changes-requested post proposals;
- first-party RSS/Atom probing and source proposals backed by reviewed registry pull requests;
- follows and topic-specific views derived from open feed data;
- community prompts and replies represented as canonical posts rather than a closed content silo;
- lightweight reactions stored as account-scoped state without changing the public article record;
- an expanded “Who’s using Hara?” directory organised by projects and use cases;
- an authored lesson stream alongside the existing koan catalogue;
- editorial queue and preview dashboard;
- digest composer for multi-post weekly editions;
- long-form Kernel Sessions renderer;
- analytics importer using platform receipts rather than tracking pixels in posts;
- Hestia-signed release manifests and publication receipts;
- multilingual projections with human review;
- podcast RSS generated from approved narration editions.
