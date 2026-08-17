const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateHttpsUrl(value, location, errors) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${location} must use HTTPS`);
    if (url.username || url.password) errors.push(`${location} must not contain credentials`);
  } catch {
    errors.push(`${location} must be an absolute URL`);
  }
}

export function validateRegistry(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["registry must be an object"];
  if (value.version !== 1) errors.push("version must be 1");
  if (!Array.isArray(value.sources)) return [...errors, "sources must be an array"];

  const ids = new Set();
  const feeds = new Set();
  const allowed = new Set([
    "id", "name", "homepage", "feed", "status", "syndication", "permission", "license",
    "defaultAuthor", "contact", "topics", "language", "maxItemsPerRun", "relevance",
    "registrantGithubId", "registrantGithubLogin", "registeredAt", "updatedAt",
  ]);

  value.sources.forEach((source, index) => {
    const location = `sources[${index}]`;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      errors.push(`${location} must be an object`);
      return;
    }
    for (const key of Object.keys(source)) if (!allowed.has(key)) errors.push(`${location}.${key} is not supported`);
    for (const key of ["id", "name", "homepage", "feed", "status", "syndication", "permission", "topics", "relevance"]) {
      if (source[key] === undefined || source[key] === "") errors.push(`${location}.${key} is required`);
    }
    if (!ID_PATTERN.test(source.id ?? "")) errors.push(`${location}.id must be kebab-case`);
    if (ids.has(source.id)) errors.push(`${location}.id duplicates ${source.id}`);
    ids.add(source.id);
    if (feeds.has(source.feed)) errors.push(`${location}.feed duplicates another source`);
    feeds.add(source.feed);
    for (const field of ["homepage", "feed"]) validateHttpsUrl(source[field], `${location}.${field}`, errors);
    if (source.contact !== undefined) validateHttpsUrl(source.contact, `${location}.contact`, errors);
    if (!["proposed", "active", "paused"].includes(source.status)) errors.push(`${location}.status is invalid`);
    if (!["link", "excerpt", "full"].includes(source.syndication)) errors.push(`${location}.syndication is invalid`);
    if (!["owner", "authorised", "open-licence"].includes(source.permission)) errors.push(`${location}.permission is invalid`);
    if (source.permission === "open-licence" && !source.license) errors.push(`${location}.license is required for open-licence permission`);
    if (source.syndication === "full" && !source.license && source.permission !== "owner") errors.push(`${location} needs a licence or owner permission for full syndication`);
    if (["proposed", "active"].includes(source.status) && !source.contact) errors.push(`${location}.contact is required before review or activation`);
    if (typeof source.relevance !== "string" || !source.relevance.trim() || source.relevance.length > 1200) {
      errors.push(`${location}.relevance must contain 1 to 1200 characters`);
    }
    if (!Array.isArray(source.topics) || source.topics.length === 0 || source.topics.length > 12) {
      errors.push(`${location}.topics must contain between one and twelve topics`);
    } else {
      const topics = new Set();
      for (const topic of source.topics) {
        if (!ID_PATTERN.test(topic)) errors.push(`${location}.topics contains invalid topic ${topic}`);
        if (topics.has(topic)) errors.push(`${location}.topics contains duplicate ${topic}`);
        topics.add(topic);
      }
    }
    if (source.language !== undefined && !LANGUAGE_PATTERN.test(source.language)) errors.push(`${location}.language is invalid`);
    if (source.maxItemsPerRun !== undefined && (!Number.isInteger(source.maxItemsPerRun) || source.maxItemsPerRun < 1 || source.maxItemsPerRun > 20)) {
      errors.push(`${location}.maxItemsPerRun must be an integer from 1 to 20`);
    }
    const hasRegistrantId = source.registrantGithubId !== undefined;
    const hasRegistrantLogin = source.registrantGithubLogin !== undefined;
    if (hasRegistrantId !== hasRegistrantLogin) errors.push(`${location} must provide both registrantGithubId and registrantGithubLogin`);
    if (hasRegistrantId && !/^\d+$/.test(String(source.registrantGithubId))) errors.push(`${location}.registrantGithubId must be numeric`);
    if (hasRegistrantLogin && !LOGIN_PATTERN.test(String(source.registrantGithubLogin))) errors.push(`${location}.registrantGithubLogin is invalid`);
    for (const field of ["registeredAt", "updatedAt"]) {
      if (source[field] !== undefined && !DATE_PATTERN.test(String(source[field]))) errors.push(`${location}.${field} must use YYYY-MM-DD`);
    }
  });
  return errors;
}
