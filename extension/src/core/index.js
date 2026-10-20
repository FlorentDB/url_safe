/**
 * The Lien clair checker, running entirely on the device.
 *
 * The extension never sends the URL it checks to a server. It loads the
 * domain registry, the brand registry, the Unicode tables and the public
 * suffix list as data files, and answers from those alone. Downloading those
 * files reveals nothing about which link the user was looking at, because
 * every user downloads exactly the same ones.
 */

import { analyzeUrl, UrlInputError } from "./checker.js";
import { findBrandMatch } from "./brand.js";
import { buildVerdict } from "./verdict.js";
import { PublicSuffixList } from "./publicsuffix.js";
import { ConfusableTable, ScriptTable } from "./unicode.js";

export { UrlInputError } from "./checker.js";

/**
 * A checker holding the datasets it needs.
 */
export class Checker {
  /**
   * @param {object} datasets the exported datasets
   * @param {object} datasets.domains the domain and brand registries
   * @param {object} datasets.unicode the confusable tables
   * @param {object} datasets.publicSuffixes the public suffix rules
   */
  constructor({ domains, unicode, publicSuffixes }) {
    this.domains = new Map(
      (domains.domains ?? []).map((entry) => [entry.hostname, entry]),
    );
    this.brands = domains.brands ?? [];
    this.suffixes = new PublicSuffixList(publicSuffixes.rules ?? []);
    this.confusables = new ConfusableTable(
      unicode.confusables ?? {},
      new ScriptTable(unicode.script_ranges ?? [], unicode.script_aliases ?? []),
    );
  }

  /**
   * Analyse a URL and return the verdict.
   *
   * @param {string} url the URL to check
   * @returns {object} the verdict
   * @throws {UrlInputError} when the URL cannot be analysed
   */
  check(url) {
    const analysis = analyzeUrl(url, this.confusables);
    const canonicalHostname = analysis.canonical_hostname;

    const record = this.domains.get(canonicalHostname) ?? null;
    const brandMatch = findBrandMatch({
      hostname: canonicalHostname,
      brands: this.brands,
      suffixes: this.suffixes,
      confusables: this.confusables,
    });

    const verdict = buildVerdict({
      reasons: analysis.reasons,
      record,
      brandMatch,
    });

    return {
      hostname: analysis.hostname,
      canonical_hostname: canonicalHostname,
      ...verdict,
    };
  }
}
