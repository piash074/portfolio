export function createRateLimiter({ limit = 5, windowMs = 60 * 60 * 1000 } = {}) {
  const requestsByKey = new Map();
  const maxTrackedKeys = 5000;

  return {
    isAllowed(key, now = Date.now()) {
      if (!key) return true;

      const recent = (requestsByKey.get(key) || []).filter(
        (timestamp) => now - timestamp < windowMs,
      );
      if (recent.length >= limit) {
        requestsByKey.set(key, recent);
        return false;
      }

      recent.push(now);
      requestsByKey.delete(key);
      requestsByKey.set(key, recent);
      if (requestsByKey.size > maxTrackedKeys) {
        requestsByKey.delete(requestsByKey.keys().next().value);
      }
      return true;
    },
  };
}
