import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("./admin.js", import.meta.url), "utf8");
const styles = await readFile(new URL("./admin.css", import.meta.url), "utf8");

async function redirectsFor(page) {
  const redirects = [];
  const element = () => ({
    addEventListener() {},
    querySelector() {
      return { textContent: "" };
    },
    setAttribute() {},
  });
  const elements = new Map([
    ["login-form", { ...element(), elements: { email: {}, password: {} } }],
    ["password", element()],
    ["password-toggle", element()],
    ["login-submit", element()],
    ["login-error", element()],
  ]);
  const document = {
    body: { dataset: { adminPage: page } },
    cookie: "",
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    location: { replace: (path) => redirects.push(path) },
  };
  const fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, authenticated: false }),
  });

  runInNewContext(source, { document, fetch, window });
  await new Promise((resolve) => setImmediate(resolve));
  return redirects;
}

test("unauthenticated visitors remain on the admin login page", async () => {
  assert.deepEqual(await redirectsFor("login"), []);
});

test("unauthenticated visitors are redirected from the dashboard", async () => {
  assert.deepEqual(await redirectsFor("dashboard"), ["/admin/login"]);
});

test("the mobile sidebar keeps the account and logout controls visible", () => {
  assert.ok(styles.includes(
    "@media(max-width:680px){.sidebar-bottom{display:flex;grid-column:1/-1;margin-top:10px;padding:10px 3px 0}}",
  ));
});
