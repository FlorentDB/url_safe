#!/usr/bin/env node
/**
 * Build the extension packages.
 *
 * The same source tree targets two stores. Chrome runs the background context
 * as a service worker, Firefox runs it as an event page, so the Firefox
 * manifest is produced by patching the Chrome one. Keeping a single source
 * manifest means the two cannot drift apart.
 *
 * Run with::
 *
 *     node extension/scripts/build.mjs             # development packages
 *     node extension/scripts/build.mjs --release   # refuses placeholders
 *     node extension/scripts/build.mjs --target firefox --release
 *     node extension/scripts/build.mjs --version 1.2.0
 *
 * The archives are written to ``extension/dist``.
 */

import { deflateRawSync } from "node:zlib";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { toFirefoxManifest } from "./firefox-manifest.mjs";

const EXTENSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(EXTENSION_ROOT, "src");
const DIST_DIR = join(EXTENSION_ROOT, "dist");
const PROJECT_ROOT = join(EXTENSION_ROOT, "..");

/** The privacy policy, written once for the website and shipped with the extension. */
const PRIVACY_POLICY = join(PROJECT_ROOT, "app", "static", "confidentialite.html");

/**
 * The localised strings.
 *
 * The directory has to sit next to the manifest, not inside the source tree,
 * because both stores look for `_locales` at the root of the package.
 */
const LOCALES_DIR = join(EXTENSION_ROOT, "_locales");

/** Values that must be replaced before a store release. */
const PLACEHOLDERS = ["example.invalid"];

/**
 * Parse the command line.
 *
 * @returns {{release: boolean, version: string | null, target: string}} the options
 */
function parseArguments() {
  const arguments_ = process.argv.slice(2);
  const options = { release: false, version: null, target: "all" };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--release") {
      options.release = true;
    } else if (argument === "--version") {
      options.version = arguments_[index + 1] ?? null;
      index += 1;
    } else if (argument === "--target") {
      const target = arguments_[index + 1] ?? null;
      if (!["chrome", "firefox", "all"].includes(target)) {
        throw new Error("--target doit être chrome, firefox ou all.");
      }
      options.target = target;
      index += 1;
    } else {
      throw new Error(`Option inconnue : ${argument}`);
    }
  }

  return options;
}

/**
 * Every file of a directory, relative to it.
 *
 * @param {string} directory the directory to walk
 * @param {string} prefix the prefix of the returned paths
 * @returns {Promise<string[]>} the relative paths
 */
async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files.sort();
}

/**
 * Check that a path exists in the package.
 *
 * Manifest paths are relative to the package root, the same way they are in
 * the installed extension. The privacy policy is the one file that is not
 * part of the source tree: it is written for the website and copied into the
 * package at build time.
 *
 * @param {string} path the path, relative to the package root
 * @returns {Promise<boolean>} true when the file exists
 */
async function exists(path) {
  if (path === "src/confidentialite.html") {
    try {
      await stat(PRIVACY_POLICY);
      return true;
    } catch {
      return false;
    }
  }

  try {
    await stat(join(EXTENSION_ROOT, path));
    return true;
  } catch {
    return false;
  }
}

/**
 * The local references of an HTML file.
 *
 * @param {string} html the HTML source
 * @returns {string[]} the referenced paths
 */
function htmlReferences(html) {
  const references = [];
  const pattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let match = pattern.exec(html);
  while (match !== null) {
    const value = match[1];
    if (!/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("#")) {
      references.push(value.split("#")[0].split("?")[0]);
    }
    match = pattern.exec(html);
  }
  return references;
}

/**
 * Check the manifest and the pages it points at.
 *
 * @param {object} manifest the manifest
 * @returns {Promise<string[]>} the problems found
 */
