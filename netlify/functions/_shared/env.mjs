export function getEnv(name, fallback = undefined) {
  const netlifyValue = globalThis.Netlify?.env?.get?.(name);
  const value = netlifyValue ?? process.env[name];
  return value === undefined || value === null || value === "" ? fallback : value;
}

export function requiredEnv(name) {
  const value = getEnv(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function envFlag(name, fallback = false) {
  const value = getEnv(name);
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
