import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAdminApiService } from "../../../netlify/functions/lib/admin.mjs";
import { HttpError } from "../../../netlify/functions/lib/http.mjs";

const ids = {
  oldest: "00000000-0000-4000-8000-000000000001",
  middle: "00000000-0000-4000-8000-000000000002",
  newest: "00000000-0000-4000-8000-000000000003",
};

function message(id, createdAt, values = {}) {
  return {
    id,
    name: values.name || `Sender ${id.slice(-1)}`,
    email: values.email || `sender${id.slice(-1)}@example.test`,
    phone: "",
    service: values.service || "Interior design",
    message: values.message || "Please contact me about my project.",
    createdAt,
    unread: values.unread !== false,
  };
}

class MemoryMessageStore {
  constructor(messages = []) {
    this.values = new Map(
      messages.map((item, index) => [
        `messages/${item.id}`,
        { value: structuredClone(item), etag: `etag-${index}` },
      ]),
    );
    this.failList = false;
    this.failGet = false;
    this.failSet = false;
    this.failDelete = false;
  }

  async *list({ prefix }) {
    if (this.failList) throw new Error("list failed");
    const blobs = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, etag: this.values.get(key).etag }));
    yield { blobs };
  }

  async get(key) {
    if (this.failGet) throw new Error("get failed");
    const record = this.values.get(key);
    return record ? structuredClone(record.value) : null;
  }

  async getWithMetadata(key) {
    if (this.failGet) throw new Error("get failed");
    const record = this.values.get(key);
    return record
      ? { data: structuredClone(record.value), etag: record.etag, metadata: {} }
      : null;
  }

  async set(key, value, options = {}) {
    if (this.failSet) throw new Error("set failed");
    const current = this.values.get(key);
    if (!current || current.etag !== options.onlyIfMatch) {
      return { modified: false };
    }
    this.values.set(key, {
      value: JSON.parse(value),
      etag: `${current.etag}-next`,
    });
    return { modified: true };
  }

  async delete(key) {
    if (this.failDelete) throw new Error("delete failed");
    this.values.delete(key);
  }
}

function createFixture(messages = [
  message(ids.oldest, "2026-01-01T00:00:00.000Z", {
    name: "Oldest Sender",
    message: "I need a calm living room.",
    unread: false,
  }),
  message(ids.middle, "2026-03-01T00:00:00.000Z", {
    name: "Middle Sender",
    email: "needle@example.test",
  }),
  message(ids.newest, "2026-05-01T00:00:00.000Z", {
    name: "Newest Sender",
    message: "The <script>alert(1)</script> payload is plain text.",
  }),
]) {
  const store = new MemoryMessageStore(messages);
  const api = createAdminApiService({
    requireAdmin: async (request, _context, { stateChanging }) => {
      if (request.headers.get("x-admin") !== "yes") {
        throw new HttpError(401, "unauthorized");
      }
      if (
        stateChanging &&
        request.headers.get("x-csrf-token") !== "csrf-test"
      ) {
        throw new HttpError(403, "csrf_failed");
      }
      return { email: "admin@example.test", role: "admin" };
    },
    getMessageStore: () => store,
  });
  return { api, store };
}

function request(path, {
  method = "GET",
  body,
  authenticated = true,
  csrf = true,
} = {}) {
  const headers = {};
  if (authenticated) headers["x-admin"] = "yes";
  if (csrf) headers["x-csrf-token"] = "csrf-test";
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://portfolio.example${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(api, path, options) {
  const response = await api.handle(request(path, options));
  return { response, body: await response.json() };
}

test("dashboard and inbox APIs require an authenticated admin", async () => {
  const { api } = createFixture();
  for (const path of ["/api/admin/dashboard", "/api/admin/messages"]) {
    const { response, body } = await json(api, path, {
      authenticated: false,
    });
    assert.equal(response.status, 401);
    assert.deepEqual(body, { ok: false, error: "unauthorized" });
  }
});

test("dashboard reports actual counts, recent messages, and the admin account", async () => {
  const { api } = createFixture();
  const { response, body } = await json(api, "/api/admin/dashboard");
  assert.equal(response.status, 200);
  assert.deepEqual(body.stats, { total: 3, unread: 2, read: 1 });
  assert.equal(body.admin.email, "admin@example.test");
  assert.deepEqual(
    body.recentMessages.map((item) => item.id),
    [ids.newest, ids.middle, ids.oldest],
  );
});

