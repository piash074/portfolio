import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
} from "./http.mjs";
import {
  getContactMessageStore,
  readJsonRecord,
  RECORD_KEYS,
} from "./storage.mjs";
import {
  validateMessageId,
  validateMessageListQuery,
  validateMessageReadPayload,
} from "./validation.mjs";

const MESSAGE_PREFIX = "messages/";
const MAX_UPDATE_BODY_BYTES = 1024;
const MAX_RETAINED_MESSAGES = 50_000;
const MESSAGE_READ_CONCURRENCY = 20;
const MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedPath(request) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const functionPrefix = "/.netlify/functions/api";
  if (pathname === functionPrefix) return "/api";
  if (pathname.startsWith(`${functionPrefix}/`)) {
    return `/api${pathname.slice(functionPrefix.length)}`;
  }
  return pathname;
}

function validMessage(record, key) {
  return (
    record &&
    typeof record === "object" &&
    typeof record.id === "string" &&
    MESSAGE_ID_PATTERN.test(record.id) &&
    record.id === key.slice(MESSAGE_PREFIX.length) &&
    typeof record.name === "string" &&
    typeof record.email === "string" &&
    typeof record.phone === "string" &&
    typeof record.service === "string" &&
    typeof record.message === "string" &&
    typeof record.createdAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    typeof record.unread === "boolean"
  );
}

function summary(message) {
  return {
    id: message.id,
    name: message.name,
    email: message.email,
    service: message.service,
    createdAt: message.createdAt,
    unread: message.unread,
    preview: message.message.slice(0, 180),
  };
}

function compareMessages(sort) {
  return (left, right) => {
    const timeDifference =
      Date.parse(left.createdAt) - Date.parse(right.createdAt);
    const order = timeDifference || left.id.localeCompare(right.id);
    return sort === "newest" ? -order : order;
  };
}

function isWorse(left, right, compare) {
  return compare(left, right) > 0;
}

function pushBest(heap, message, capacity, compare) {
  if (capacity === 0) return;
  if (heap.length < capacity) {
    heap.push(message);
    let index = heap.length - 1;
    while (
      index > 0 &&
      isWorse(heap[index], heap[Math.floor((index - 1) / 2)], compare)
    ) {
      const parent = Math.floor((index - 1) / 2);
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    }
    return;
  }
  if (compare(message, heap[0]) >= 0) return;

  heap[0] = message;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && isWorse(heap[left], heap[worst], compare)) {
      worst = left;
    }
    if (right < heap.length && isWorse(heap[right], heap[worst], compare)) {
      worst = right;
    }
    if (worst === index) break;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

function matches(message, { search, filter }) {
  if (filter === "unread" && !message.unread) return false;
  if (filter === "read" && message.unread) return false;
  if (!search) return true;
  const needle = search.toLocaleLowerCase();
  return [message.name, message.email, message.message].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  );
}

