import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const render = require("./render.js");
const config = JSON.parse(
  await readFile(new URL("../../content/site.json", import.meta.url), "utf8"),
);
const pages = ["home", "services", "work", "about", "testimonials", "contact"];

test("public pages omit unset contact links and social containers", () => {
  for (const page of pages) {
    const html = render.doc(page, config);
    assert.doesNotMatch(html, /href="(?:mailto:|tel:)|https:\/\/wa\.me\//);
    assert.doesNotMatch(html, /class="(?:soc|online)(?:\s|")/);
    assert.doesNotMatch(html, /href=""/);
  }
});

test("public pages use a neutral identity and omit unverified demo claims", () => {
  for (const page of pages) {
    const html = render.doc(page, config);
    assert.match(html, /Your Name/);
    assert.doesNotMatch(
      html,
      /Alex Morgan|<b>AM<\/b>|hello@example\.com|\+00 000 000 000/,
    );
    assert.doesNotMatch(
      html,
      /https:\/\/(?:instagram\.com|linkedin\.com|behance\.net|x\.com)/,
    );
  }

  const home = render.doc("home", config);
  assert.doesNotMatch(home, /id="stats"|data-count=|class="fc fc|class="slide"/);
  assert.doesNotMatch(home, /Modern Living Room|Kind Words From Clients/);

  assert.match(render.doc("work", config), /No project details have been added yet\./);
  assert.match(
    render.doc("testimonials", config),
    /No testimonials have been added yet\./,
  );
});

test("configured contact details render usable links", () => {
  const configured = JSON.parse(JSON.stringify(config));
  configured.site.email = "portfolio@example.invalid";
  configured.site.phone = "+1 555 010 1234";
  configured.site.whatsapp = "+1 (555) 010-5678";
  configured.site.socials = [
    { n: "linkedin", u: "https://example.invalid/profile" },
  ];

  const contact = render.doc("contact", configured);
  assert.match(contact, /href="mailto:portfolio@example\.invalid"/);
  assert.match(contact, /href="tel:\+15550101234"/);
  assert.match(contact, /href="https:\/\/wa\.me\/15550105678"/);
  assert.match(contact, /href="https:\/\/example\.invalid\/profile"/);
});
