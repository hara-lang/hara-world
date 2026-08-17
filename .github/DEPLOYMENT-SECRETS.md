# Hara World deployment credentials

The GitHub Actions deployment workflow requires repository secrets:

```text
NETLIFY_AUTH_TOKEN
NETLIFY_TESTING_SITE_ID
NETLIFY_PRODUCTION_SITE_ID
```

`NETLIFY_AUTH_TOKEN` must be a Netlify personal access token or equivalent credential with permission to deploy both World projects. It must be stored as a GitHub Actions secret and never committed to source control.

Testing site ID:

```text
13d913c8-553b-4c1b-8de9-8ace2ff35d5e
```

Production must use a separate Netlify project and its own site ID.

## Proposal lifecycle deployment

Before proposal dashboards can report GitHub review state:

1. apply `database/migrations/005_community_proposals.sql` to the environment's Neon database;
2. generate a different high-entropy webhook secret for testing and production;
3. set the Netlify environment variable:

```text
HARA_WORLD_GITHUB_WEBHOOK_SECRET
```

4. configure the Hara World GitHub App webhook URL for each environment:

```text
https://world.testing.hara-lang.org/api/github/events
https://world.hara-lang.org/api/github/events
```

5. subscribe the App to Pull request, Pull request review, Pull request review comment, Check run, and Check suite events;
6. ensure the App retains Contents and Pull requests write permission, repository Metadata read permission, and Checks read permission for complete reconciliation.

The webhook secret belongs in Netlify, not GitHub Actions. The GitHub App configuration must use the matching value. Testing and production must not share it.

After configuring deployment secrets and environment variables, manually dispatch `Deploy world.hara-lang.org` and require its validation, deploy, domain reconciliation, active readiness, and logout verification steps to pass. `/.well-known/hara-world-readiness` now remains unavailable when the proposal migration or webhook secret is missing.
