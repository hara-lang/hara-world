export function validateRegistry(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["registry must be an object"];
  if (value.version !== 1) errors.push("version must be 1");
  if (!Array.isArray(value.sources)) return [...errors, "sources must be an array"];

  const ids = new Set();
  const feeds = new Set();
  const allowed = new Set(["id", "name", "homepage", "feed", "status", "syndication", "permission", "license", "defaultAuthor", "contact", "topics", "language", "maxItemsPerRun"]);

  value.sources.forEach((source, index) => {
    const location = `sources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push(`${location} must be an object`);
      return;
    }
    for (const key of Object.keys(source)) if (!allowed.has(key)) errors.push(`${location}.${key} is not supported`);
    for (const key of ["id", "name", "homepage", "feed", "status", "syndication", "permission", "topics"]) {
      if (source[key] === undefined || source[key] === "") errors.push(`${location}.${key} is required`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id ?? "")) errors.push(`${location}.id must be kebab-case`);
    if (ids.has(source.id)) errors.push(`${location}.id duplicates ${source.id}`);
    ids.add(source.id);
    if (feeds.has(source.feed)) errors.push(`${location}.feed duplicates another source`);
    feeds.add(source.feed);
    for (const field of ["homepage", "feed"]) {
      try {
        const url = new URL(source[field]);
        if (url.protocol !== "https:") errors.push(`${location}.${field} must use HTTPS`);
        if (url.username || url.password) errors.push(`${location}.${field} must not contain credentials`);
      } catch {
        errors.push(`${location}.${field} must be an absolute URL`);
      }
    }
    if (!["proposed", "active", "paused"].includes(source.status)) errors.push(`${location}.status is invalid`);
    if (!["link", "excerpt", "full"].includes(source.syndication)) errors.push(`${location}.syndication is invalid`);
    if (!["owner", "authorised", "open-licence"].includes(source.permission)) errors.push(`${location}.permission is invalid`);
    if (source.permission === "open-licence" && !source.license) errors.push(`${location}.license is required for open-licence permission`);
    if (source.syndication === "full" && !source.license && source.permission !== "owner") errors.push(`${location} needs a licence or owner permission for full syndication`);
    if (source.status === "active" && !source.contact) errors.push(`${location}.contact is required before activation`);
    if (!Array.isArray(source.topics) || source.topics.length === 0) errors.push(`${location}.topics must contain at least one topic`);
    else {
      const topics = new Set();
      for (const topic of source.topics) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) errors.push(`${location}.topics contains invalid topic ${topic}`);
        if (topics.has(topic)) errors.push(`${location}.topics contains duplicate ${topic}`);
        topics.add(topic);
      }
    }
    if (source.maxItemsPerRun !== undefined && (!Number.isInteger(source.maxItemsPerRun) || source.maxItemsPerRun < 1 || source.maxItemsPerRun > 20)) {
      errors.push(`${location}.maxItemsPerRun must be an integer from 1 to 20`);
    }
  });
  return errors;
}