async function validateManifest(manifest) {
  const problems = [];

  if (manifest.manifest_version !== 3) {
    problems.push("Le manifeste doit être en version 3.");
  }

  const referenced = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
  ].filter(Boolean);

  for (const path of referenced) {
    if (!(await exists(path))) {
      problems.push(`Le fichier ${path} est référencé mais absent.`);
    }
  }

  for (const path of await listFiles(SOURCE_DIR)) {
    if (!path.endsWith(".html")) {
      continue;
    }
    const html = await readFile(join(SOURCE_DIR, path), "utf8");
    const base = dirname(path);
    for (const reference of htmlReferences(html)) {
      const resolved = normalize(join(base, reference)).split(sep).join("/");
      if (!(await exists(`src/${resolved}`))) {
        problems.push(`${path} référence ${reference}, qui est absent.`);
      }
    }
  }

  return problems;
}

/**
 * The CRC-32 of a buffer, as the ZIP format expects it.
 *
 * @param {Buffer} buffer the buffer
 * @returns {number} the checksum
 */
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

/**
 * Build a ZIP archive from a directory.
 *
 * The archive is written by hand, because the project has no build
 * dependency and a ZIP with stored or deflated entries is a few dozen lines.
 *
 * @param {string} directory the directory to archive
 * @param {string} archivePath where to write the archive
 * @returns {Promise<number>} the size of the archive
 */
async function writeArchive(directory, archivePath) {
  const files = await listFiles(directory);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const content = await readFile(join(directory, file));
    const deflated = deflateRawSync(content, { level: 9 });
    const useDeflate = deflated.length < content.length;
    const payload = useDeflate ? deflated : content;
    const method = useDeflate ? 8 : 0;
    const name = Buffer.from(file, "utf8");
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localParts, centralDirectory, end]);
  await writeFile(archivePath, archive);
  return archive.length;
}

/**
 * Build the packages.
 *
 * @returns {Promise<void>} resolves once the archives are written
 */
async function main() {
  const options = parseArguments();

  const manifest = JSON.parse(
    await readFile(join(EXTENSION_ROOT, "manifest.json"), "utf8"),
  );
  if (options.version) {
    manifest.version = options.version;
  }

  const problems = await validateManifest(manifest);
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`ERREUR ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  const firefoxManifest = toFirefoxManifest(manifest);
  const foundPlaceholders = PLACEHOLDERS.filter((placeholder) =>
    `${JSON.stringify(manifest)}${JSON.stringify(firefoxManifest)}`.includes(
      placeholder,
    ),
  );
  if (foundPlaceholders.length > 0) {
    const message =
      `Valeur(s) de remplacement à corriger : ${foundPlaceholders.join(", ")}.`;
    if (options.release) {
      console.error(`ERREUR ${message}`);
      process.exitCode = 1;
      return;
    }
    console.warn(`ATTENTION ${message}`);
  }

  await rm(DIST_DIR, { recursive: true, force: true });

  const targets = [
    { name: "chrome", manifest },
    { name: "firefox", manifest: firefoxManifest },
  ].filter((target) => options.target === "all" || target.name === options.target);

  for (const target of targets) {
    const directory = join(DIST_DIR, target.name);
    await mkdir(directory, { recursive: true });
    await cp(SOURCE_DIR, join(directory, "src"), { recursive: true });

    // The privacy policy is written once, on the website, and shipped with
    // the extension so it stays reachable even without a network.
    await cp(PRIVACY_POLICY, join(directory, "src", "confidentialite.html"));

    // The localised strings have to sit next to the manifest.
    await cp(LOCALES_DIR, join(directory, "_locales"), { recursive: true });

    await writeFile(
      join(directory, "manifest.json"),
      `${JSON.stringify(target.manifest, null, 2)}\n`,
      "utf8",
    );

    const archive = join(
      DIST_DIR,
      `url_safe-${target.manifest.version}-${target.name}.zip`,
    );
    const size = await writeArchive(directory, archive);
    console.log(
      `${target.name} : ${relative(EXTENSION_ROOT, archive).split(sep).join("/")} ` +
        `(${Math.round(size / 1024)} Kio)`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
