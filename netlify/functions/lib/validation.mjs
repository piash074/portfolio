import { HttpError } from "./http.mjs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^[+\d][\d\s().+\-]*$/;

function text(value, field, { required = false, max, min = 0 } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null)) return "";
    throw new HttpError(422, "validation_failed", { [field]: "invalid" });
  }

  const normalized = value.trim();
  if (required && normalized.length === 0) {
    throw new HttpError(422, "validation_failed", { [field]: "required" });
  }
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(422, "validation_failed", { [field]: "invalid_length" });
  }
  return normalized;
}

export function validateContactPayload(payload) {
  const website = payload.website;
  if (website !== undefined && typeof website !== "string") {
    throw new HttpError(422, "validation_failed", { website: "invalid" });
  }
  if (typeof website === "string" && website.trim() !== "") {
    throw new HttpError(422, "validation_failed", { website: "invalid" });
  }

  const name = text(payload.name, "name", { required: true, min: 2, max: 100 });
  const email = text(payload.email, "email", {
    required: true,
    max: 254,
  });
  if (!EMAIL_PATTERN.test(email)) {
    throw new HttpError(422, "validation_failed", { email: "invalid" });
  }

  const phone = text(payload.phone, "phone", { max: 30 });
  if (
    phone &&
    (!PHONE_PATTERN.test(phone) ||
      phone.replace(/\D/g, "").length < 7 ||
      phone.replace(/\D/g, "").length > 15)
  ) {
    throw new HttpError(422, "validation_failed", { phone: "invalid" });
  }

  const service = text(payload.service, "service", {
    required: true,
    min: 1,
    max: 120,
  });
  const message = text(payload.message, "message", {
    required: true,
    min: 10,
    max: 5000,
  });

  return { name, email, phone, service, message };
}

export function validateAdminEmail(value) {
  if (typeof value !== "string") {
    throw new HttpError(422, "validation_failed", { email: "invalid" });
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(422, "validation_failed", { email: "invalid" });
  }
  return email;
}

export function validateAdminPassword(value, { setup = false } = {}) {
  if (typeof value !== "string") {
    throw new HttpError(422, "validation_failed", { password: "invalid" });
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes === 0 || bytes > 128 || (setup && bytes < 12)) {
    throw new HttpError(422, "validation_failed", {
      password: setup ? "must_be_12_to_128_bytes" : "must_be_1_to_128_bytes",
    });
  }
  return value;
}

export function validateAdminSetupPayload(payload) {
  const { setupToken } = payload;
  if (
    typeof setupToken !== "string" ||
    Buffer.byteLength(setupToken, "utf8") < 32 ||
    Buffer.byteLength(setupToken, "utf8") > 512
  ) {
    throw new HttpError(422, "validation_failed", {
      setupToken: "invalid",
    });
  }
  return {
    setupToken,
    email: validateAdminEmail(payload.email),
    password: validateAdminPassword(payload.password, { setup: true }),
  };
}

export function validateAdminLoginPayload(payload) {
  return {
    email: validateAdminEmail(payload.email),
    password: validateAdminPassword(payload.password),
  };
}

export function validateMessageListQuery(searchParams) {
  const allowed = new Set(["page", "limit", "search", "filter", "sort"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1) {
      throw new HttpError(422, "validation_failed", { query: "invalid" });
    }
  }

  function integerParam(name, fallback, maximum) {
    const value = searchParams.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) {
      throw new HttpError(422, "validation_failed", { [name]: "invalid" });
    }
    return Number(value);
  }

  const page = integerParam("page", 1, 1000);
  const limit = integerParam("limit", 20, 50);
  const search = (searchParams.get("search") || "").trim();
  const filter = searchParams.has("filter")
    ? searchParams.get("filter")
    : "all";
  const sort = searchParams.has("sort")
    ? searchParams.get("sort")
    : "newest";
  if (search.length > 200) {
    throw new HttpError(422, "validation_failed", { search: "invalid" });
  }
  if (!["all", "unread", "read"].includes(filter)) {
    throw new HttpError(422, "validation_failed", { filter: "invalid" });
  }
  if (!["newest", "oldest"].includes(sort)) {
    throw new HttpError(422, "validation_failed", { sort: "invalid" });
  }
  return { page, limit, search, filter, sort };
}

export function validateMessageReadPayload(payload) {
  if (
    Object.keys(payload).length !== 1 ||
    typeof payload.unread !== "boolean"
  ) {
    throw new HttpError(422, "validation_failed", { unread: "invalid" });
  }
  return { unread: payload.unread };
}

export function validateMessageId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new HttpError(404, "not_found");
  }
  return value;
}
