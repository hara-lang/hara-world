import registry from "../../registry/sources.json";

export type SourceRegistryEntry = {
  id: string;
  name: string;
  homepage: string;
  feed: string;
  status: "proposed" | "active" | "paused";
  syndication: "link" | "excerpt" | "full";
  permission: "owner" | "authorised" | "open-licence";
  license?: string;
  defaultAuthor?: string;
  contact?: string;
  topics: string[];
  language?: string;
  maxItemsPerRun?: number;
  relevance: string;
  registrantGithubId?: string;
  registrantGithubLogin?: string;
  registeredAt?: string;
  updatedAt?: string;
};

export const sourceRegistry = registry as {
  version: 1;
  sources: SourceRegistryEntry[];
};
