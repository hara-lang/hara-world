import { requiredEnv } from "./env.mjs";

const FIRST_HOST_LABEL = /^[^.]+\./;
const DEFAULT_TIMEOUT_MS = 10_000;

export class NeonHttpError extends Error {
  constructor(message, { status = 500, code, detail, hint } = {}) {
    super(message);
    this.name = "NeonHttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.hint = hint;
  }
}

export function neonFetchEndpoint(connectionString) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.username
    || !parsed.hostname
    || !parsed.pathname
  ) {
    throw new Error("DATABASE_URL must be a complete PostgreSQL connection string.");
  }

  if (!FIRST_HOST_LABEL.test(parsed.hostname)) {
    throw new Error("DATABASE_URL does not contain a supported Neon hostname.");
  }

  const apiHost = parsed.hostname.replace(FIRST_HOST_LABEL, "api.");
  return `https://${apiHost}/sql`;
}

function prepareParameter(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) {
    return JSON.stringify(value);
  }
  throw new TypeError(`Unsupported PostgreSQL parameter type: ${typeof value}`);
}

function mapResult(result = {}) {
  const fields = Array.isArray(result.fields) ? result.fields : [];
  const names = fields.map((field) => field.name);
  const rows = Array.isArray(result.rows)
    ? result.rows.map((row) => {
        if (!Array.isArray(row)) return row;
        return Object.fromEntries(row.map((value, index) => [names[index] ?? String(index), value]));
      })
    : [];

  return {
    command: result.command ?? null,
    fields,
    rowCount: Number(result.rowCount ?? rows.length),
    rows
  };
}

function queryDatum(query) {
  if (typeof query === "string") return { query, params: [] };
  if (!query || typeof query.text !== "string") {
    throw new TypeError("A query must be a SQL string or { text, params } object.");
  }
  return {
    query: query.text,
    params: (query.params ?? []).map(prepareParameter)
  };
}

export function createNeonHttpClient(
  connectionString,
  { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const endpoint = neonFetchEndpoint(connectionString);

  async function execute(payload, batchHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Neon-Connection-String": connectionString,
          "Neon-Raw-Text-Output": "true",
          "Neon-Array-Mode": "true",
          ...batchHeaders
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const raw = await response.text();
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }

      if (!response.ok) {
        throw new NeonHttpError(
          body?.message || `Neon query failed with HTTP ${response.status}.`,
          {
            status: response.status,
            code: body?.code,
            detail: body?.detail,
            hint: body?.hint
          }
        );
      }

      return body;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new NeonHttpError("Neon query timed out.", { status: 504 });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    endpoint,

    async query(text, params = []) {
      if (typeof text !== "string" || !text.trim()) throw new TypeError("SQL text is required.");
      const result = await execute(queryDatum({ text, params }));
      return mapResult(result);
    },

    async transaction(queries, { isolationLevel = "Serializable", readOnly = false } = {}) {
      if (!Array.isArray(queries) || queries.length === 0) {
        throw new TypeError("transaction() requires at least one query.");
      }
      const result = await execute(
        { queries: queries.map(queryDatum) },
        {
          "Neon-Batch-Isolation-Level": isolationLevel,
          "Neon-Batch-Read-Only": String(readOnly)
        }
      );
      if (!Array.isArray(result?.results)) {
        throw new NeonHttpError("Neon returned an unexpected transaction response.");
      }
      return result.results.map(mapResult);
    }
  };
}

export function getDatabase(options) {
  return createNeonHttpClient(requiredEnv("DATABASE_URL"), options);
}
