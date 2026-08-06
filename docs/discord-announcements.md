# Discord pinned-announcement intake

Hara World treats pins in explicitly reviewed public Discord channels as publication proposals. A pin never publishes directly: the scheduled importer writes deterministic Markdown to an automation branch and opens or refreshes a draft pull request. Merge remains the publication event.

## Discord application

Create a dedicated Hara World bot and install it only in the Hara community server. For each allowlisted channel, grant only:

- View Channel
- Read Message History

Enable the Message Content privileged intent so the REST API returns user-authored message text, embeds, components, and attachments. The bot does not need permission to create, edit, or remove pins.

Discord API references:

- `GET /channels/{channel.id}/messages/pins` — paginated current pins
- Message Content intent — required to receive message content fields

## Repository configuration

Edit `registry/discord-channels.json` through review:

```json
{
  "version": 1,
  "guildId": "123456789012345678",
  "channels": [
    {
      "id": "234567890123456789",
      "slug": "announcements",
      "title": "Announcements",
      "active": true,
      "topics": ["community"]
    }
  ]
}
```

The guild and channel IDs are public coordinates rather than credentials. Store the bot token only as the GitHub Actions secret `DISCORD_BOT_TOKEN`. `DISCORD_GUILD_ID` may be supplied as a repository variable to override the reviewed file during an operational transition.

## Generated records

Each current pin becomes a stable file below `content/articles/discord/` with:

- the Discord message ID as a source identifier;
- a canonical link to the original message;
- author, original timestamp, pin timestamp, and content hash;
- `announcement`, `discord`, and channel topics;
- a visible automation disclosure;
- `kind: field-note`, so the existing World article/feed contract remains unchanged.

User, role, channel, `@everyone`, and `@here` mentions are neutralised before publication. Attachment filenames are recorded, but Discord CDN URLs are not mirrored into the public article. Editors can deliberately add durable media during review when rights and hosting are clear.

## Unpins, edits, and deletion

The synchronization state records only the current pin set. When a message is unpinned, its state entry disappears and the review PR exposes that change. The importer does not delete an existing Markdown article. Editors decide whether a published announcement should remain, be corrected, be archived, or receive a takedown note.

Message edits regenerate the deterministic article and content hash, producing a reviewable diff. Source deletion is handled the same way as an unpin because Discord may not emit a complete deletion event for pin state.

## Local operation

With no active channels, the command is a safe no-op and requires no token:

```bash
npm run discord:sync
```

With active channels:

```bash
DISCORD_BOT_TOKEN='…' npm run discord:sync
```

A dry run reports candidate paths without writing them:

```bash
DISCORD_BOT_TOKEN='…' npm run discord:sync -- --dry-run
```
