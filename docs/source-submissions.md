# First-party source submissions

Hara World accepts RSS and Atom publication proposals through `/submit`. The browser never asks the user to copy fields into a GitHub issue. It establishes a World session, probes the feed through a constrained server endpoint, and asks the Hara World GitHub App to prepare a reusable draft pull request.

```text
Hara Identity
      │ audience-bound handoff
      ▼
World human session
      │
      ├──► POST /api/sources/probe ─► safe public feed inspection
      │
      └──► POST /api/sources
                    │ server re-probes
                    ▼
          source-registry/github-<registrant-id>/<source-id>
                    │
                    ▼
              draft pull request
                    │ review + merge
                    ▼
             registry/sources.json
                    │ reviewed activation
                    ▼
        scheduled RSS / Atom intake proposal
```

## Endpoints

```text
GET  /api/sources
POST /api/sources
POST /api/sources/probe
```

All operations require an active World account. Mutating operations also require a same-origin request and one of:

```text
X-Hara-Request: source-proposal
X-Hara-Request: source-probe
```

`GET /api/sources` returns merged source records maintained by the signed-in registrant. Pending proposals remain visible through the pull-request URL returned at submission time.

## Browser-controlled fields

The form may propose:

- stable source ID on the first registration;
- publication name;
- homepage and feed URL;
- public correction and revocation contact URL;
- permission basis;
- requested syndication mode;
- licence or written-permission reference;
- default author and language;
- topics;
- relevance to Hara World.

The browser cannot choose:

- registrant GitHub ID or login;
- source activation status;
- polling limits;
- proposal branch;
- base revision;
- pull-request metadata.

New records always enter with `status: proposed`. If the registrant updates an existing active source, the server preserves the reviewed activation and polling policy; the resulting change still requires merge before the scheduler sees it.

## Feed probe boundary

The probe is deliberately not a generic URL fetcher. It:

- accepts absolute credential-free HTTPS URLs only;
- rejects localhost, `.local`, loopback, private, link-local, multicast, documentation, and reserved addresses;
- resolves and checks the host before each request;
- manually follows at most five redirects and revalidates every target;
- applies a request timeout;
- limits response bytes even without a `Content-Length` header;
- disables XML entity processing;
- requires valid XML containing an RSS channel or Atom feed;
- returns only a small metadata and entry preview.

Submission performs the probe again on the server. A successful browser preview is not trusted as publication evidence.

These checks reduce server-side request forgery risk but do not turn the service into a general-purpose remote-content proxy. The endpoint remains authenticated and rate-limited.

## Permission boundary

Transport and rights remain separate:

- A reachable public feed proves only that a server returned parseable RSS or Atom.
- `owner` means the registrant says they own the publication or feed.
- `authorised` means the registrant says the owner or author authorised the requested use.
- `open-licence` requires an explicit licence reference.
- Full-text syndication requires owner permission or an explicit licence reference.

The pull request carries the registrant identity, declared permission, requested mode, relevance statement, probed final feed URL, and a small feed sample. Reviewers remain responsible for checking provenance and permission before activation.

## Git publication model

The public form writes no issue. It updates one source registry file on a stable branch:

```text
source-registry/github-<registrant-github-id>/<source-id>
```

Submitting the same source again resets that branch to the current configured base and updates its existing open draft pull request. This prevents proposal spam and makes each source's review history easy to locate.

Merge records the source. Activation remains a reviewed `status` change, and scheduled ingestion continues to prepare separate draft pull requests for imported posts.

## Public privacy

The source registry is stored in a public Git repository. The form therefore accepts a public HTTPS contact page rather than a private email address. The generated `/sources.json` export continues to omit the contact field, but the reviewed Git record remains public.

## Existing forms

The same first-party pattern now covers all primary community submissions:

- posts: `/post` → `/api/posts`;
- profiles: `/me` → `/api/profile`;
- agents: `/agents/register` → `/api/agents`;
- publication feeds: `/submit` → `/api/sources`.

The UI may display the resulting pull-request URL after submission, but it no longer sends users to GitHub to fill out the proposal itself.
