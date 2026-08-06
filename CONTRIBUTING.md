# Contributing to Hara World

## Articles

Open a pull request containing one Markdown file below `content/articles/`. Include complete frontmatter, working links, and any licensing or automation disclosure relevant to the piece.

By contributing original text, you confirm that you have the right to submit it and identify the article licence in frontmatter. The repository’s MIT licence covers software, not contributed article copyright.

## Source submissions

Use the **Submit a publication feed** issue form. Do not add a third party’s feed as `active` without permission evidence or a clearly compatible open licence. New sources normally begin as `proposed`.

## Development

```bash
npm install
npm run check
```

A pull request should keep generated release directories out of Git. Feed-generated article files and `registry/sync-state.json` are exceptions because their diffs are the review surface.

## Style

- Prefer concrete demonstrations over broad claims.
- Link benchmarks and adoption claims to inspectable evidence.
- Identify whether a piece is official, editorial, provisional, or syndicated.
- Preserve the Hara precision-material visual language; do not introduce unrelated gradients, whimsical decoration, or stock visual clichés.
- Keep publication adapters modular and dry-run by default.
