# Operations guide

## 1. Deploy the site

Create a Netlify site from `hara-lang/hara-world`.

- Build command: `npm run build`
- Publish directory: `dist`
- Node: `24`
- Production domain: `world.hara-lang.org`

Set `HARA_WORLD_SITE=https://world.hara-lang.org` and configure DNS after the first successful preview build.

## 2. Start the mailing list

Buttondown is the initial direct adapter because the release bundle already emits portable Markdown and the integration creates drafts for review. Configure the newsletter and set:

- Netlify: `PUBLIC_HARA_WORLD_NEWSLETTER_URL`
- GitHub environment: `BUTTONDOWN_API_KEY`

Keep the first list to a single weekly digest. A self-hosted listmonk instance can later consume the same Markdown if ownership, segmentation, or volume justifies operating mail infrastructure.

## 3. Create social accounts

Reserve a consistent Hara World name and link every profile to the canonical site. Add credentials only to the protected GitHub environment `hara-world-publishing`.

Direct variables:

- `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
- `MASTODON_BASE_URL`, `MASTODON_ACCESS_TOKEN`
- `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- `YOUTUBE_PRIVACY_STATUS=private`

Managed publisher variables:

- `HARA_PUBLISH_WEBHOOK_URL`
- `HARA_PUBLISH_WEBHOOK_SECRET`

Use the webhook for LinkedIn, Instagram, X, TikTok, or any service that should have its own app review, creator confirmation, media lifecycle, or credential boundary.

## 4. Protect publishing

Create a GitHub Actions environment named `hara-world-publishing`:

1. require at least one reviewer;
2. limit deployment branches to `main`;
3. add channel secrets;
4. leave `YOUTUBE_PRIVACY_STATUS` private until the review loop is proven;
5. do not expose these secrets to pull-request workflows.

## 5. Run an edition

1. Merge the canonical article.
2. Run **Build and distribute a Hara World release** manually.
3. Enter the article content ID, such as `2026-08-06-a-publication-for-the-programmable-world`.
4. Generate and download the review artifact.
5. Check copy, links, captions, voice, visual timing, and rights.
6. Re-run with selected publication inputs enabled.
7. Retain the receipt artifact.

## 6. Activate feed intake

Review a submitted source and edit `registry/sources.json`. Only change `status` to `active` when contact and permission are complete. The scheduled workflow polls active feeds once per day and maintains a draft PR on `automation/world-feed`.

Do not auto-merge this PR. Review generated excerpts, titles, dates, attribution, canonical links, and topic labels.

## 7. TTS contract

`HARA_WORLD_TTS_ENDPOINT` is optional. It receives:

```json
{
  "text": "Narration text",
  "voice": "hara-world",
  "format": "mp3",
  "releaseId": "article-hash"
}
```

It must return MP3 bytes. Set `HARA_WORLD_TTS_TOKEN` for bearer authentication and `HARA_WORLD_TTS_VOICE` for the configured voice. Keep the endpoint provider-specific; the Hara World repository only depends on this small contract.
