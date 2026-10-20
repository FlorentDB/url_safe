import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A minimal stand-in for the DOM.
 *
 * The extension pages run in a browser, but the renderer only builds elements
 * and fills them with text. A stub of that size is enough to check the
 * result, and it keeps the project free of a test dependency.
 */
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.children = [];
    this.attributes = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  /** The markup is never built, so reading or writing it is a defect. */
  get innerHTML() {
    throw new Error("innerHTML must not be used");
  }

  set innerHTML(_value) {
    throw new Error("innerHTML must not be used");
  }

  /** Every piece of text in the tree, in order. */
  get text() {
    return [this.textContent, ...this.children.map((child) => child.text)]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  /** Every element of the tree, this one included. */
  all() {
    return [this, ...this.children.flatMap((child) => child.all())];
  }

  /** The first element of the tree matching a predicate. */
  find(predicate) {
    return this.all().find(predicate);
  }
}

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
};

const { renderError, renderVerdict, STATUS_LABELS } = await import(
  "../src/shared/render.js"
);

const VERDICT = {
  hostname: "rmicrosoft.com",
  canonical_hostname: "rmicrosoft.com",
  classification: "impersonation",
  title: "Ressemble à Microsoft",
  explanation: "Le nom de domaine diffère d’un caractère de microsoft.com.",
  reasons: ["Ressemblance avec le domaine officiel microsoft.com."],
  source: "Registre de marque",
  matched_brand: "Microsoft",
  official_domain: "microsoft.com",
};

test("every classification has a label", () => {
  for (const classification of [
    "known",
    "suspicious",
    "impersonation",
    "unknown",
  ]) {
    assert.ok(STATUS_LABELS[classification], classification);
  }
});

test("the verdict is drawn with its title and its explanation", () => {
  const root = new FakeElement("section");

  renderVerdict(root, VERDICT);

  assert.equal(root.hidden, false);
  assert.equal(root.dataset.classification, "impersonation");
  assert.ok(root.text.includes("Ressemble à Microsoft"));
  assert.ok(root.text.includes("diffère d’un caractère"));
  assert.ok(root.text.includes(STATUS_LABELS.impersonation));
});

test("the verdict shows the domain, the brand and the source", () => {
  const root = new FakeElement("section");

  renderVerdict(root, VERDICT);

  assert.ok(root.text.includes("rmicrosoft.com"));
  assert.ok(root.text.includes("Microsoft (microsoft.com)"));
  assert.ok(root.text.includes("Registre de marque"));
});

test("the reasons are listed one by one", () => {
  const root = new FakeElement("section");

  renderVerdict(root, VERDICT);

  const list = root.find((element) => element.className === "reason-list");
  assert.ok(list);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].tagName, "li");
  assert.equal(list.children[0].textContent, VERDICT.reasons[0]);
});

test("a row is hidden when there is nothing to show", () => {
  const root = new FakeElement("section");

  renderVerdict(root, { ...VERDICT, matched_brand: null, source: null });

  const rows = root.find((element) => element.className === "domain-detail");
  const byLabel = new Map(
    rows.children.map((row) => [row.children[0].textContent, row]),
  );

  assert.equal(byLabel.get("Marque comparée").hidden, true);
  assert.equal(byLabel.get("Source locale").hidden, true);
  assert.equal(byLabel.get("Domaine interprété").hidden, false);
});

test("the ASCII form is only shown when it differs", () => {
  const root = new FakeElement("section");

  renderVerdict(root, {
    ...VERDICT,
    hostname: "раypal.com",
    canonical_hostname: "xn--pypal-4ve.com",
  });

  const rows = root.find((element) => element.className === "domain-detail");
  const visible = rows.children.filter((row) => !row.hidden);
  assert.ok(visible.some((row) => row.text.includes("xn--pypal-4ve.com")));
});

test("a hostile hostname is text and never markup", () => {
  const root = new FakeElement("section");
  const hostile = '"><img src=x onerror=alert(1)>';

  renderVerdict(root, { ...VERDICT, hostname: hostile, canonical_hostname: hostile });

  // The stub throws on any use of innerHTML, so reaching this point at all
  // proves the renderer never built markup.
  assert.ok(root.text.includes(hostile));
  assert.equal(root.find((element) => element.tagName === "img"), undefined);
});

test("an error is shown in the result area", () => {
  const root = new FakeElement("section");

  renderError(root, "Cette adresse n’a pas un format valide.");

  assert.equal(root.hidden, false);
  assert.equal(root.dataset.classification, "error");
  assert.ok(root.text.includes("format valide"));
  const paragraph = root.find((element) => element.className === "form-error");
  assert.equal(paragraph.getAttribute?.("role") ?? paragraph.attributes.role, "alert");
});
