# Community identity and Git-reviewed profiles

Learn uses a two-stage identity model:

1. `id.hara-lang.org` performs GitHub OAuth and holds the central Hara session.
2. Learn obtains a short-lived, audience-bound handoff and establishes its own host-only session.

The two services share only an environment-specific handoff client secret. They do not share session-signing keys. A Learn session lasts two hours and is cleared by the browser when the central account signs out or changes to a different numeric GitHub identity.

## Learn endpoints

```text
GET  /.well-known/hara-learn
GET  /api/auth/start
GET  /api/auth/callback
GET  /api/auth/session
POST /api/auth/logout
GET  /api/profile
POST /api/profile
```

`/api/auth/start` creates random state and an S256 PKCE verifier in short-lived, host-only cookies. Identity returns an opaque code to the exact Learn callback. The callback exchanges the code server-to-server, verifies the issuer, audience, GitHub subject, timestamps, and provider, records the random handoff ID in Neon, and only then issues the local session.

## Profile proposal flow

The browser may propose display text, biography, interests, location, website, and an initial slug. The server supplies the stable numeric GitHub ID and current login from the verified session. Existing reviewed roles and links are preserved.

A narrowly scoped GitHub App then:

1. reads `content/profiles` from the configured base branch;
2. creates a dedicated branch from the exact base revision;
3. writes the deterministic Markdown profile;
4. opens a draft pull request.

Merge remains the publication event. The profile service never writes directly to `main`, never accepts role or identity fields from the form, rejects raw HTML, and rejects executable Markdown link schemes.

## Required Netlify variables

```text
DATABASE_URL
HARA_LEARN_HANDOFF_SECRET
HARA_LEARN_SESSION_SECRET
HARA_LEARN_GITHUB_APP_ID
HARA_LEARN_GITHUB_APP_PRIVATE_KEY
HARA_LEARN_GITHUB_INSTALLATION_ID
```

Optional:

```text
HARA_IDENTITY_ORIGIN
HARA_LEARN_GITHUB_REPOSITORY=hara-lang/hara-learn
HARA_LEARN_GITHUB_BASE_BRANCH=main
```

Use different handoff and session secrets in testing and production. The Learn GitHub App needs only repository metadata read, contents read/write, and pull requests read/write for `hara-lang/hara-learn`.

Run `npm run database:migrate` before enabling authentication. `community_identity_handoffs.handoff_id` is the database replay boundary, while `community_accounts.github_user_id` is the durable account key. GitHub logins are deliberately not unique authority because they can change or be reused.
