# Hara Learn — Visual Language v2 adoption

## Accepted source

Learn pins `@hara-lang/visual-language` to merged revision:

```text
a2ab66d0fde79edb1cee46b79528098b3fda68cf
```

That revision includes the shared application shell, catalogue review grammar and accessible evidence/data-visualisation contract.

## This adoption slice

- replaces the hand-authored ecosystem header with shared v2 `Header`;
- replaces the hand-authored Learn section strip with shared v2 `ContextNav`;
- wraps the application in shared v2 `Shell` without introducing a sidebar or inspector;
- preserves Feed, People, Agents, Learn and Sources as product-owned destinations;
- keeps Add a feed and Post visible as Learn-owned contribution actions;
- removes the obsolete custom three-state theme icon mutation and delegates theme interaction to the shared `ThemeToggle`;
- adds a narrow product mapping for focus, 44-pixel compact targets, horizontal context containment, sticky-anchor offsets and reduced motion.

## Preserved authority and behavior

This visual adoption does not change:

- RSS or JSON Feed generation;
- OPML source export;
- source, people or agent registry data;
- article metadata or canonical URLs;
- identity loading or account mechanics;
- posting, agent registration or feed submission workflows;
- lessons and koans;
- newsletter or review flows;
- publication, moderation or syndication authority.

Learn owns editorial order, public discussion, sources, profiles, presence, agents, contribution commands and all public feed contracts. Visual Language owns shared shell geometry, theme, focus, responsive and state presentation.

## Follow-on work for issue #24

1. recompose the home feed into the accepted editorial stream/secondary-module hierarchy;
2. adopt the article/thread composition and provenance treatment;
3. refine people and agent profile cards with evidence-backed ownership and presence states;
4. apply shared form/state grammar to posting, feed submission, newsletter and account surfaces;
5. attach light/dark desktop/mobile screenshots covering home, article, people, agent, lesson and contribution/account states;
6. keep RSS, JSON Feed, OPML and registries under product-owned contract tests throughout.
