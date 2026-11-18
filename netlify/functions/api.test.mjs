import assert from "node:assert/strict";
import test from "node:test";
import { createApiHandler } from "./api.mjs";
import { HttpError, readJsonBody } from "./lib/http.mjs";
import { createRateLimiter } from "./lib/rate-limit.mjs";
import { validateContactPayload } from "./lib/validation.mjs";

const validPayload = {
  name: "Test Sender",
  email: "sender@example.com",
  phone: "+1 (555) 123-4567",
  service: "Space Planning",
  message: "I would like to discuss a room redesign.",
  website: "",
};

function request(path, { method = "POST", body = validPayload, headers = {} } = {}) {
  const init = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`https://portfolio.example${path}`, init);
}

function createTestHandler(options = {}) {
  const saved = [];
  const handler = createApiHandler({
    createId: () => "test-message-id",
    now: () => new Date("2026-11-18T00:00:00.000Z"),
    persistMessage: async (message) => saved.push(message),
    ...options,
  });
  return { handler, saved };
}

test("valid contact request persists unread message before returning success", async () => {
  const { handler, saved } = createTestHandler();
  const response = await handler(request("/api/contact"), { ip: "192.0.2.1" });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    id: "test-message-id",
    name: "Test Sender",
    email: "sender@example.com",
    phone: "+1 (555) 123-4567",
    service: "Space Planning",
    message: "I would like to discuss a room redesign.",
    createdAt: "2026-11-18T00:00:00.000Z",
    unread: true,
  });
});

test("contact submission does not return success until persistence resolves", async () => {
  let finishWrite;
  const { handler } = createTestHandler({
    persistMessage: () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      }),
  });
  const pendingResponse = handler(request("/api/contact"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishWrite, "function");
  finishWrite();
  assert.equal((await pendingResponse).status, 201);
});

test("invalid contact fields are rejected without storage", async () => {
  const { handler, saved } = createTestHandler();
  const response = await handler(
    request("/api/contact", {
      body: { ...validPayload, name: "A" },
    }),
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "validation_failed",
    details: { name: "invalid_length" },
  });
  assert.equal(saved.length, 0);
});

test("email, phone, service, and message fields are validated", () => {
  const invalidCases = [
    ["email", { email: "not-an-email" }],
    ["phone", { phone: "call me" }],
    ["service", { service: "" }],
    ["message", { message: "Too short" }],
  ];

  for (const [field, values] of invalidCases) {
    assert.throws(
      () => validateContactPayload({ ...validPayload, ...values }),
      (error) =>
        error instanceof HttpError &&
        error.status === 422 &&
        Object.hasOwn(error.details, field),
      field,
    );
  }
});

test("honeypot submissions are rejected and never stored", async () => {
  const { handler, saved } = createTestHandler();
  const response = await handler(
    request("/api/contact", { body: { ...validPayload, website: "bot-filled" } }),
  );
  assert.equal(response.status, 422);
  assert.equal(saved.length, 0);
});

test("malformed JSON receives a client error", async () => {
  const { handler } = createTestHandler();
  const response = await handler(
    new Request("https://portfolio.example/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_json" });
});

test("unsupported methods receive 405 and Allow header", async () => {
  const { handler } = createTestHandler();
  const response = await handler(request("/api/contact", { method: "GET", body: undefined }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("unknown API routes receive 404", async () => {
  const { handler } = createTestHandler();
  const response = await handler(request("/api/unknown"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: "not_found" });
});

test("API dispatches authentication paths to the auth service", async () => {
  const handler = createApiHandler({
    authHandler: async () => new Response('{"ok":true,"auth":true}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const response = await handler(
    request("/api/auth/login", { body: { email: "a@example.test", password: "x" } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, auth: true });
});

test("API applies the per-instance limit to repeated client submissions", async () => {
  const { handler, saved } = createTestHandler({
    rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
  });
  const first = await handler(request("/api/contact"), { ip: "192.0.2.2" });
  const second = await handler(request("/api/contact"), { ip: "192.0.2.2" });
  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(saved.length, 1);
});

test("oversized request bodies and unsupported media types are rejected", async () => {
  await assert.rejects(
    readJsonBody(
      new Request("https://portfolio.example/api/contact", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "20000",
        },
        body: "{}",
      }),
      16 * 1024,
    ),
    (error) => error instanceof HttpError && error.status === 413,
  );

  const { handler } = createTestHandler();
  const response = await handler(
    request("/api/contact", { headers: { "content-type": "text/plain" } }),
  );
  assert.equal(response.status, 415);
});

test("storage failures return an error and never success", async () => {
  const { handler, saved } = createTestHandler({
    persistMessage: async () => {
      throw new Error("simulated storage failure");
    },
  });
  const response = await handler(request("/api/contact"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "storage_unavailable",
  });
  assert.equal(saved.length, 0);
});

test("per-instance rate limiter blocks excess submissions", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.isAllowed("client", 100), true);
  assert.equal(limiter.isAllowed("client", 200), true);
  assert.equal(limiter.isAllowed("client", 300), false);
  assert.equal(limiter.isAllowed("client", 1200), true);
});

test("validation returns only explicitly supported contact fields", () => {
  assert.deepEqual(
    validateContactPayload({ ...validPayload, ignored: "not stored" }),
    {
      name: validPayload.name,
      email: validPayload.email,
      phone: validPayload.phone,
      service: validPayload.service,
      message: validPayload.message,
    },
  );
});
