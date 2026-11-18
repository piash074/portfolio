import assert from "node:assert/strict";
import test from "node:test";
import { createAdminAuthorizer } from "./authorization.mjs";
import { HttpError } from "./http.mjs";

test("admin authorization denies absent or non-admin sessions", async () => {
  const requireAdmin = createAdminAuthorizer(async () => ({ role: "visitor" }));
  await assert.rejects(
    requireAdmin(new Request("https://portfolio.example/api/admin")),
    (error) => error instanceof HttpError && error.status === 401,
  );
});

test("admin authorization returns a verified admin session", async () => {
  const adminSession = { adminId: "admin-1", role: "admin" };
  const requireAdmin = createAdminAuthorizer(async () => adminSession);
  assert.equal(
    await requireAdmin(new Request("https://portfolio.example/api/admin")),
    adminSession,
  );
});
