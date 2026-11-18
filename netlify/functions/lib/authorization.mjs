import { HttpError } from "./http.mjs";

export function createAdminAuthorizer(resolveSession, verifyCsrf) {
  if (typeof resolveSession !== "function") {
    throw new TypeError("resolveSession must be a function");
  }

  return async function requireAdmin(request, context, { stateChanging = false } = {}) {
    const session = await resolveSession(request, context);
    if (!session || session.role !== "admin") {
      throw new HttpError(401, "unauthorized");
    }
    if (stateChanging) {
      if (typeof verifyCsrf !== "function") {
        throw new HttpError(500, "csrf_not_configured");
      }
      await verifyCsrf(request, session);
    }
    return session;
  };
}
