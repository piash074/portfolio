import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { createAuthService, isAuthApiPath } from "../../../netlify/functions/lib/auth.mjs";
import { HttpError } from "../../../netlify/functions/lib/http.mjs";

class MemoryBlobsStore {
  constructor() {
    this.values = new Map();
    this.sequence = 0;
    this.failGet = false;
    this.failSet = false;
    this.failDelete = false;
  }

  async get(key) {
    if (this.failGet) throw new Error("storage read failed");
    const record = this.values.get(key);
    return record ? JSON.parse(record.value) : null;
  }

  async getWithMetadata(key) {
    if (this.failGet) throw new Error("storage read failed");
    const record = this.values.get(key);
    return record
      ? { data: JSON.parse(record.value), etag: record.etag, metadata: {} }
      : null;
  }

  async set(key, value, options = {}) {
    if (this.failSet) throw new Error("storage write failed");
    const current = this.values.get(key);
    if (options.onlyIfNew && current) return { modified: false };
    if (options.onlyIfMatch && current?.etag !== options.onlyIfMatch) {
      return { modified: false };
    }
    const etag = `etag-${++this.sequence}`;
    this.values.set(key, { value, etag });
    return { modified: true, etag };
  }

  async delete(key) {
    if (this.failDelete) throw new Error("storage delete failed");
    this.values.delete(key);
  }
}

function createFixture() {
  const credentials = {
    signingSecret: randomBytes(32).toString("base64url"),
    setupToken: randomBytes(32).toString("base64url"),
    password: randomBytes(24).toString("base64url"),
    email: `admin-${randomUUID()}@example.test`,
  };
  const stores = {
    admins: new MemoryBlobsStore(),
    sessions: new MemoryBlobsStore(),
    attempts: new MemoryBlobsStore(),
  };
  let timestamp = Date.parse("2026-11-18T00:00:00.000Z");
  const service = createAuthService({
    env: {
      SESSION_SIGNING_SECRET: credentials.signingSecret,
      ADMIN_SETUP_TOKEN: credentials.setupToken,
    },
    stores: {
      admins: () => stores.admins,
      sessions: () => stores.sessions,
      attempts: () => stores.attempts,
    },
    now: () => timestamp,
  });
  return {
    credentials,
    service,
    stores,
    advanceTime(milliseconds) {
      timestamp += milliseconds;
    },
  };
}

function jsonRequest(path, {
  method = "POST",
  body = {},
  headers = {},
  origin = null,
} = {}) {
  const requestHeaders = {
    "content-type": "application/json",
    ...headers,
  };
  if (origin) requestHeaders.origin = origin;
  return new Request(`https://portfolio.example${path}`, {
    method,
    headers: requestHeaders,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: JSON.stringify(body) }),
  });
}

async function setupAdmin(fixture) {
  const { credentials, service } = fixture;
  const response = await service.handle(
    jsonRequest("/api/auth/setup", {
      body: {
        setupToken: credentials.setupToken,
        email: credentials.email,
        password: credentials.password,
      },
    }),
  );
  assert.equal(response.status, 201);
  return response;
}

function cookiesFrom(response) {
  const cookies = response.headers.getSetCookie();
  const sessionCookie = cookies.find((cookie) =>
    cookie.startsWith("portfolio_session="),
  );
  const csrfCookie = cookies.find((cookie) =>
    cookie.startsWith("portfolio_csrf="),
  );
  assert.ok(sessionCookie);
  assert.ok(csrfCookie);
  return {
    sessionValue: sessionCookie.split(";", 1)[0].slice("portfolio_session=".length),
    csrfValue: csrfCookie.split(";", 1)[0].slice("portfolio_csrf=".length),
    header: `${sessionCookie.split(";", 1)[0]}; ${csrfCookie.split(";", 1)[0]}`,
    all: cookies,
  };
}

test("one-time setup hashes the password and creates a session without exposing secrets", async () => {
  const fixture = createFixture();
  const response = await setupAdmin(fixture);
  const body = await response.json();
  const admin = JSON.parse(
    fixture.stores.admins.values.get("admins/primary").value,
  );
  const cookies = cookiesFrom(response);

  assert.deepEqual(body, { ok: true, authenticated: true });
  assert.notEqual(admin.passwordHash, fixture.credentials.password);
  assert.match(admin.passwordHash, /^scrypt\$32768\$8\$1\$/);
  assert.equal(Object.hasOwn(admin, "password"), false);
  assert.equal(Object.hasOwn(body, "passwordHash"), false);
  assert.equal(Object.hasOwn(body, "sessionToken"), false);
  assert.equal(fixture.stores.sessions.values.size, 1);
  assert.equal(cookies.sessionValue.includes("."), true);
  const [sessionKey, sessionRecord] = [
    ...fixture.stores.sessions.values.entries(),
  ][0];
  assert.match(sessionKey, /^sessions\/[a-f0-9]{64}$/);
  assert.equal(sessionRecord.value.includes(cookies.sessionValue), false);

  const repeatedSetup = await fixture.service.handle(
    jsonRequest("/api/auth/setup", {
      body: {
        setupToken: fixture.credentials.setupToken,
        email: fixture.credentials.email,
        password: fixture.credentials.password,
      },
    }),
  );
  assert.equal(repeatedSetup.status, 409);
  assert.equal(fixture.stores.admins.values.size, 1);
});

