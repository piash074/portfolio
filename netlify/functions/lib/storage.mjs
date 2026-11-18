import { getStore } from "@netlify/blobs";

export const STORE_NAMES = Object.freeze({
  admins: "portfolio-admin-metadata",
  messages: "portfolio-contact-messages",
  sessions: "portfolio-admin-sessions",
  authAttempts: "portfolio-auth-attempts",
  settings: "portfolio-app-settings",
});

export const RECORD_KEYS = Object.freeze({
  admin: (id) => `admins/${id}`,
  message: (id) => `messages/${id}`,
  session: (tokenHash) => `sessions/${tokenHash}`,
  loginAttempt: (scope) => `attempts/${scope}`,
  setting: (name) => `settings/${name}`,
});

export function getAdminStore() {
  return getStore(STORE_NAMES.admins);
}

export function getContactMessageStore() {
  return getStore(STORE_NAMES.messages);
}

export function getSessionStore() {
  return getStore(STORE_NAMES.sessions);
}

export function getAuthAttemptStore() {
  return getStore(STORE_NAMES.authAttempts);
}

export function getSettingsStore() {
  return getStore(STORE_NAMES.settings);
}

export async function readJsonRecord(store, key, options = {}) {
  return store.get(key, { ...options, type: "json" });
}

export async function writeJsonRecord(store, key, value, options = {}) {
  return store.set(key, JSON.stringify(value), options);
}

export async function saveContactMessage(message) {
  const result = await writeJsonRecord(
    getContactMessageStore(),
    RECORD_KEYS.message(message.id),
    message,
    { onlyIfNew: true },
  );

  if (!result || result.modified !== true) {
    throw new Error("Contact message key was not created");
  }
}
