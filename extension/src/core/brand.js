/**
 * Brand lookalike detection.
 *
 * It answers three questions about a hostname: is it the official domain of a
 * known brand, does it differ from one by a single character, and is an
 * official domain used as a secondary part of the address.
 */

import { toUnicode } from "./idna.js";
import { confusableCharacters } from "./unicode.js";

const MIN_BRAND_LABEL_LENGTH = 6;

/**
 * The Damerau-Levenshtein distance between two strings, counting a
 * transposition of two adjacent characters as one edit.
 *
 * @param {string} left the first string
 * @param {string} right the second string
 * @returns {number} the distance
 */
export function damerauLevenshtein(left, right) {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    distances[row][0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    distances[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + cost,
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, distances[row - 2][column - 2] + 1);
      }

      distances[row][column] = value;
    }
  }

  return distances[left.length][right.length];
}

/**
 * The registrable domain of a hostname and the label it carries.
 *
 * @param {object} suffixes the public suffix list
 * @param {string} hostname the hostname to inspect
 * @returns {{domain: string, label: string} | null} the parts, or null
 */
export function registrableDomain(suffixes, hostname) {
  const extracted = suffixes.extract(hostname);
  if (!extracted || !extracted.domain || !extracted.suffix) {
    return null;
  }

  const registered = `${extracted.domain}.${extracted.suffix}`.toLowerCase();
  let label;
  try {
    label = toUnicode(extracted.domain).toLowerCase();
  } catch {
    label = extracted.domain.toLowerCase();
  }

  return { domain: registered, label };
}

/**
 * Find the brand a hostname resembles, if any.
 *
 * @param {object} options the lookups the matcher needs
 * @param {string} options.hostname the canonical hostname to inspect
 * @param {Array<{brand_name: string, hostname: string, source: string}>} options.brands the brand registry
 * @param {object} options.suffixes the public suffix list
 * @param {object} options.confusables the confusable table
 * @returns {object | null} the match, or null
 */
export function findBrandMatch({ hostname, brands, suffixes, confusables }) {
  if (isIpAddress(hostname)) {
    return null;
  }

  const normalizedHost = hostname.replace(/\.+$/, "").toLowerCase();
  const candidate = registrableDomain(suffixes, normalizedHost);
  const fuzzyMatches = [];

  for (const brand of brands) {
    const officialHostname = brand.hostname.replace(/\.+$/, "").toLowerCase();
    const official = registrableDomain(suffixes, officialHostname);
    if (official === null) {
      continue;
    }

    if (candidate !== null && candidate.domain === official.domain) {
      return {
        brand_name: brand.brand_name,
        official_hostname: officialHostname,
        source: brand.source,
        match_type: "official",
        distance: 0,
      };
    }

    if (
      `.${normalizedHost}.`.includes(`.${officialHostname}.`) &&
      !normalizedHost.endsWith(`.${officialHostname}`)
    ) {
      return {
        brand_name: brand.brand_name,
        official_hostname: officialHostname,
        source: brand.source,
        match_type: "nested_brand_domain",
        distance: 0,
      };
    }

    if (candidate === null) {
      continue;
    }

    if (confusableCharacters(confusables, candidate.label, official.label)) {
      return {
        brand_name: brand.brand_name,
        official_hostname: officialHostname,
        source: brand.source,
        match_type: "unicode_lookalike",
        distance: 0,
      };
    }

    if (official.label.length < MIN_BRAND_LABEL_LENGTH) {
      continue;
    }

    const distance = damerauLevenshtein(candidate.label, official.label);
    if (distance === 1) {
      fuzzyMatches.push({
        brand_name: brand.brand_name,
        official_hostname: officialHostname,
        source: brand.source,
        match_type: "lookalike",
        distance,
      });
    }
  }

  if (fuzzyMatches.length === 0) {
    return null;
  }

  return fuzzyMatches.reduce((best, match) => {
    if (match.distance !== best.distance) {
      return match.distance < best.distance ? match : best;
    }
    if (match.brand_name.length !== best.brand_name.length) {
      return match.brand_name.length > best.brand_name.length ? match : best;
    }
    return best;
  });
}

/**
 * Whether a hostname is an IP address literal.
 *
 * @param {string} hostname the hostname to inspect
 * @returns {boolean} true when the hostname is an IP address
 */
function isIpAddress(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return hostname
      .split(".")
      .every((part) => Number(part) <= 255 && String(Number(part)) === part);
  }
  return hostname.includes(":") && /^[0-9a-f:.]+$/i.test(hostname);
}
