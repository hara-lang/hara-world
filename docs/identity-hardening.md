# World identity hardening

Hara World accepts authenticated writes only through an audience-bound Identity handoff and a separate World-local session.

## Runtime boundaries

- The stable numeric GitHub ID is the account key; the login is mutable display metadata.
- A handoff is consumed only after an active community account upsert succeeds.
- Every World session and profile request rechecks that the community account remains active.
- Central sign-out uses a front-channel redirect through World so the host-only World cookie is cleared from any Hara site.
- `/.well-known/hara-world-readiness` actively checks Identity, the Neon schema, GitHub App permissions, repository access, and the target branch.

## Profile publication

- `registry/profiles.json` is the reciprocal Git-reviewed index by numeric GitHub ID and public slug.
- One stable branch, `profile/github-<id>`, is reused for each identity's open proposal.
- A proposal may change exactly one profile Markdown file and the profile index.
- User Markdown is sanitised again at render time. Raw HTML, images, active content, insecure URLs, event handlers, and style properties are not rendered.
- Merge remains the publication event and never grants package, specification, repository, or editorial authority.

## Required repository ruleset

GitHub repository settings must enforce these controls on `main`:

1. Require a pull request before merging.
2. Require at least one human approval and Code Owner review for protected paths.
3. Do not allow the Hara World GitHub App to bypass the ruleset.
4. Disable force pushes and branch deletion.
5. Require the authenticated profile proposal check for profile changes.
6. Do not add a `pull_request_target` workflow that checks out or executes profile proposal code.

The GitHub App remains installed only on `hara-lang/hara-world` with Metadata read, Contents write, and Pull requests write.
