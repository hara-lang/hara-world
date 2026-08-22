# Hara Learn mailing list

The mailing list uses two deliberately separate systems:

- **Neon** is the consent and subscriber-lifecycle ledger.
- **Buttondown** performs double opt-in confirmation, delivery, unsubscribes, bounces, and subscriber self-service.

The website never treats a form submission as an active subscription. The provider state must become `regular` (or another deliverable subscriber type) before Neon marks the record active.

## 1. Configure Neon

In the Neon project `winter-shape-74417193`, open **Connect**, select the `neondb` database, and copy a pooled PostgreSQL connection string. Keep it secret; never add it to the repository or `netlify.toml`.

Run the idempotent migration:

```bash
DATABASE_URL='postgresql://…' npm run database:migrate
```

The migration creates:

- `hara_learn.mailing_list_subscribers` — email, interests, versioned consent, provider identifiers, and lifecycle state;
- `hara_learn.mailing_list_provider_events` — idempotency and retry state for signed provider events;
- `hara_learn.mailing_list_active` — the exportable active audience view;
- `hara_learn.schema_migrations` — applied migration names.

## 2. Configure Netlify secrets

Set these as encrypted environment variables on the Hara Learn Netlify project:

```text
DATABASE_URL=<the Neon pooled connection string>
BUTTONDOWN_API_KEY=<Buttondown API key>
BUTTONDOWN_WEBHOOK_SECRET=<long random signing key>
HARA_LEARN_SITE=https://learn.hara-lang.org
PUBLIC_HARA_LEARN_MANAGE_SUBSCRIPTION_URL=https://buttondown.com/login?subscriber=1
```

Optional controls:

```text
BUTTONDOWN_FORWARD_IP=true
BUTTONDOWN_USE_TAGS=false
BUTTONDOWN_BYPASS_FIREWALL=false
```

`BUTTONDOWN_FORWARD_IP=true` passes the request IP directly to Buttondown for its spam checks; Hara Learn does not persist it, while Buttondown may retain it under its own policy. Tags are optional because they require a Buttondown plan with tags enabled; interests always remain available in Neon.

## 3. Configure the Buttondown webhook

Create a webhook targeting:

```text
https://learn.hara-lang.org/api/newsletter/buttondown
```

Use exactly the same random value as `BUTTONDOWN_WEBHOOK_SECRET` for the webhook signing key. Subscribe at minimum to subscriber creation, confirmation/type changes, unsubscription, suppression/complaint, undeliverability, and deletion events available in the Buttondown dashboard.

The endpoint verifies `X-Buttondown-Signature`, records an idempotency key, retrieves the current subscriber, reduces it to a minimal lifecycle projection, and updates Neon. A failed event returns a non-2xx status so the provider can retry it.

## 4. Test before launch

1. Deploy a preview with all three secrets configured.
2. Submit an address you control through `/newsletter`.
3. Confirm that Neon records `pending` and Buttondown records `unactivated`.
4. Follow the confirmation email.
5. Confirm that the signed webhook changes the Neon row to `active`.
6. Unsubscribe through the email footer and confirm that Neon records `unsubscribed`.
7. Verify that the public API never reveals whether an address already exists.

## 5. Export the active audience

The export is intentionally a local/operator command rather than a public admin endpoint:

```bash
DATABASE_URL='postgresql://…' npm run newsletter:export > subscribers.csv
```

Only rows in `hara_learn.mailing_list_active` are emitted.

## Privacy and operations

- Do not log request bodies or email addresses in the Netlify function.
- Keep Neon and Buttondown credentials out of build logs and deploy previews shared with untrusted contributors.
- Rotate the webhook secret if it is exposed.
- Retain unsubscribed and suppressed lifecycle state so future integrations cannot accidentally remail those addresses.
- Back up or branch the Neon database before destructive schema changes.
