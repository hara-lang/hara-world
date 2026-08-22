export const SITE = {
  name: "Hara Learn",
  shortName: "Learn",
  description: "Tutorials, koans, people, projects, and community writing from the Hara ecosystem.",
  repository: "https://github.com/hara-lang/hara-learn",
  home: "https://hara-lang.org/",
  docs: "https://build.hara-lang.org/",
  playground: "https://play.hara-lang.org/",
  specs: "https://build.hara-lang.org/",
  packages: "https://packages.hara-lang.org/",
  identity: "https://id.hara-lang.org/",
  post: "/post",
  profile: "/me",
  sources: "/submit",
  agents: "/agents",
  registerAgent: "/agents/register"
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
