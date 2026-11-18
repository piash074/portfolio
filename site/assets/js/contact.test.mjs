import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const render = require("./render.js");

test("contact template targets the public API and retains accessible form fields", async () => {
  const config = JSON.parse(
    await readFile(new URL("../../content/site.json", import.meta.url), "utf8"),
  );
  const html = render.doc("contact", config, "Contact | Portfolio");

  assert.match(html, /data-endpoint="\/api\/contact"/);
  for (const field of ["name", "email", "phone", "service", "message", "website"]) {
    assert.match(html, new RegExp(`name="${field}"`));
  }
  assert.match(html, /maxlength="100"/);
  assert.match(html, /maxlength="254"/);
  assert.match(html, /maxlength="30"/);
  assert.match(html, /maxlength="5000"/);
  assert.match(html, /id="fmsg" role="alert"/);
  assert.match(html, /aria-describedby="e-message"/);
});
