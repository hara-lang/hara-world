# Hara Learn — Visual Language v2 adoption

## Accepted source

Hara Learn pins `@hara-lang/visual-language` to merged revision:

```text
b512a12e8d7191c9092d195ca0ddc894b0ba54d2
```

That revision contains the shared v2 application shell and the settled `V2-LEARN.md` product contract. The dependency is an immutable commit rather than a branch or floating package version.

## Shared application shell

`SiteLayout.astro` continues to consume the shared:

- `Shell` application frame;
- `Header` ecosystem navigation;
- `ContextNav` Learn navigation;
- `ThemeToggle` implementation;
- Hara mark, motifs, effects, and v2 token system.

The shell retains one page-level `main` landmark, the keyboard skip link, canonical and social metadata, identity mounting, open-feed discovery links, and the product-owned footer. Feed, People, Agents, Koans, and Sources remain product destinations. Add a feed and Post remain visible contribution actions.

The narrow `v2-adoption.css` bridge owns only Learn-specific shell mapping: full-width content geometry, visible focus, 44-pixel context actions, responsive horizontal containment, sticky-anchor offsets, footer mapping, and reduced-motion behaviour. It consumes but does not redefine protected Hara tokens.

## Production homepage composition

Issue #32 replaces the earlier community landing composition with the settled Learn hierarchy:

1. a definition-first proposition that says what Hara is and what the reader can do;
2. three explicit entrances for a new programmer, an experienced programmer, and a Lisp user;
3. a current first-lesson record with canonical source, first check, and an explicit runtime boundary;
4. outcome-oriented paths derived from the canonical koan catalogue;
5. current article, profile, people, agent, and syndication records;
6. browser, curriculum, Play, and community next actions;
7. visible anonymous, no-JavaScript, and runtime-unavailable states.

The homepage uses bounded components under `src/components/learn-home/` and the scoped `src/styles/learn-home-v2.css` composition. It no longer depends on the old `community-intro`, `community-summary`, `community-widget`, `hero-actions`, generic `.button`, or generic `.callout` homepage grammar.

## Instructional data ownership

The homepage does not introduce a second curriculum or fixture dataset.

- `KOANS` remains the canonical ordered exercise catalogue.
- The daily lesson is selected directly from that catalogue.
- Entrance and path links are derived from canonical koan slugs.
- Path counts are calculated from real koan topics.
- Starter source and checks are rendered exactly from the selected koan.
- The koan workspace retains editing, Run, reset, browser-kernel, test-state, and accepted-solution ownership.

The homepage is static-first. It shows source and the expected check, but never presents an inferred result as successful execution. JavaScript is not required to understand the proposition, choose a path, inspect the starter form, or read the current community records.

## Community and publication ownership

Learning becomes the primary entrance without removing the existing community service.

- Articles still come from `getArticles()` and use canonical `articlePath()` routes.
- Published people still come from the `profiles` content collection.
- Author, kind, publication date, topics, and description remain visible.
- Native posting stays at `/post`.
- Feed submission stays at `/submit`.
- People and agents remain at `/people` and `/agents`.
- RSS, JSON Feed, and OPML remain at `/feed.xml`, `/feed.json`, and `/sources.opml`.
- Identity remains optional for reading and first-lesson access.
- Newsletter, profile, agent-registration, moderation, review, and syndication authority remain product-owned.

Visual Language owns shared tokens, shell geometry, controls, icon grammar, focus, responsive behaviour, and the settled Learn product hierarchy. Hara Learn owns curriculum data, article and profile records, route order, production copy, identity, publication, moderation, syndication, and browser-exercise behaviour.

## Responsive and degraded behaviour

The homepage is reviewed as one contained application surface at desktop, tablet, 390-pixel, and 320-pixel widths in light and dark themes.

- Hero, lesson, community, and starting grids collapse without changing reading order.
- Code records scroll inside their own bounds.
- Context and action controls retain at least 44-pixel targets.
- Feed and profile records remain legible without relying on hover.
- Reduced-motion preferences suppress non-essential transitions.
- Empty article or profile collections produce named empty states.
- Anonymous, no-JavaScript, and runtime-unavailable states are explicit rather than hidden.

## Validation

Run the complete repository gate on the exact pull-request head:

```sh
npm run sources:check
npm run profiles:check
npm run agents:check
npm test
npm run build
```

The homepage contract tests verify:

- the exact immutable Visual Language revision;
- availability of `V2-LEARN.md` and the shared Learn glyph;
- the three required experience entrances;
- canonical koan, article, profile, people, agent, publication, and open-feed data paths;
- removal of the legacy homepage composition classes;
- scoped v2 token consumption with no protected-token declarations;
- 44-pixel controls, responsive breakpoints, bounded overflow, focus, and reduced motion;
- a static first-lesson record and honest runtime boundary.

## Follow-on work

The homepage is the first application-level slice after shared-shell adoption. Subsequent pull requests should:

1. migrate the koan catalogue and exercise workspace to the same Learn hierarchy while preserving the real browser kernel and test lifecycle;
2. migrate article/thread and provenance presentation;
3. migrate People and Agent profiles, including ownership and presence states;
4. migrate Post, Add a feed, newsletter, account, proposal, and review forms to the shared state grammar;
5. attach and maintain the light/dark desktop/tablet/mobile route matrix across all public and authenticated states.
