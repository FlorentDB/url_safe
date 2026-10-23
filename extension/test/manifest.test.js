import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { GECKO_ID, toFirefoxManifest } from "../scripts/firefox-manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "manifest.json"), "utf8"),
);

test("the manifest is a third version manifest", () => {
  assert.equal(MANIFEST.manifest_version, 3);
  assert.ok(MANIFEST.version);
  assert.match(MANIFEST.version, /^0\./);
  assert.ok(MANIFEST.description.length > 10);
});

test("every file the manifest points at exists", () => {
  const referenced = [
    ...Object.values(MANIFEST.icons ?? {}),
    ...Object.values(MANIFEST.action?.default_icon ?? {}),
    MANIFEST.action?.default_popup,
    MANIFEST.options_ui?.page,
    MANIFEST.background?.service_worker,
  ].filter(Boolean);

  assert.ok(referenced.length >= 5);
  for (const path of referenced) {
    assert.ok(existsSync(join(ROOT, path)), path);
  }
});

test("the icons are real files of the right size", () => {
  for (const [size, path] of Object.entries(MANIFEST.icons)) {
    const content = readFileSync(join(ROOT, path));
    assert.equal(content.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
    // The width and height are stored right after the signature and the
    // chunk header, as two big-endian integers.
    assert.equal(content.readUInt32BE(16), Number(size), path);
    assert.equal(content.readUInt32BE(20), Number(size), path);
  }
});

test("the extension asks for no browsing permission", () => {
  // A content script, or the tabs permission, would let the extension look
  // at the pages the user visits. The promise of the product is that it
  // does not, so neither may ever appear in the manifest.
  assert.equal(MANIFEST.content_scripts, undefined);
  assert.ok(!MANIFEST.permissions.includes("tabs"));
  assert.ok(!MANIFEST.permissions.includes("activeTab"));
  assert.ok(!MANIFEST.permissions.includes("scripting"));
  assert.ok(!MANIFEST.permissions.includes("webRequest"));
  assert.ok(!MANIFEST.permissions.includes("history"));
});

test("the extension asks for no host permission by default", () => {
  assert.equal(MANIFEST.host_permissions, undefined);
  assert.deepEqual(MANIFEST.optional_host_permissions, ["https://*/*"]);
});

test("the extension only needs the three permissions it uses", () => {
  assert.deepEqual([...MANIFEST.permissions].sort(), [
    "alarms",
    "contextMenus",
    "storage",
  ]);
});

test("the extension has no inline script and no evaluation", () => {
  const contentSecurityPolicy = MANIFEST.content_security_policy.extension_pages;
  assert.ok(contentSecurityPolicy.includes("script-src 'self'"));
  assert.ok(!contentSecurityPolicy.includes("unsafe-eval"));
  assert.ok(!contentSecurityPolicy.includes("unsafe-inline"));
});

test("the Firefox manifest runs the background as an event page", () => {
  const firefox = toFirefoxManifest(MANIFEST);

  assert.equal(firefox.background.service_worker, undefined);
  assert.equal(firefox.background.type, undefined);
  assert.deepEqual(firefox.background.scripts, [
    MANIFEST.background.service_worker,
  ]);
});

test("the Firefox manifest declares that nothing is collected", () => {
  const gecko = toFirefoxManifest(MANIFEST).browser_specific_settings.gecko;

  assert.deepEqual(gecko.data_collection_permissions.required, ["none"]);
  assert.deepEqual(gecko.data_collection_permissions.optional, [
    "technicalAndInteraction",
  ]);
  assert.ok(gecko.id);
});

test("the two manifests agree on everything but the background", () => {
  const firefox = toFirefoxManifest(MANIFEST);
  const {
    background: chromeBackground,
    browser_specific_settings: chromeGecko,
    ...chromeRest
  } = MANIFEST;
  const {
    background: firefoxBackground,
    browser_specific_settings: firefoxGecko,
    ...firefoxRest
  } = firefox;

  assert.deepEqual(firefoxRest, chromeRest);
  assert.equal(chromeGecko, undefined);
  assert.ok(firefoxGecko);
  assert.equal(firefoxBackground.scripts[0], chromeBackground.service_worker);
});

test("every localised string of the manifest exists", () => {
  // A manifest that points at a message the locale file does not define is
  // an error for both stores, and the extension then loads without a name.
  const messages = JSON.parse(
    readFileSync(join(ROOT, "_locales", "fr", "messages.json"), "utf8"),
  );

  const placeholders = JSON.stringify(MANIFEST).match(/__MSG_[A-Za-z0-9_]+__/g) ?? [];
  assert.ok(placeholders.length >= 3);

  for (const placeholder of placeholders) {
    const key = placeholder.slice(6, -2);
    assert.ok(messages[key], key);
    assert.ok(messages[key].message.length > 0, key);
  }
});

test("the locale file is complete and in French", () => {
  const messages = JSON.parse(
    readFileSync(join(ROOT, "_locales", "fr", "messages.json"), "utf8"),
  );

  for (const key of [
    "extensionName",
    "extensionDescription",
    "actionTitle",
    "contextMenuTitle",
  ]) {
    assert.ok(messages[key], key);
    assert.ok(messages[key].message.length > 0, key);
  }
});

test("the beta name and description disclose the testing status", () => {
  const messages = JSON.parse(
    readFileSync(join(ROOT, "_locales", "fr", "messages.json"), "utf8"),
  );

  assert.match(messages.extensionName.message, /Bêta/i);
  assert.match(messages.extensionDescription.message, /BÊTA/i);
  assert.match(messages.extensionDescription.message, /ne garantit pas la sécurité/i);
  assert.ok(messages.extensionDescription.message.length <= 132);
  assert.match(messages.actionTitle.message, /Bêta/i);
});

test("the popup and result page show the beta coverage warning", () => {
  for (const page of ["src/popup/popup.html", "src/result/result.html"]) {
    const source = readFileSync(join(ROOT, page), "utf8");
    assert.match(source, /Bêta/i, page);
    assert.match(
      source,
      /ne garantit qu’un lien|absence d’alerte ne garantit|ne signifie pas qu’un lien/i,
      page,
    );
  }
});

test("the Firefox add-on identifier is the chosen stable value", () => {
  assert.equal(GECKO_ID, "url-safe@url-safe.fr");
  assert.match(GECKO_ID, /^[a-zA-Z0-9-._]+@[a-zA-Z0-9-._]+$/);
});

test("Firefox only asks for technical data when optional list refresh is enabled", () => {
  const source = readFileSync(join(ROOT, "src", "options", "options.js"), "utf8");
  assert.match(source, /permissions\.request\(\{\s*data_collection:/);
  assert.match(source, /permissions\.getAll\(\)/);
  assert.match(source, /if \(isFirefox\)/);
  assert.match(source, /permissions\.request\(\{ origins: \[origin\] \}\)/);
});
