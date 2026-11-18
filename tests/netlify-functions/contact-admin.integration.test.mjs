import assert from "node:assert/strict";
import test from "node:test";
import { createApiHandler } from "../../netlify/functions/api.mjs";
import { createAdminApiService } from "../../netlify/functions/lib/admin.mjs";
import { HttpError } from "../../netlify/functions/lib/http.mjs";

class ContactMessageStore {
  constructor() {
    this.messages = new Map();
  }

  async *list({ prefix }) {
    yield {
      blobs: [...this.messages.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key, etag: "test-etag" })),
    };
  }

  async get(key) {
    const value = this.messages.get(key);
    return value ? structuredClone(value) : null;
  }
}

function request(path, { method = "GET", body, authenticated = false } = {}) {
  const headers = {};
  if (authenticated) headers["x-test-admin"] = "true";
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://portfolio.example${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("public contact submission is stored and visible in authenticated admin reads", async () => {
  const store = new ContactMessageStore();
  const admin = createAdminApiService({
    getMessageStore: () => store,
    requireAdmin: async (req) => {
      if (req.headers.get("x-test-admin") !== "true") {
        throw new HttpError(401, "unauthorized");
      }
      return { role: "admin", email: "test-admin@example.test" };
    },
  });
  const api = createApiHandler({
    adminHandler: admin.handle,
    createId: () => "1c86b2e8-fb4a-4f3d-9f66-090c8b23f5c1",
    now: () => new Date("2026-11-18T07:00:00.000Z"),
    persistMessage: async (message) => {
      store.messages.set(`messages/${message.id}`, structuredClone(message));
    },
  });

  const submission = await api(
    request("/api/contact", {
      method: "POST",
      body: {
        name: "Test Sender",
        email: "sender@example.test",
        phone: "",
        service: "Space Planning",
        message: "Please help me plan a living room.",
        website: "",
      },
    }),
  );
  assert.equal(submission.status, 201);
  assert.deepEqual(await submission.json(), { ok: true });

  const inbox = await api(
    request("/api/admin/messages?search=living%20room", {
      authenticated: true,
    }),
  );
  assert.equal(inbox.status, 200);
  const inboxBody = await inbox.json();
  assert.equal(inboxBody.total, 1);
  assert.equal(inboxBody.messages[0].name, "Test Sender");
  assert.equal(inboxBody.messages[0].unread, true);

  const dashboard = await api(
    request("/api/admin/dashboard", { authenticated: true }),
  );
  assert.deepEqual((await dashboard.json()).stats, {
    total: 1,
    unread: 1,
    read: 0,
  });
});
