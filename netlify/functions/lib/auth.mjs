import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createAdminAuthorizer } from "./authorization.mjs";
import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
} from "./http.mjs";
import { createLoginAttemptProtection } from "./login-attempts.mjs";
import {
  getAdminStore,
  getAuthAttemptStore,
  getSessionStore,
  readJsonRecord,
  RECORD_KEYS,
  writeJsonRecord,
} from "./storage.mjs";
import {
  validateAdminLoginPayload,
  validateAdminSetupPayload,
} from "./validation.mjs";

const scrypt = promisify(scryptCallback);
const MAX_AUTH_BODY_BYTES = 4096;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE = "portfolio_session";
const CSRF_COOKIE = "portfolio_csrf";
const PRIMARY_ADMIN_KEY = RECORD_KEYS.admin("primary");
const AUTH_PATHS = new Set([
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
]);

function normalizedPath(request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const functionPrefix = "/.netlify/functions/api";
  if (pathname === functionPrefix) return "/api";
  if (pathname.startsWith(`${functionPrefix}/`)) {
    return `/api${pathname.slice(functionPrefix.length)}`;
  }
  return pathname;
}

export function isAuthApiPath(request) {
  return AUTH_PATHS.has(normalizedPath(request));
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secretDigest(value) {
  return sha256(value);
}

function matchesSetupToken(provided, expected) {
  return timingSafeEqual(secretDigest(provided), secretDigest(expected));
}

function getSigningSecret(env) {
  const value = env.SESSION_SIGNING_SECRET;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) {
    throw new HttpError(503, "auth_not_configured");
  }
  return Buffer.from(value, "utf8");
}

function getSetupSecret(env) {
  const value = env.ADMIN_SETUP_TOKEN;
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32) {
    throw new HttpError(503, "setup_not_configured");
  }
  return value;
}

function parseCookieHeader(header, name) {
  if (!header) return null;
  let value = null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    if (value !== null) return null;
    value = part.slice(separator + 1).trim();
  }
  return value;
}

function secureCookies(request, context, env) {
  const deployContext = context?.deploy?.context || env.CONTEXT;
  return (
    new URL(request.url).protocol === "https:" ||
    env.NODE_ENV === "production" ||
    (typeof deployContext === "string" && deployContext !== "dev")
  );
}

function serializeCookie(name, value, maxAge, { secure, httpOnly = false } = {}) {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Strict",
    ...(httpOnly ? ["HttpOnly"] : []),
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function responseWithCookies(body, status, cookies) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return jsonResponse(body, status, headers);
}

function clearSessionCookies(request, context, env) {
  const secure = secureCookies(request, context, env);
  return [
    serializeCookie(SESSION_COOKIE, "", 0, { secure, httpOnly: true }),
    serializeCookie(CSRF_COOKIE, "", 0, { secure }),
  ];
}

function sessionCookieValue(request) {
  return parseCookieHeader(request.headers.get("cookie"), SESSION_COOKIE);
}

function signedToken(token, signingSecret) {
  return createHmac("sha256", signingSecret).update(token).digest("base64url");
}

function tokenHash(token) {
  return sha256(token).toString("hex");
}

function isSignedTokenValid(value, signingSecret) {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{40,50}$/.test(parts[1])
  ) {
    return false;
  }
  return constantTimeEqual(parts[1], signedToken(parts[0], signingSecret));
}

function validateSessionRecord(record) {
  return (
    record &&
    typeof record.adminId === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    Number.isFinite(Date.parse(record.expiresAt)) &&
    Date.parse(record.expiresAt) > Date.parse(record.createdAt) &&
    /^[a-f0-9]{64}$/.test(record.csrfTokenHash)
  );
}

function validateAdminRecord(record) {
  return (
    record &&
    typeof record.id === "string" &&
    typeof record.email === "string" &&
    typeof record.passwordHash === "string" &&
    record.disabled === false
  );
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encodedHash) {
  if (typeof encodedHash !== "string") return false;
  const [algorithm, n, r, p, saltValue, hashValue, extra] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== "32768" ||
    r !== "8" ||
    p !== "1" ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]{22}$/.test(saltValue || "") ||
    !/^[A-Za-z0-9_-]{86}$/.test(hashValue || "")
  ) {
    return false;
  }

  const expected = Buffer.from(hashValue, "base64url");
  const derived = Buffer.from(
    await scrypt(password, Buffer.from(saltValue, "base64url"), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
  );
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function ensureSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      throw new HttpError(403, "origin_not_allowed");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, "origin_not_allowed");
  }
}

