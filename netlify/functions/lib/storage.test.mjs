import assert from "node:assert/strict";
import test from "node:test";
import { RECORD_KEYS, STORE_NAMES, writeJsonRecord } from "./storage.mjs";

test("storage namespaces and record keys separate private data categories", () => {
  assert.deepEqual(Object.keys(STORE_NAMES), [
    "admins",
    "messages",
    "sessions",
    "authAttempts",
    "settings",
  ]);
  assert.equal(RECORD_KEYS.admin("admin-1"), "admins/admin-1");
  assert.equal(RECORD_KEYS.message("message-1"), "messages/message-1");
  assert.equal(RECORD_KEYS.session("digest"), "sessions/digest");
  assert.equal(RECORD_KEYS.loginAttempt("login"), "attempts/login");
  assert.equal(RECORD_KEYS.setting("site"), "settings/site");
});

test("JSON storage helper writes serialized data using SDK options", async () => {
  let write;
  const store = {
    async set(key, value, options) {
      write = { key, value, options };
      return { modified: true };
    },
  };
  await writeJsonRecord(store, "messages/id", { unread: true }, { onlyIfNew: true });
  assert.deepEqual(write, {
    key: "messages/id",
    value: '{"unread":true}',
    options: { onlyIfNew: true },
  });
});