test("valid login creates a fresh signed session", async () => {
  const fixture = createFixture();
  await setupAdmin(fixture);
  const response = await fixture.service.handle(
    jsonRequest("/api/auth/login", {
      body: {
        email: fixture.credentials.email,
        password: fixture.credentials.password,
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    authenticated: true,
  });
  assert.equal(fixture.stores.sessions.values.size, 2);
  assert.equal(cookiesFrom(response).sessionValue.length > 80, true);
});

test("invalid passwords fail without creating a session", async () => {
  const fixture = createFixture();
  await setupAdmin(fixture);
  const response = await fixture.service.handle(
    jsonRequest("/api/auth/login", {
      body: {
        email: fixture.credentials.email,
        password: randomBytes(24).toString("base64url"),
      },
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "invalid_credentials",
  });
  assert.equal(fixture.stores.sessions.values.size, 1);
});

test("missing credentials, invalid methods, content types, and oversized bodies are rejected", async () => {
  const fixture = createFixture();
  const missingSetup = await fixture.service.handle(
    jsonRequest("/api/auth/setup", { body: {} }),
  );
  assert.equal(missingSetup.status, 422);

  const missing = await fixture.service.handle(
    jsonRequest("/api/auth/login", { body: { email: fixture.credentials.email } }),
  );
  assert.equal(missing.status, 422);

  const wrongMethod = await fixture.service.handle(
    jsonRequest("/api/auth/login", { method: "GET" }),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const wrongType = await fixture.service.handle(
    jsonRequest("/api/auth/login", {
      headers: { "content-type": "text/plain" },
    }),
  );
  assert.equal(wrongType.status, 415);

  const oversized = await fixture.service.handle(
    new Request("https://portfolio.example/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "5000",
      },
      body: "{}",
    }),
  );
  assert.equal(oversized.status, 413);
});

test("current-session endpoint verifies a signed, stored session", async () => {
  const fixture = createFixture();
  const login = await setupAdmin(fixture);
  const cookies = cookiesFrom(login);
  const response = await fixture.service.handle(
    jsonRequest("/api/auth/session", {
      method: "GET",
      headers: { cookie: cookies.header },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    authenticated: true,
  });
});

test("expired and tampered sessions are rejected and expired records removed", async () => {
  const fixture = createFixture();
  const login = await setupAdmin(fixture);
  const cookies = cookiesFrom(login);
  fixture.advanceTime(13 * 60 * 60 * 1000);

  const expired = await fixture.service.handle(
    jsonRequest("/api/auth/session", {
      method: "GET",
      headers: { cookie: cookies.header },
    }),
  );
  assert.deepEqual(await expired.json(), {
    ok: true,
    authenticated: false,
  });
  assert.equal(fixture.stores.sessions.values.size, 0);

  const lastCharacter = cookies.sessionValue.slice(-1);
  const tampered = `${cookies.sessionValue.slice(0, -1)}${lastCharacter === "a" ? "b" : "a"}`;
  const invalid = await fixture.service.handle(
    jsonRequest("/api/auth/session", {
      method: "GET",
      headers: {
        cookie: `portfolio_session=${tampered}`,
      },
    }),
  );
  assert.deepEqual(await invalid.json(), {
    ok: true,
    authenticated: false,
  });
});

test("logout requires CSRF and invalidates the session", async () => {
  const fixture = createFixture();
  const login = await setupAdmin(fixture);
  const cookies = cookiesFrom(login);
  const noCsrf = await fixture.service.handle(
    jsonRequest("/api/auth/logout", {
      body: {},
      headers: { cookie: cookies.header },
    }),
  );
  assert.equal(noCsrf.status, 403);
  assert.equal(fixture.stores.sessions.values.size, 1);

  const wrongCsrf = await fixture.service.handle(
    jsonRequest("/api/auth/logout", {
      body: {},
      headers: {
        cookie: cookies.header,
        "x-csrf-token": randomBytes(32).toString("base64url"),
      },
    }),
  );
  assert.equal(wrongCsrf.status, 403);
  assert.equal(fixture.stores.sessions.values.size, 1);

  const logout = await fixture.service.handle(
    jsonRequest("/api/auth/logout", {
      body: {},
      headers: {
        cookie: cookies.header,
        "x-csrf-token": cookies.csrfValue,
      },
    }),
  );
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), {
    ok: true,
    authenticated: false,
  });
  assert.equal(fixture.stores.sessions.values.size, 0);
  assert.ok(
    logout.headers
      .getSetCookie()
      .every((cookie) => cookie.includes("Max-Age=0")),
  );

  const afterLogout = await fixture.service.handle(
    jsonRequest("/api/auth/session", {
      method: "GET",
      headers: { cookie: cookies.header },
    }),
  );
  assert.deepEqual(await afterLogout.json(), {
    ok: true,
    authenticated: false,
  });
});

test("session cookies use HttpOnly, SameSite, and Secure attributes on HTTPS", async () => {
  const fixture = createFixture();
  const response = await setupAdmin(fixture);
  const [sessionCookie, csrfCookie] = response.headers.getSetCookie();

  assert.match(sessionCookie, /; HttpOnly/);
  assert.match(sessionCookie, /; Secure/);
  assert.match(sessionCookie, /; SameSite=Strict/);
  assert.match(sessionCookie, /; Path=\//);
  assert.doesNotMatch(csrfCookie, /; HttpOnly/);
  assert.match(csrfCookie, /; Secure/);
  assert.match(csrfCookie, /; SameSite=Strict/);
  assert.deepEqual(await response.json(), {
    ok: true,
    authenticated: true,
  });
});

test("local development cookies omit Secure only on an HTTP dev request", async () => {
  const fixture = createFixture();
  fixture.service = createAuthService({
    env: {
      SESSION_SIGNING_SECRET: fixture.credentials.signingSecret,
      ADMIN_SETUP_TOKEN: fixture.credentials.setupToken,
      CONTEXT: "dev",
      NODE_ENV: "development",
    },
    stores: {
      admins: () => fixture.stores.admins,
      sessions: () => fixture.stores.sessions,
      attempts: () => fixture.stores.attempts,
    },
  });
  const response = await fixture.service.handle(
    new Request("http://localhost:8888/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupToken: fixture.credentials.setupToken,
        email: fixture.credentials.email,
        password: fixture.credentials.password,
      }),
    }),
    { deploy: { context: "dev" } },
  );
  assert.equal(response.status, 201);
  assert.ok(
    response.headers.getSetCookie().every((cookie) => !cookie.includes("; Secure")),
  );
});

