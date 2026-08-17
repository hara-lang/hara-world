export const SITE = {
  name: "Hara World",
  shortName: "World",
  description: "Independent dispatches, demonstrations, and community writing from the Hara Lisp world.",
  repository: "https://github.com/hara-lang/hara-world",
  home: "https://www.hara-lang.org/",
  docs: "https://www.hara-lang.org/docs/start/orientation/",
  playground: "https://playground.hara-lang.org/",
  specs: "https://specs.hara-lang.org/",
  packages: "https://packages.hara-lang.org/",
  identity: "https://id.hara-lang.org/"
} as const;

export const kindLabels = {
  dispatch: "Dispatch",
  syndicated: "Syndicated",
  release: "Release",
  "field-note": "Field note"
} as const;

export function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Melbourne"
  }).format(value);
}
