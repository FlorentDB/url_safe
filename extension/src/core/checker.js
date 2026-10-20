/**
 * URL analysis, the JavaScript counterpart of `app/checker.py`.
 *
 * The rules and the wording of the findings are identical to the server, so
 * the two return the same verdict for the same URL. The shared vectors in
 * `shared/vectors/verdicts.json` enforce that.
 */

import { IdnaError, toAscii, toUnicode } from "./idna.js";
import { urlsplit, UrlSplitError } from "./urlsplit.js";
import { dangerousMixedScriptLabels } from "./unicode.js";

const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const DOUBLE_ENCODED = /%25[0-9a-f]{2}/i;

/** Raised when a URL cannot be analysed. */
export class UrlInputError extends Error {}

/**
 * Whether a hostname is an IP address literal.
 *
 * @param {string} hostname the hostname to inspect
 * @returns {string | null} the normalised address, or null
 */
function ipAddress(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts.every((part) => part <= 255)) {
      return parts.join(".");
    }
    return null;
  }

  if (hostname.includes(":")) {
    try {
      return new URL(`https://[${hostname}]`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Analyse a URL and report the unusual things about it.
 *
 * @param {string} value the URL to analyse
 * @param {object} confusables the confusable table
 * @returns {object} the analysis
 * @throws {UrlInputError} when the URL cannot be analysed
 */
export function analyzeUrl(value, confusables) {
  let submittedUrl = value.trim();
  if (submittedUrl.length === 0) {
    throw new UrlInputError("Colle une adresse à vérifier.");
  }
  if (submittedUrl.length > 2048) {
    throw new UrlInputError("L’adresse dépasse la longueur maximale de 2 048 caractères.");
  }
  if (CONTROL_CHARACTERS.test(submittedUrl)) {
    throw new UrlInputError("L’adresse contient des caractères de contrôle.");
  }

  if (!submittedUrl.startsWith("//") && !submittedUrl.includes("://")) {
    if (SCHEME_PREFIX.test(submittedUrl)) {
      throw new UrlInputError("Seules les adresses HTTP et HTTPS sont prises en charge.");
    }
    submittedUrl = `https://${submittedUrl}`;
  } else if (submittedUrl.startsWith("//")) {
    submittedUrl = `https:${submittedUrl}`;
  }

  let parts;
  let port;
  try {
    parts = urlsplit(submittedUrl);
    port = parts.port;
  } catch (error) {
    if (error instanceof UrlSplitError) {
      throw new UrlInputError("Cette adresse n’a pas un format valide.");
    }
    throw error;
  }

  if (parts.scheme.toLowerCase() !== "http" && parts.scheme.toLowerCase() !== "https") {
    throw new UrlInputError("Seules les adresses HTTP et HTTPS sont prises en charge.");
  }

  const hostname = parts.hostname;
  if (!hostname) {
    throw new UrlInputError("Aucun nom de domaine n’a été trouvé dans cette adresse.");
  }

  const originalHostname = hostname.replace(/\.+$/, "").toLowerCase();

  let isIpAddress = false;
  let canonicalHostname;
  const address = ipAddress(originalHostname);
  if (address !== null) {
    isIpAddress = true;
    canonicalHostname = address;
  } else {
    try {
      canonicalHostname = toAscii(originalHostname);
    } catch (error) {
      if (error instanceof IdnaError) {
        throw new UrlInputError("Le nom de domaine ne peut pas être interprété correctement.");
      }
      throw error;
    }
  }

  const reasons = [];
  if (parts.username !== null || parts.password !== null) {
    reasons.push("L’adresse contient des identifiants avant le nom d’hôte.");
  }
  if (isIpAddress) {
    reasons.push("L’adresse utilise une adresse IP plutôt qu’un nom de domaine.");
  }
  if (canonicalHostname.startsWith("xn--") || canonicalHostname.includes(".xn--")) {
    reasons.push("Le domaine utilise du punycode; vérifie les caractères internationalisés affichés.");
  }

  let unicodeHostname = originalHostname;
  try {
    unicodeHostname = toUnicode(canonicalHostname);
  } catch {
    unicodeHostname = originalHostname;
  }
  for (const label of dangerousMixedScriptLabels(confusables, unicodeHostname)) {
    reasons.push(
      `L’étiquette « ${label} » mélange des alphabets et contient des caractères confondables avec le latin.`,
    );
  }

  if (port !== null && port !== 80 && port !== 443) {
    reasons.push(`L’adresse utilise un port inhabituel (${port}).`);
  }

  const encodedComponents = `${parts.path}?${parts.query}#${parts.fragment}`;
  if (ENCODED_CONTROL.test(encodedComponents)) {
    reasons.push("Le chemin contient un caractère de contrôle encodé.");
  }
  if (DOUBLE_ENCODED.test(encodedComponents)) {
    reasons.push("Le chemin contient une séquence encodée une seconde fois.");
  }

  return {
    submitted_url: value.trim(),
    normalized_url: submittedUrl,
    hostname: originalHostname,
    canonical_hostname: canonicalHostname,
    reasons,
  };
}