export function createAuthService({
  env = process.env,
  stores = {
    admins: getAdminStore,
    sessions: getSessionStore,
    attempts: getAuthAttemptStore,
  },
  now = () => Date.now(),
  createId = randomUUID,
} = {}) {
  async function storageOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error(
        "Authentication storage operation failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      throw new HttpError(503, "auth_storage_unavailable");
    }
  }

  async function attemptProtection() {
    const store = await storageOperation(() => stores.attempts());
    return createLoginAttemptProtection({ store, now });
  }

  async function getAdmin() {
    const store = await storageOperation(() => stores.admins());
    return storageOperation(() => readJsonRecord(store, PRIMARY_ADMIN_KEY));
  }

  async function resolveSession(request) {
    const cookieValue = sessionCookieValue(request);
    if (!cookieValue) return null;
    const signingSecret = getSigningSecret(env);
    if (!isSignedTokenValid(cookieValue, signingSecret)) return null;

    const token = cookieValue.slice(0, cookieValue.lastIndexOf("."));
    const hash = tokenHash(token);
    const sessionStore = await storageOperation(() => stores.sessions());
    const session = await storageOperation(() =>
      readJsonRecord(sessionStore, RECORD_KEYS.session(hash), {
        consistency: "strong",
      }),
    );
    if (!session) return null;
    if (!validateSessionRecord(session)) {
      throw new HttpError(503, "auth_storage_unavailable");
    }

    if (Date.parse(session.expiresAt) <= now()) {
      await storageOperation(() =>
        sessionStore.delete(RECORD_KEYS.session(hash)),
      );
      return null;
    }

    const admin = await getAdmin();
    if (
      !validateAdminRecord(admin) ||
      admin.id !== session.adminId
    ) {
      await storageOperation(() =>
        sessionStore.delete(RECORD_KEYS.session(hash)),
      );
      return null;
    }

    return {
      adminId: admin.id,
      email: admin.email,
      role: "admin",
      sessionHash: hash,
      csrfTokenHash: session.csrfTokenHash,
      expiresAt: session.expiresAt,
    };
  }

  function verifyCsrf(request, session) {
    const cookie = parseCookieHeader(
      request.headers.get("cookie"),
      CSRF_COOKIE,
    );
    const header = request.headers.get("x-csrf-token");
    if (
      !constantTimeEqual(cookie, header) ||
      !constantTimeEqual(
        sha256(cookie || "").toString("hex"),
        session.csrfTokenHash,
      )
    ) {
      throw new HttpError(403, "csrf_failed");
    }
  }

  const requireAdmin = createAdminAuthorizer(resolveSession, verifyCsrf);

  async function createSession(admin, request, context, signingSecret) {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const hash = tokenHash(token);
    const createdAt = new Date(now());
    const expiresAt = new Date(
      createdAt.getTime() + SESSION_TTL_SECONDS * 1000,
    );
    const session = {
      adminId: admin.id,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      csrfTokenHash: sha256(csrfToken).toString("hex"),
    };
    const store = await storageOperation(() => stores.sessions());
    const result = await storageOperation(() =>
      writeJsonRecord(store, RECORD_KEYS.session(hash), session, {
        onlyIfNew: true,
      }),
    );
    if (!result || result.modified !== true) {
      throw new HttpError(503, "auth_storage_unavailable");
    }

    const secure = secureCookies(request, context, env);
    return [
      serializeCookie(
        SESSION_COOKIE,
        `${token}.${signedToken(token, signingSecret)}`,
        SESSION_TTL_SECONDS,
        { secure, httpOnly: true },
      ),
      serializeCookie(CSRF_COOKIE, csrfToken, SESSION_TTL_SECONDS, { secure }),
    ];
  }

  async function setup(request, context) {
    ensureSameOrigin(request);
    const signingSecret = getSigningSecret(env);
    const setupSecret = getSetupSecret(env);
    const payload = validateAdminSetupPayload(
      await readJsonBody(request, MAX_AUTH_BODY_BYTES),
    );
    const protection = await attemptProtection();
    const adminStore = await storageOperation(() => stores.admins());
    const existing = await storageOperation(() =>
      readJsonRecord(adminStore, PRIMARY_ADMIN_KEY),
    );
    if (existing) throw new HttpError(409, "setup_complete");

    await storageOperation(() => protection.assertAllowed("setup"));
    if (!matchesSetupToken(payload.setupToken, setupSecret)) {
      const locked = await storageOperation(() =>
        protection.recordFailure("setup"),
      );
      if (locked) throw new HttpError(429, "too_many_attempts");
      throw new HttpError(401, "setup_token_invalid");
    }

    const createdAt = new Date(now()).toISOString();
    const admin = {
      id: createId(),
      email: payload.email,
      passwordHash: await hashPassword(payload.password),
      createdAt,
      updatedAt: createdAt,
      disabled: false,
    };
    const result = await storageOperation(() =>
      writeJsonRecord(adminStore, PRIMARY_ADMIN_KEY, admin, {
        onlyIfNew: true,
      }),
    );
    if (!result || result.modified !== true) {
      throw new HttpError(409, "setup_complete");
    }
    await storageOperation(() => protection.clear("setup"));

    const cookies = await createSession(
      admin,
      request,
      context,
      signingSecret,
    );
    return responseWithCookies(
      { ok: true, authenticated: true },
      201,
      cookies,
    );
  }

  async function login(request, context) {
    ensureSameOrigin(request);
    const signingSecret = getSigningSecret(env);
    const payload = validateAdminLoginPayload(
      await readJsonBody(request, MAX_AUTH_BODY_BYTES),
    );
    const protection = await attemptProtection();
    await storageOperation(() => protection.assertAllowed("login"));

    const admin = await getAdmin();
    if (!admin) throw new HttpError(503, "admin_not_setup");
    const passwordMatches = await verifyPassword(
      payload.password,
      admin.passwordHash,
    );
    if (
      !validateAdminRecord(admin) ||
      admin.email !== payload.email ||
      !passwordMatches
    ) {
      const locked = await storageOperation(() =>
        protection.recordFailure("login"),
      );
      if (locked) throw new HttpError(429, "too_many_attempts");
      throw new HttpError(401, "invalid_credentials");
    }

    await storageOperation(() => protection.clear("login"));
    const cookies = await createSession(admin, request, context, signingSecret);
    return responseWithCookies(
      { ok: true, authenticated: true },
      200,
      cookies,
    );
  }

  async function currentSession(request, context) {
    const session = await resolveSession(request);
    if (!session) {
      const hasSessionCookie =
        parseCookieHeader(request.headers.get("cookie"), SESSION_COOKIE) !==
        null;
      if (hasSessionCookie) {
        return responseWithCookies(
          { ok: true, authenticated: false },
          200,
          clearSessionCookies(request, context, env),
        );
      }
      return jsonResponse(
        { ok: true, authenticated: false },
        200,
      );
    }
    return jsonResponse({ ok: true, authenticated: true });
  }

  async function logout(request, context) {
    ensureSameOrigin(request);
    await readJsonBody(request, MAX_AUTH_BODY_BYTES);
    const session = await requireAdmin(request, context, {
      stateChanging: true,
    });
    const store = await storageOperation(() => stores.sessions());
    await storageOperation(() =>
      store.delete(RECORD_KEYS.session(session.sessionHash)),
    );
    return responseWithCookies(
      { ok: true, authenticated: false },
      200,
      clearSessionCookies(request, context, env),
    );
  }

  async function handle(request, context = {}) {
    try {
      const path = normalizedPath(request);
      if (!AUTH_PATHS.has(path)) throw new HttpError(404, "not_found");

      const methods = {
        "/api/auth/setup": "POST",
        "/api/auth/login": "POST",
        "/api/auth/logout": "POST",
        "/api/auth/session": "GET",
      };
      if (request.method !== methods[path]) {
        throw new HttpError(405, "method_not_allowed", undefined, {
          Allow: methods[path],
        });
      }

      if (path === "/api/auth/session") {
        return await currentSession(request, context);
      }

      if (path === "/api/auth/logout") {
        return await logout(request, context);
      }

      if (path === "/api/auth/setup") {
        return await setup(request, context);
      }
      return await login(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { handle, requireAdmin, resolveSession };
}
