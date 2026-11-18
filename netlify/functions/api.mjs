import { randomUUID } from "node:crypto";
import { createAuthService, isAuthApiPath } from "./lib/auth.mjs";
import { errorResponse, HttpError, jsonResponse, readJsonBody } from "./lib/http.mjs";
import { createRateLimiter } from "./lib/rate-limit.mjs";
import { saveContactMessage } from "./lib/storage.mjs";
import { validateContactPayload } from "./lib/validation.mjs";

const MAX_BODY_BYTES = 16 * 1024;
const CONTACT_PATHS = new Set([
  "/api/contact",
  "/contact",
  "/.netlify/functions/api/contact",
]);
const authService = createAuthService();

export function createApiHandler({
  persistMessage = saveContactMessage,
  authHandler = authService.handle,
  rateLimiter = createRateLimiter(),
  createId = randomUUID,
  now = () => new Date(),
} = {}) {
  return async function handleApiRequest(request, context = {}) {
    try {
      if (isAuthApiPath(request)) {
        return authHandler(request, context);
      }

      const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
      if (!CONTACT_PATHS.has(pathname)) {
        throw new HttpError(404, "not_found");
      }
      if (request.method !== "POST") {
        throw new HttpError(405, "method_not_allowed", undefined, {
          Allow: "POST",
        });
      }

      const payload = await readJsonBody(request, MAX_BODY_BYTES);
      const contact = validateContactPayload(payload);
      if (context.ip && !rateLimiter.isAllowed(context.ip)) {
        throw new HttpError(429, "rate_limited");
      }

      const message = {
        id: createId(),
        ...contact,
        createdAt: now().toISOString(),
        unread: true,
      };

      try {
        await persistMessage(message);
      } catch (error) {
        console.error(
          "Contact message storage failed",
          error instanceof Error ? error.name : "UnknownError",
        );
        throw new HttpError(503, "storage_unavailable");
      }

      return jsonResponse({ ok: true }, 201);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

const handler = createApiHandler();

export default function api(request, context) {
  return handler(request, context);
}
