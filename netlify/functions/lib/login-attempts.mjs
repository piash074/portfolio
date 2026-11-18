import { HttpError } from "./http.mjs";
import { RECORD_KEYS } from "./storage.mjs";

export const LOGIN_LOCKOUT_LIMIT = 5;
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

function isValidRecord(record) {
  return (
    record &&
    Number.isInteger(record.failures) &&
    record.failures >= 1 &&
    Number.isFinite(record.windowStartedAt) &&
    Number.isFinite(record.lockedUntil)
  );
}

export function createLoginAttemptProtection({
  store,
  now = () => Date.now(),
  maxFailures = LOGIN_LOCKOUT_LIMIT,
  windowMs = LOGIN_LOCKOUT_WINDOW_MS,
  maxRetries = 8,
} = {}) {
  if (!store) throw new TypeError("A Netlify Blobs store is required");

  async function read(scope) {
    const result = await store.getWithMetadata(RECORD_KEYS.loginAttempt(scope), {
      type: "json",
      consistency: "strong",
    });
    if (result && !isValidRecord(result.data)) {
      throw new Error("Invalid login-attempt record");
    }
    return result;
  }

  return {
    async assertAllowed(scope) {
      const current = await read(scope);
      if (current && current.data.lockedUntil > now()) {
        throw new HttpError(429, "too_many_attempts");
      }
    },

    async recordFailure(scope) {
      const key = RECORD_KEYS.loginAttempt(scope);
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const current = await read(scope);
        const timestamp = now();
        if (current && current.data.lockedUntil > timestamp) {
          return true;
        }

        const isExpired =
          !current ||
          current.data.lockedUntil > 0 ||
          timestamp - current.data.windowStartedAt >= windowMs;
        const windowStartedAt = isExpired
          ? timestamp
          : current.data.windowStartedAt;
        const failures = isExpired ? 1 : current.data.failures + 1;
        const locked = failures >= maxFailures;
        const next = {
          failures,
          windowStartedAt,
          lockedUntil: locked ? timestamp + windowMs : 0,
        };
        const options = current
          ? { onlyIfMatch: current.etag }
          : { onlyIfNew: true };
        if (current && !current.etag) {
          throw new Error("Login-attempt record is missing its ETag");
        }

        const result = await store.set(key, JSON.stringify(next), options);
        if (result.modified) return locked;
      }
      throw new Error("Could not update login-attempt record");
    },

    async clear(scope) {
      await store.delete(RECORD_KEYS.loginAttempt(scope));
    },
  };
}
