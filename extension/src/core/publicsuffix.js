/**
 * Public suffix list matching.
 *
 * The rules come from the snapshot `tldextract` ships, which
 * `scripts/export_datasets.py` writes to `src/data/public_suffixes.json`.
 *
 * The algorithm mirrors the one `tldextract` implements: the rules are held
 * in a trie whose labels are stored in reverse order, and the hostname is
 * walked from its last label towards its first. A wildcard rule matches one
 * label more than the rule itself, and an exception rule cancels the
 * wildcard.
 */

import { punycodeDecode } from "./idna.js";

/** A node of the suffix trie. */
function createNode() {
  return { matches: new Map(), end: false };
}

/**
 * Decode a punycode label, the way `tldextract` does before looking a label
 * up in the trie.
 *
 * @param {string} label the label to decode
 * @returns {string} the decoded label
 */
function decodeLabel(label) {
  const lowered = label.toLowerCase();
  if (!lowered.startsWith("xn--")) {
    return lowered;
  }
  try {
    return punycodeDecode(lowered.slice(4));
  } catch {
    return lowered;
  }
}

/**
 * A trie of the public suffix rules.
 */
export class PublicSuffixList {
  /**
   * @param {string[]} rules the rule strings, such as `com`, `*.ck` or `!www.ck`
   */
  constructor(rules) {
    this.root = createNode();
    for (const rule of rules) {
      this.insert(rule);
    }
  }

  /**
   * Insert one rule into the trie, with its labels in reverse order.
   *
   * @param {string} rule the rule to insert
   */
  insert(rule) {
    const labels = rule.split(".").reverse();
    let node = this.root;

    for (const label of labels) {
      if (!node.matches.has(label)) {
        node.matches.set(label, createNode());
      }
      node = node.matches.get(label);
    }

    node.end = true;
  }

  /**
   * The registrable domain of a hostname.
   *
   * @param {string} hostname the hostname to inspect
   * @returns {{domain: string, suffix: string} | null} the parts, or null
   */
  extract(hostname) {
    const labels = hostname.toLowerCase().split(".").filter((label) => label.length > 0);
    if (labels.length === 0) {
      return null;
    }

    const index = this.findPublicSuffix(labels);
    if (index === null) {
      return { domain: labels[labels.length - 1], suffix: "" };
    }

    const suffix = labels.slice(index).join(".");
    const domain = index > 0 ? labels[index - 1] : "";
    return { domain, suffix };
  }

  /**
   * The index at which the public suffix starts within the labels.
   *
   * @param {string[]} labels the hostname labels
   * @returns {number | null} the index, or null when no rule matches
   */
  findPublicSuffix(labels) {
    let node = this.root;
    let labelIndex = labels.length;
    let suffixIndex = labels.length;

    for (let position = labels.length - 1; position >= 0; position -= 1) {
      const label = decodeLabel(labels[position]);

      if (node.matches.has(label)) {
        labelIndex -= 1;
        node = node.matches.get(label);
        if (node.end) {
          suffixIndex = labelIndex;
        }
        continue;
      }

      if (node.matches.has("*")) {
        const isException = node.matches.has(`!${label}`);
        return isException ? labelIndex : labelIndex - 1;
      }

      break;
    }

    if (suffixIndex === labels.length) {
      return null;
    }
    return suffixIndex;
  }
}
