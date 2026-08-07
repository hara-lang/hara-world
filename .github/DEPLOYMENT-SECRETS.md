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

Production must use a separate Netlify project and its own site ID. After configuring the secrets, manually dispatch `Deploy world.hara-lang.org` and require its validation, deploy, domain reconciliation, active readiness, and logout verification steps to pass.
