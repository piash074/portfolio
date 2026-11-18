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
