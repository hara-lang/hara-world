# Hara Learn proposal lifecycle

Hara Learn uses GitHub pull requests as the canonical review history for community posts, profiles, agents, and publication sources. The proposal lifecycle layer reflects that history back into Learn so contributors do not need to use GitHub as their day-to-day status dashboard.

```text
Learn form
    │
    ▼
GitHub proposal branch and draft pull request
    │
    ├── pull-request events
    ├── reviews and change requests
    ├── check runs and suites
    ├── review comments
    ├── close / reopen
    └── merge
          │ signed webhook
          ▼
community_proposals + append-only events
          │
    ┌─────┴──────────┐
    ▼                ▼
My Learn          Review queue
    │                │
    └──── reconciliation fallback ────► GitHub API
```

The database is a projection of GitHub state. It cannot publish a record. Merge remains the publication or registration event.

## Resource types

The common lifecycle covers four public proposal families:

| Type | Resource key | Public editor | Public result |
| --- | --- | --- | --- |
| `post` | private draft UUID | `/post` | `/articles/<content-id>` |
| `profile` | `github:<numeric-id>` | `/me#profile` | `/people/<slug>/` |
| `agent` | `agent:github:<operator-id>:<slug>` | `/agents/register` | `/agents/<slug>/` |
| `source` | source registry ID | `/submit` | `/sources` |

Each publisher records the proposal after GitHub returns a real pull-request number and URL. If that database write fails, the user still receives the GitHub result with `lifecycleRecorded: false`; webhook delivery, explicit reconciliation, or hourly discovery can repair the missing row.

## Database migration

Apply:

```text
database/migrations/005_community_proposals.sql
```

It creates:

```text
hara_learn.community_proposals
hara_learn.community_proposal_events
```

`community_proposals` stores the current projection. `community_proposal_events` is append-only. GitHub delivery IDs are unique per provider, so repeated webhook delivery is harmless.

The normalized proposal states are:

```text
draft
submitted
changes-requested
approved
merged
closed
withdrawn
error
```

Review and check state remain separate:

```text
review: pending | changes-requested | approved | dismissed
checks: unknown | pending | passing | failing
```

This prevents a failing check from being confused with a reviewer requesting changes and prevents approval from being mistaken for publication.

## Contributor API

```text
GET  /api/proposals
POST /api/proposals/reconcile
```

Both endpoints require an active Learn session. Reconciliation additionally requires a same-origin request with:

```text
X-Hara-Request: proposal-reconcile
```

`GET` returns only proposals belonging to the signed-in stable GitHub subject.

`POST` performs two repairs:

1. discover recent same-repository pull requests carrying valid Learn markers and expected branch names;
2. re-read each open proposal, its reviews, and its check runs from GitHub.

Discovery is important when GitHub created a PR but the initial Neon write or webhook delivery was lost.

## Review API

```text
GET  /api/review/proposals
POST /api/review/proposals
```

The review endpoint requires an active Learn session plus one of:

- current GitHub repository permission `write`, `maintain`, or `admin`;
- a merged Learn profile carrying the reviewed role `maintainer`, `editor`, `reviewer`, or `moderator`.

The queue is read-only in this version. It groups proposals that need attention, need first review, are approved, or were recently resolved. Comments, approvals, change requests, and merges continue in the canonical pull request.

The POST operation performs discovery and reconciliation for the whole queue and requires:

```text
X-Hara-Request: review-reconcile
```

## GitHub App webhook

Configure the GitHub App webhook URL as:

```text
https://learn.hara-lang.org/api/github/events
```

Set the same high-entropy secret in Netlify:

```text
HARA_LEARN_GITHUB_WEBHOOK_SECRET
```

The endpoint verifies:

```text
X-Hub-Signature-256
X-GitHub-Delivery
X-GitHub-Event
```

Subscribe the App to:

```text
Pull request
Pull request review
Pull request review comment
Check run
Check suite
```

The endpoint accepts only the configured repository. It ignores pull requests that do not satisfy all of these conditions:

- a recognized Hara Learn proposal marker is present;
- the stable owner and resource marker is present;
- the head branch follows the exact proposal convention;
- the head and base repositories are the same configured repository.

Expected branch forms are:

```text
post/github-<owner-id>/<draft-id-prefix>
profile/github-<owner-id>
agent-registry/github-<owner-id>/<agent-slug>
source-registry/github-<owner-id>/<source-id>
```

A marker copied into an unrelated branch or fork therefore cannot create or take over a lifecycle record.

## Ownership protection

Proposal IDs are deterministic hashes of proposal type and resource key. The database also has a unique `(proposal_type, resource_key)` constraint.

An upsert may refresh an existing resource only when the stable owner GitHub ID matches. The owner is never changed by webhook body text, a browser field, or a later pull request. A mismatched owner causes lifecycle recording to fail without changing the existing proposal.

## Reconciliation fallback

Netlify runs:

```text
netlify/functions/proposal-reconcile-scheduled.mjs
```

at minute 17 of every hour.

The scheduled job:

1. lists the one hundred most recently updated pull requests;
2. discovers valid managed proposals missing from the lifecycle ledger;
3. reads up to two hundred open proposals;
4. reconciles pull-request, review, and check state.

Review and check API reads are optional. If the GitHub App lacks access to those secondary endpoints, reconciliation still preserves pull-request open, closed, draft, and merged state. For full status reporting, grant the App read access to Checks as well as write access to Contents and Pull requests.

## User surfaces

### `/me`

“My Learn” shows proposal counts and cards across all four resource types. It provides:

- current lifecycle state;
- review and check state;
- last update time;
- continue-editing action;
- published destination after merge;
- technical GitHub review link;
- explicit owner reconciliation.

The profile editor remains on the same page.

### `/review`

The review queue shows a cross-resource operational view for authorized reviewers. It intentionally does not reproduce GitHub review controls yet.

## Readiness

`/.well-known/hara-learn-readiness` returns unavailable until all of these are true:

- Learn authentication is configured;
- the central Identity handoff client is valid;
- community account, post draft, and proposal lifecycle migrations exist;
- the GitHub App can reach the configured repository and base branch;
- Contents and Pull requests permissions are sufficient;
- `HARA_LEARN_GITHUB_WEBHOOK_SECRET` is configured.

`/.well-known/hara-learn` advertises the dashboard, contributor API, reviewer API, webhook endpoint, reconciliation endpoint, and publication boundary.

## Trust boundary

The lifecycle layer is deliberately subordinate to Git:

- a webhook state cannot publish content;
- a Neon row cannot publish content;
- an approval is not a merge;
- a passing check is not an approval;
- agent registration does not grant an agent access to the contributor or reviewer APIs;
- reviewer access does not grant package, specification, or agent-runtime authority;
- merge remains the only publication or registration event.
