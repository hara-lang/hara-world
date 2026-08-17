# Native community posts

Hara World provides a first-party posting path without turning the public community record into a mutable database feed.

The boundary is deliberate:

```text
Hara Identity
      │ audience-bound handoff
      ▼
World session ──► private Neon draft ──► reusable GitHub proposal branch
                                              │
                                              ▼
                                      draft pull request
                                              │ review + merge
                                              ▼
                                  public Markdown on main
                                              │
                           ┌──────────────────┼──────────────────┐
                           ▼                  ▼                  ▼
                         website             RSS             JSON Feed
```

Neon owns private, mutable workflow state. Git owns every published post. A successful form submission is not publication; merge is publication.

## User flow

1. Sign in through `id.hara-lang.org` and establish a two-hour World session.
2. Open `/post` and create a private draft.
3. Save manually or let an existing draft autosave after edits.
4. Submit the draft for review.
5. World derives the author identity from the verified session, creates deterministic Markdown, and opens a draft pull request through the Hara World GitHub App.
6. Resubmitting the same draft resets its stable proposal branch to the current base and updates the existing open pull request.
7. Reviewers merge the pull request to publish the post through the existing Astro collection and feeds.

## API

All endpoints require an active World session. Mutating requests also require a same-origin request and:

```text
X-Hara-Request: community-post
```

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/posts` | List the signed-in account's private drafts. |
| `POST` | `/api/posts` | Create a private draft. |
| `GET` | `/api/posts/:id` | Read one owned draft. |
| `PATCH` | `/api/posts/:id` | Update one owned draft. |
| `DELETE` | `/api/posts/:id` | Delete an unsubmitted private draft. |
| `POST` | `/api/posts/:id/submit` | Create or update the Git-reviewed post proposal. |
| `POST` | `/api/posts/:id/withdraw` | Close an open proposal and mark the private draft withdrawn. |

A draft payload contains only editable post data:

```json
{
  "slug": "small-hara-agent",
  "postType": "showcase",
  "title": "Building a small agent with Hara",
  "description": "A working note on tools, state, and the embedded REPL.",
  "topics": ["hara", "agents", "repl"],
  "body": "## The experiment\n\n..."
}
```

The service ignores browser-supplied author, GitHub ID, login, role, publication path, branch, and pull-request fields.

## Post types

The initial native vocabulary is intentionally small:

- `note` — a working note or observation;
- `question` — a question for the community;
- `showcase` — a project, package, experiment, or demonstration;
- `release` — a concrete release announcement;
- `lesson` — a reusable explanation or exercise.

The public article schema stores `postType`, `authorGithubId`, and `authorGithubLogin`. A typed native post is invalid unless both stable author fields are present.

## Private storage

Migration `004_community_posts.sql` adds:

- `hara_world.community_post_drafts` — owner-scoped draft content and current proposal state;
- `hara_world.community_post_events` — append-only lifecycle events for audit and later reconciliation.

Draft bodies are private application data. They are not selected into a public Astro endpoint and are not included in the static site build.

A SHA-256 fingerprint covers the normalised slug, type, title, description, topics, and body. The current draft fingerprint and last proposed fingerprint are stored separately so later reconciliation can identify unsent edits.

## GitHub proposal contract

Every private draft has one stable proposal branch:

```text
post/github-<numeric-github-id>/<draft-id-prefix>
```

The first submission writes a path shaped as:

```text
content/articles/community/YYYY/MM/<numeric-github-id>-<slug>.md
```

The draft's first submission time fixes the date component and public `publishedAt` value. The slug becomes immutable after a proposal path exists.

The pull request body carries machine-readable markers:

```html
<!-- hara-world-post-proposal -->
<!-- hara-world-post:draft:<uuid> -->
<!-- hara-world-author:github:<numeric-id> -->
<!-- hara-world-content-sha256:<fingerprint> -->
```

The GitHub App never writes to `main`. It requires only repository metadata read, contents read/write, and pull requests read/write for `hara-lang/hara-world`.

If GitHub creates the pull request but Neon cannot record the result, the endpoint returns the canonical GitHub proposal with `stateRecorded: false`. Git remains authoritative and the proposal is not discarded or falsely reported as absent.

## Markdown safety

Native community posts use the same constrained renderer as public profiles. It permits normal prose, headings, lists, tables, blockquotes, code fences, and safe links while removing or neutralising:

- raw HTML and active elements;
- scripts, forms, iframes, embeds, SVG, and MathML;
- remote images and tracking pixels;
- event attributes and arbitrary element properties;
- `javascript:`, `data:`, `vbscript:`, protocol-relative, credential-bearing, and plain-HTTP links.

External HTTPS links receive:

```text
rel="nofollow ugc noopener noreferrer"
```

Submission validation rejects raw HTML and executable Markdown link targets before the proposal is prepared. Rendering applies the allowlist again so the public boundary does not depend on form validation.

## Deployment

The existing World backend variables are reused:

```text
DATABASE_URL
HARA_WORLD_HANDOFF_SECRET
HARA_WORLD_SESSION_SECRET
HARA_WORLD_GITHUB_APP_ID
HARA_WORLD_GITHUB_APP_PRIVATE_KEY
HARA_WORLD_GITHUB_INSTALLATION_ID
HARA_WORLD_GITHUB_REPOSITORY=hara-lang/hara-world
HARA_WORLD_GITHUB_BASE_BRANCH=main
```

Apply migrations before enabling `/post`:

```bash
DATABASE_URL='postgresql://…' npm run database:migrate
```

Then verify:

```text
/.well-known/hara-world-readiness
```

The readiness result now fails closed unless the community account, identity handoff, post draft, and post event tables all exist and the GitHub App can read the configured base branch with contents and pull-request write permission.

## Review checklist

Before merging a native post proposal, verify:

- title, description, type, and topics describe the body accurately;
- `authorGithubId` and `authorGithubLogin` match the proposal markers;
- the path begins under `content/articles/community/`;
- the proposal contains no private data, credentials, copied proprietary text, or unlicensed media;
- links and attribution are appropriate;
- the post is useful to the Hara community and is not an authority claim;
- `social: false` remains appropriate unless a separate reviewed distribution decision is made.

## Current boundary

This increment does not add comments, reactions, follows, direct messages, or an algorithmic timeline. Replies can later be represented as ordinary canonical posts with an explicit `inReplyTo` URL. Lightweight account-scoped reactions can be added to Neon without changing the public Markdown source of truth.
