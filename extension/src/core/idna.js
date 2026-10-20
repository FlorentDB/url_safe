/**
 * Hostname canonicalisation for the extension.
 *
 * The server canonicalises a hostname with the `idna` package, which applies
 * UTS #46 together with the STD3 rules. The browser's `URL` parser applies
 * UTS #46 but not STD3, so it accepts hostnames the server rejects, such as
 * `abc_def.com` or a label longer than 63 characters. Using the browser
 * parser alone would make the extension and the API disagree about the same
 * input, so the parser is used for the mapping and the stricter rules are
 * applied on top of it.
 *
 * Decoding punycode back to Unicode is done here rather than through the
 * browser, because `TextDecoder` does not support the `punycode` encoding.
 */

const PUNYCODE_PREFIX = "xn--";

export class IdnaError extends Error {}

/**
 * Decode a Punycode string, as defined by RFC 3492.
 *
 * @param {string} input the Punycode payload, without the `xn--` prefix
 * @returns {string} the decoded string
 */
export function punycodeDecode(input) {
  const output = [];
  let index = 0;

  const delimiterIndex = input.lastIndexOf("-");
  if (delimiterIndex > 0) {
    for (let position = 0; position < delimiterIndex; position += 1) {
      const codePoint = input.charCodeAt(position);
      if (codePoint > 0x7f) {
        throw new IdnaError("Caractère non valide dans une chaîne Punycode.");
      }
      output.push(codePoint);
    }
    index = delimiterIndex + 1;
  }

  let n = 0x80;
  let bias = 72;
  let i = 0;

  while (index < input.length) {
    const oldI = i;
    let weight = 1;

    for (let k = 36; ; k += 36) {
      if (index >= input.length) {
        throw new IdnaError("Chaîne Punycode incomplète.");
      }
      const digit = decodeDigit(input.charCodeAt(index));
      index += 1;
      if (digit === null) {
        throw new IdnaError("Caractère non valide dans une chaîne Punycode.");
      }

      i += digit * weight;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (digit < t) {
        break;
      }
      weight *= 36 - t;
    }

    const out = output.length + 1;
    bias = adapt(i - oldI, out, oldI === 0);
    n += Math.floor(i / out);
    i %= out;
    output.splice(i, 0, n);
    i += 1;
  }

  return String.fromCodePoint(...output);
}

/** The Punycode digit value of an ASCII code point, or null when invalid. */
function decodeDigit(codePoint) {
  if (codePoint >= 0x30 && codePoint <= 0x39) {
    return codePoint - 0x30 + 26;
  }
  if (codePoint >= 0x41 && codePoint <= 0x5a) {
    return codePoint - 0x41;
  }
  if (codePoint >= 0x61 && codePoint <= 0x7a) {
    return codePoint - 0x61;
  }
  return null;
}

function adapt(delta, numPoints, firstTime) {
  let scaled = firstTime ? Math.floor(delta / 700) : delta >> 1;
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > ((36 - 1) * 26) / 2) {
    scaled = Math.floor(scaled / (36 - 1));
    k += 36;
  }
  return k + Math.floor(((36 - 1 + 1) * scaled) / (scaled + 38));
}

/**
 * Convert a hostname to its canonical ASCII form.
 *
 * @param {string} hostname the hostname as written in the URL
 * @returns {string} the canonical ASCII hostname
 * @throws {IdnaError} when the server would also reject the hostname
 */
export function toAscii(hostname) {
  for (const character of hostname) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x80 && !isStd3Allowed(codePoint)) {
      throw new IdnaError("Un nom de domaine ne peut pas contenir ce caractère.");
    }
  }

  let canonical;
  try {
    canonical = new URL(`https://${hostname}`).hostname;
  } catch {
    throw new IdnaError("Le nom de domaine ne peut pas être interprété correctement.");
  }

  for (const label of canonical.split(".")) {
    if (label.length === 0) {
      throw new IdnaError("Une étiquette de domaine ne peut pas être vide.");
    }
    if (label.length > 63) {
      throw new IdnaError("Une étiquette de domaine est trop longue.");
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      throw new IdnaError(
        "Une étiquette de domaine ne peut pas commencer ou finir par un tiret.",
      );
    }
  }

  return canonical;
}

/**
 * Convert an ASCII hostname back to its Unicode form, so that the
 * characters a user actually sees can be inspected.
 *
 * @param {string} hostname the canonical ASCII hostname
 * @returns {string} the Unicode hostname
 */
export function toUnicode(hostname) {
  return hostname
    .split(".")
    .map((label) => {
      if (!label.toLowerCase().startsWith(PUNYCODE_PREFIX)) {
        return label;
      }
      try {
        return punycodeDecode(label.slice(PUNYCODE_PREFIX.length).toLowerCase());
      } catch {
        return label;
      }
    })
    .join(".");
}

/** The characters STD3 allows in a hostname. */
function isStd3Allowed(codePoint) {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    codePoint === 0x2d ||
    codePoint === 0x2e
  );
}