test("persistent lockout blocks repeated failures and expires", async () => {
  const fixture = createFixture();
  await setupAdmin(fixture);
  const login = () =>
    fixture.service.handle(
      jsonRequest("/api/auth/login", {
        body: {
          email: fixture.credentials.email,
          password: randomBytes(24).toString("base64url"),
        },
      }),
    );

  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal((await login()).status, 401);
  }
  assert.equal((await login()).status, 429);
  assert.equal((await login()).status, 429);

  fixture.advanceTime(15 * 60 * 1000 + 1);
  const valid = await fixture.service.handle(
    jsonRequest("/api/auth/login", {
      body: {
        email: fixture.credentials.email,
        password: fixture.credentials.password,
      },
    }),
  );
  assert.equal(valid.status, 200);
  assert.equal(fixture.stores.attempts.values.size, 0);
});

test("state-changing admin authorization requires the CSRF verifier", async () => {
  const fixture = createFixture();
  const login = await setupAdmin(fixture);
  const cookies = cookiesFrom(login);
  await assert.rejects(
    fixture.service.requireAdmin(
      jsonRequest("/api/admin/messages"),
      {},
    ),
    (error) => error instanceof HttpError && error.status === 401,
  );
  const request = jsonRequest("/api/admin/messages", {
    headers: { cookie: cookies.header },
  });

  await assert.rejects(
    fixture.service.requireAdmin(request, {}, { stateChanging: true }),
    (error) => error instanceof HttpError && error.status === 403,
  );

  const authorized = await fixture.service.requireAdmin(
    jsonRequest("/api/admin/messages", {
      headers: {
        cookie: cookies.header,
        "x-csrf-token": cookies.csrfValue,
      },
    }),
    {},
    { stateChanging: true },
  );
  assert.equal(authorized.role, "admin");
});

test("missing auth configuration and storage failures fail closed", async () => {
  const missingConfig = createAuthService({
    env: {},
    stores: {
      admins: () => new MemoryBlobsStore(),
      sessions: () => new MemoryBlobsStore(),
      attempts: () => new MemoryBlobsStore(),
    },
  });
  const unconfigured = await missingConfig.handle(
    jsonRequest("/api/auth/login"),
  );
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), {
    ok: false,
    error: "auth_not_configured",
  });

  const fixture = createFixture();
  const initialSetup = await setupAdmin(fixture);
  const initialCookies = cookiesFrom(initialSetup);
  fixture.stores.sessions.failSet = true;
  const failedWrite = await fixture.service.handle(
    jsonRequest("/api/auth/login", {
      body: {
        email: fixture.credentials.email,
        password: fixture.credentials.password,
      },
    }),
  );
  assert.equal(failedWrite.status, 503);
  assert.deepEqual(await failedWrite.json(), {
    ok: false,
    error: "auth_storage_unavailable",
  });

  fixture.stores.sessions.failSet = false;
  fixture.stores.sessions.failGet = true;
  const failedRead = await fixture.service.handle(
    jsonRequest("/api/auth/session", {
      method: "GET",
      headers: {
        cookie: initialCookies.header,
      },
    }),
  );
  assert.equal(failedRead.status, 503);
});

test("API auth paths include the Netlify function rewrite target", () => {
  assert.equal(
    isAuthApiPath(
      new Request(
        "https://portfolio.example/.netlify/functions/api/auth/session",
      ),
    ),
    true,
  );
});