export function createAdminApiService({
  requireAdmin,
  getMessageStore = getContactMessageStore,
} = {}) {
  if (typeof requireAdmin !== "function") {
    throw new TypeError("requireAdmin must be a function");
  }

  async function storageOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error(
        "Admin message storage operation failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      throw new HttpError(503, "message_storage_unavailable");
    }
  }

  async function readMessage(store, key) {
    const message = await storageOperation(() =>
      readJsonRecord(store, key, { consistency: "strong" }),
    );
    if (message === null) return null;
    if (!validMessage(message, key)) {
      throw new HttpError(503, "message_storage_unavailable");
    }
    return message;
  }

  async function scanMessages(store, visit) {
    const pages = await storageOperation(() =>
      store.list({ prefix: MESSAGE_PREFIX, paginate: true }),
    );
    try {
      for await (const page of pages) {
        for (
          let index = 0;
          index < page.blobs.length;
          index += MESSAGE_READ_CONCURRENCY
        ) {
          const batch = page.blobs
            .slice(index, index + MESSAGE_READ_CONCURRENCY)
            .filter((blob) => blob.key.startsWith(MESSAGE_PREFIX));
          await Promise.all(batch.map(async (blob) => {
            const message = await readMessage(store, blob.key);
            if (message) await visit(message);
          }));
        }
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error(
        "Admin message listing failed",
        error instanceof Error ? error.name : "UnknownError",
      );
      throw new HttpError(503, "message_storage_unavailable");
    }
  }

  async function listMessages(store, query) {
    const offset = (query.page - 1) * query.limit;
    const retained = offset + query.limit;
    if (retained > MAX_RETAINED_MESSAGES) {
      throw new HttpError(422, "validation_failed", { page: "too_deep" });
    }
    const compare = compareMessages(query.sort);
    const selected = [];
    let total = 0;

    await scanMessages(store, (message) => {
      if (!matches(message, query)) return;
      total += 1;
      pushBest(selected, message, retained, compare);
    });

    selected.sort(compare);
    return {
      messages: selected.slice(offset, offset + query.limit).map(summary),
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    };
  }

  async function dashboard(store, email) {
    const recent = [];
    let total = 0;
    let unread = 0;
    const compare = compareMessages("newest");

    await scanMessages(store, (message) => {
      total += 1;
      if (message.unread) unread += 1;
      pushBest(recent, message, 5, compare);
    });
    recent.sort(compare);

    return {
      ok: true,
      admin: { email },
      stats: { total, unread, read: total - unread },
      recentMessages: recent.map(summary),
    };
  }

  async function handle(request, context = {}) {
    try {
      const path = normalizedPath(request);
      const listRoute = path === "/api/admin/messages";
      const dashboardRoute = path === "/api/admin/dashboard";
      const messageMatch = path.match(/^\/api\/admin\/messages\/([^/]+)$/);
      if (!listRoute && !dashboardRoute && !messageMatch) {
        throw new HttpError(404, "not_found");
      }

      const allowedMethod = listRoute || dashboardRoute
        ? "GET"
        : request.method === "GET"
          ? "GET"
          : request.method === "PATCH"
            ? "PATCH"
            : request.method === "DELETE"
              ? "DELETE"
              : null;
      if (!allowedMethod || request.method !== allowedMethod) {
        throw new HttpError(405, "method_not_allowed", undefined, {
          Allow: listRoute || dashboardRoute ? "GET" : "GET, PATCH, DELETE",
        });
      }

      const stateChanging = request.method !== "GET";
      const session = await requireAdmin(request, context, { stateChanging });
      if (
        (dashboardRoute || messageMatch) &&
        new URL(request.url).search !== ""
      ) {
        throw new HttpError(422, "validation_failed", { query: "invalid" });
      }
      const store = await storageOperation(() => getMessageStore());

      if (dashboardRoute) {
        return jsonResponse(await dashboard(store, session.email));
      }
      if (listRoute) {
        const query = validateMessageListQuery(
          new URL(request.url).searchParams,
        );
        return jsonResponse({ ok: true, ...(await listMessages(store, query)) });
      }

      const id = validateMessageId(messageMatch[1]);
      const key = RECORD_KEYS.message(id);
      if (request.method === "GET") {
        const message = await readMessage(store, key);
        if (!message) throw new HttpError(404, "not_found");
        return jsonResponse({ ok: true, message });
      }
      if (request.method === "PATCH") {
        const payload = validateMessageReadPayload(
          await readJsonBody(request, MAX_UPDATE_BODY_BYTES),
        );
        const current = await storageOperation(() =>
          store.getWithMetadata(key, { type: "json", consistency: "strong" }),
        );
        if (!current) throw new HttpError(404, "not_found");
        if (!validMessage(current.data, key) || !current.etag) {
          throw new HttpError(503, "message_storage_unavailable");
        }
        const updated = { ...current.data, unread: payload.unread };
        const result = await storageOperation(() =>
          store.set(key, JSON.stringify(updated), {
            onlyIfMatch: current.etag,
          }),
        );
        if (!result.modified) throw new HttpError(409, "message_changed");
        return jsonResponse({ ok: true, message: summary(updated) });
      }

      const existing = await readMessage(store, key);
      if (!existing) throw new HttpError(404, "not_found");
      await storageOperation(() => store.delete(key));
      return jsonResponse({ ok: true, deleted: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return { handle };
}