test("message listing paginates and supports search, read filters, and sorting", async () => {
  const { api } = createFixture();
  const page = await json(
    api,
    "/api/admin/messages?page=2&limit=1&sort=newest",
  );
  assert.equal(page.response.status, 200);
  assert.equal(page.body.total, 3);
  assert.equal(page.body.pages, 3);
  assert.equal(page.body.messages[0].id, ids.middle);

  const searched = await json(
    api,
    "/api/admin/messages?search=NEEDLE&filter=unread",
  );
  assert.equal(searched.body.total, 1);
  assert.equal(searched.body.messages[0].id, ids.middle);
  for (const term of ["Middle Sender", "needle@example.test", "calm living room"]) {
    const result = await json(
      api,
      `/api/admin/messages?search=${encodeURIComponent(term)}`,
    );
    assert.ok(result.body.total > 0, `search should match ${term}`);
  }

  const filtered = await json(api, "/api/admin/messages?filter=read");
  assert.deepEqual(filtered.body.messages.map((item) => item.id), [ids.oldest]);

  const oldest = await json(api, "/api/admin/messages?sort=oldest&limit=2");
  assert.deepEqual(
    oldest.body.messages.map((item) => item.id),
    [ids.oldest, ids.middle],
  );
});

test("single message retrieval returns complete content as JSON data", async () => {
  const { api } = createFixture();
  const { response, body } = await json(
    api,
    `/api/admin/messages/${ids.newest}`,
  );
  assert.equal(response.status, 200);
  assert.equal(body.message.message, "The <script>alert(1)</script> payload is plain text.");
  assert.match(response.headers.get("content-type"), /application\/json/);
});

test("admin UI renders untrusted message content with text nodes", async () => {
  const script = await readFile(
    new URL("../../../site/assets/admin/admin.js", import.meta.url),
    "utf8",
  );
  assert.match(script, /textContent\s*=\s*message\.message/);
  assert.doesNotMatch(script, /\.innerHTML\b|insertAdjacentHTML\b/);
});

test("read status updates require CSRF and preserve the stored message", async () => {
  const { api, store } = createFixture();
  const denied = await json(api, `/api/admin/messages/${ids.newest}`, {
    method: "PATCH",
    body: { unread: false },
    csrf: false,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(store.values.get(`messages/${ids.newest}`).value.unread, true);

  const updated = await json(api, `/api/admin/messages/${ids.newest}`, {
    method: "PATCH",
    body: { unread: false },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.message.unread, false);
  assert.equal(store.values.get(`messages/${ids.newest}`).value.unread, false);

  const markedUnread = await json(api, `/api/admin/messages/${ids.newest}`, {
    method: "PATCH",
    body: { unread: true },
  });
  assert.equal(markedUnread.body.message.unread, true);
});

test("message deletion requires CSRF and removes only the requested record", async () => {
  const { api, store } = createFixture();
  const denied = await json(api, `/api/admin/messages/${ids.oldest}`, {
    method: "DELETE",
    csrf: false,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(store.values.size, 3);

  const deleted = await json(api, `/api/admin/messages/${ids.oldest}`, {
    method: "DELETE",
  });
  assert.deepEqual(deleted.body, { ok: true, deleted: true });
  assert.equal(store.values.size, 2);
});

test("empty inbox returns zero counts and an empty page", async () => {
  const { api } = createFixture([]);
  const dashboard = await json(api, "/api/admin/dashboard");
  const inbox = await json(api, "/api/admin/messages");
  assert.deepEqual(dashboard.body.stats, { total: 0, unread: 0, read: 0 });
  assert.deepEqual(dashboard.body.recentMessages, []);
  assert.deepEqual(inbox.body.messages, []);
  assert.equal(inbox.body.pages, 0);
});

test("invalid query parameters and read payloads are rejected", async () => {
  const { api } = createFixture();
  const invalidQuery = await json(
    api,
    "/api/admin/messages?page=0&filter=all",
  );
  assert.equal(invalidQuery.response.status, 422);
  const unexpectedQuery = await json(
    api,
    `/api/admin/messages/${ids.newest}?internal=true`,
  );
  assert.equal(unexpectedQuery.response.status, 422);

  const invalidPayload = await json(api, `/api/admin/messages/${ids.newest}`, {
    method: "PATCH",
    body: { unread: "false" },
  });
  assert.equal(invalidPayload.response.status, 422);
});

test("storage failures return an explicit service error", async () => {
  const { api, store } = createFixture();
  store.failList = true;
  const listing = await json(api, "/api/admin/messages");
  assert.equal(listing.response.status, 503);
  assert.deepEqual(listing.body, {
    ok: false,
    error: "message_storage_unavailable",
  });
});

test("expired sessions are rejected by the admin authorization boundary", async () => {
  const store = new MemoryMessageStore();
  const api = createAdminApiService({
    requireAdmin: async () => {
      throw new HttpError(401, "unauthorized");
    },
    getMessageStore: () => store,
  });
  const { response } = await json(api, "/api/admin/dashboard");
  assert.equal(response.status, 401);
});
