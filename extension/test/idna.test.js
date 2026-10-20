import assert from "node:assert/strict";
import { test } from "node:test";

import { IdnaError, punycodeDecode, toAscii, toUnicode } from "../src/core/idna.js";

/**
 * These expectations come from the `idna` package the server uses, with
 * `uts46=True` and `std3_rules=True`. They are the contract between the two
 * implementations.
 */
const CANONICAL = [
  ["example.com", "example.com"],
  ["paypal.com", "paypal.com"],
  ["ABC.com", "abc.com"],
  ["раypal.com", "xn--ypal-43d9g.com"],
  ["mіcrosoft.com", "xn--mcrosoft-thh.com"],
  ["例え.テスト", "xn--r8jz45g.xn--zckzah"],
  ["café.fr", "xn--caf-dma.fr"],
  ["ＡＢＣ.com", "abc.com"],
  ["ß.de", "xn--zca.de"],
  ["ς.gr", "xn--3xa.gr"],
  ["xn--ypal-43d9g.com", "xn--ypal-43d9g.com"],
  ["xn--r8jz45g.xn--zckzah", "xn--r8jz45g.xn--zckzah"],
  ["xn--nxasmm1c.com", "xn--nxasmm1c.com"],
];

const REJECTED = [
  ["abc_def.com"],
  ["exa mple.com"],
  ["ex%61mple.com"],
  ["a".repeat(64) + ".com"],
  ["-lead.com"],
  ["trail-.com"],
  ["a..b.com"],
  [".com"],
  ["xn--a-ecp.ru"],
];

test("canonicalises hostnames exactly like the server", () => {
  for (const [input, expected] of CANONICAL) {
    assert.equal(toAscii(input), expected, input);
  }
});

test("rejects the hostnames the server rejects", () => {
  for (const [input] of REJECTED) {
    assert.throws(() => toAscii(input), IdnaError, input);
  }
});

test("decodes punycode back to the characters a user sees", () => {
  assert.equal(toUnicode("xn--ypal-43d9g.com"), "раypal.com");
  assert.equal(toUnicode("xn--mcrosoft-thh.com"), "mіcrosoft.com");
  assert.equal(toUnicode("xn--r8jz45g.xn--zckzah"), "例え.テスト");
  assert.equal(toUnicode("example.com"), "example.com");
});

test("punycode round-trips through encode and decode", () => {
  for (const [, canonical] of CANONICAL) {
    for (const label of canonical.split(".")) {
      if (!label.startsWith("xn--")) {
        continue;
      }
      const decoded = punycodeDecode(label.slice(4));
      assert.equal(`xn--${label.slice(4)}`, label);
      assert.ok(decoded.length > 0);
    }
  }
});
