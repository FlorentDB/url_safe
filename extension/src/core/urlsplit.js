/**
 * URL splitting, mirroring Python's `urllib.parse.urlsplit`.
 *
 * The browser's `URL` parser is not used for this. It percent-decodes the
 * host, keeps the brackets around an IPv6 literal, and normalises parts the
 * server leaves untouched, so the two would disagree on the same input. The
 * server is the reference, and this module reproduces its behaviour.
 */

const SCHEME_CHARACTERS = /^[a-zA-Z0-9+.-]$/;
const CONTROL_OR_SPACE = /[\u0000-\u0020]/g;

/** The result of splitting a URL. */
export class SplitResult {
  /**
   * @param {string} scheme the scheme, lowercased
   * @param {string} netloc the network location
   * @param {string} path the path
   * @param {string} query the query string
   * @param {string} fragment the fragment
   */
  constructor(scheme, netloc, path, query, fragment) {
    this.scheme = scheme;
    this.netloc = netloc;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  /**
   * The user name part of the authority.
   *
   * @returns {string | null} the user name, or null
   */
  get username() {
    const atIndex = this.netloc.lastIndexOf("@");
    if (atIndex === -1) {
      return null;
    }
    const userInfo = this.netloc.slice(0, atIndex);
    const separator = userInfo.indexOf(":");
    return separator === -1 ? userInfo : userInfo.slice(0, separator);
  }

  /**
   * The password part of the authority.
   *
   * @returns {string | null} the password, or null
   */
  get password() {
    const atIndex = this.netloc.lastIndexOf("@");
    if (atIndex === -1) {
      return null;
    }
    const userInfo = this.netloc.slice(0, atIndex);
    const separator = userInfo.indexOf(":");
    return separator === -1 ? null : userInfo.slice(separator + 1);
  }

  /**
   * The host part of the authority, lowercased and without its port.
   *
   * @returns {string | null} the host, or null
   */
  get hostname() {
    const host = this.hostAndPort()[0];
    if (!host) {
      return null;
    }
    const separator = host.indexOf("%");
    if (separator === -1) {
      return host.toLowerCase();
    }
    return (
      host.slice(0, separator).toLowerCase() + host.slice(separator)
    );
  }

  /**
   * The port part of the authority.
   *
   * @returns {number | null} the port, or null
   */
  get port() {
    const raw = this.hostAndPort()[1];
    if (raw === null || raw === "") {
      return null;
    }
    if (!/^[0-9]+$/.test(raw)) {
      throw new UrlSplitError("Port could not be cast to integer value");
    }
    const port = Number.parseInt(raw, 10);
    if (port < 0 || port > 65535) {
      throw new UrlSplitError("Port out of range 0-65535");
    }
    return port;
  }

  /**
   * The host and the raw port, following the same rules as Python.
   *
   * @returns {[string, string | null]} the host and the port
   */
  hostAndPort() {
    const atIndex = this.netloc.lastIndexOf("@");
    const hostInfo = atIndex === -1 ? this.netloc : this.netloc.slice(atIndex + 1);

    const openBracket = hostInfo.indexOf("[");
    if (openBracket !== -1) {
      const rest = hostInfo.slice(openBracket + 1);
      const closeBracket = rest.indexOf("]");
      const host = closeBracket === -1 ? rest : rest.slice(0, closeBracket);
      const after = closeBracket === -1 ? "" : rest.slice(closeBracket + 1);
      const colon = after.indexOf(":");
      const port = colon === -1 ? "" : after.slice(colon + 1);
      return [host, port];
    }

    const colon = hostInfo.indexOf(":");
    if (colon === -1) {
      return [hostInfo, ""];
    }
    return [hostInfo.slice(0, colon), hostInfo.slice(colon + 1)];
  }
}

/** Raised when a URL cannot be split the way the server splits it. */
export class UrlSplitError extends Error {}

/**
 * Split a URL into its parts, the way `urllib.parse.urlsplit` does.
 *
 * @param {string} value the URL to split
 * @returns {SplitResult} the parts
 */
export function urlsplit(value) {
  // Python strips leading control characters and spaces, and removes
  // tab, carriage return and newline wherever they appear.
  let url = value.replace(CONTROL_OR_SPACE, "").replace(/[\t\r\n]/g, "");
  let scheme = "";

  const colon = url.indexOf(":");
  if (colon > 0 && /[a-zA-Z]/.test(url[0])) {
    let valid = true;
    for (const character of url.slice(0, colon)) {
      if (!SCHEME_CHARACTERS.test(character)) {
        valid = false;
        break;
      }
    }
    if (valid) {
      scheme = url.slice(0, colon).toLowerCase();
      url = url.slice(colon + 1);
    }
  }

  let netloc = "";
  if (url.startsWith("//")) {
    const end = findAuthorityEnd(url);
    netloc = url.slice(2, end);
    url = url.slice(end);

    const hasOpen = netloc.includes("[");
    const hasClose = netloc.includes("]");
    if (hasOpen !== hasClose) {
      throw new UrlSplitError("Invalid IPv6 URL");
    }
  }

  let fragment = "";
  const hash = url.indexOf("#");
  if (hash !== -1) {
    fragment = url.slice(hash + 1);
    url = url.slice(0, hash);
  }

  let query = "";
  const question = url.indexOf("?");
  if (question !== -1) {
    query = url.slice(question + 1);
    url = url.slice(0, question);
  }

  return new SplitResult(scheme, netloc, url, query, fragment);
}

/**
 * The index at which the authority ends.
 *
 * @param {string} url the URL, starting with `//`
 * @returns {number} the index of the end of the authority
 */
function findAuthorityEnd(url) {
  for (let index = 2; index < url.length; index += 1) {
    const character = url[index];
    if (character === "/" || character === "?" || character === "#") {
      return index;
    }
  }
  return url.length;
}
