export const SITE = {
  name: "Hara World",
  shortName: "World",
  description: "Community posts, people, agents, lessons, and syndicated feeds from the Hara Lisp ecosystem.",
  repository: "https://github.com/hara-lang/hara-world",
  home: "https://www.hara-lang.org/",
  docs: "https://www.hara-lang.org/docs/start/orientation/",
  playground: "https://playground.hara-lang.org/",
  specs: "https://specs.hara-lang.org/",
  packages: "https://packages.hara-lang.org/",
  identity: "https://id.hara-lang.org/",
  post: "/post",
  agents: "/agents",
  registerAgent: "/agents/register",
  postIssue: "https://github.com/hara-lang/hara-world/issues/new?template=article-proposal.yml",
  profile: "https://github.com/hara-lang/hara-world/issues/new?template=profile.yml"
} as const;

export const kindLabels = {
  dispatch: "Post",
  syndicated: "From the web",
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
