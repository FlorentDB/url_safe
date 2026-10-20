#!/usr/bin/env node
/**
 * Install the package in a real Firefox.
 *
 * The unit tests prove the rules and the manifest tests prove the manifest,
 * but neither of them proves that Firefox accepts the package. This script
 * does: it starts a Firefox, installs the package through the standard
 * WebDriver BiDi command, and reports the identifier the browser gave it.
 *
 * The pages of the extension cannot be reached from the outside. Firefox
 * refuses to open a ``moz-extension://`` address in a tab that the driver
 * created, and it refuses the driver on privileged pages such as
 * ``about:debugging``. The pages are covered by the test suite, which
 * renders the same markup against a stand-in for the DOM, and by a click in
 * the browser.
 *
 * Run with::
 *
 *     node extension/scripts/smoke-test.mjs
 *
 * It needs a Firefox on the machine, and it starts one of its own.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = join(EXTENSION_ROOT, "dist", "firefox");

const PORT = 9222;

/** The identifier the extension declares for itself. */
const ADDON_ID = "lien-clair@lienclair.example";

/**
 * Wait for a condition to become true.
 *
 * @param {Function} condition the condition, returning a truthy value
 * @param {string} what the description, for the error message
 * @param {number} timeout how long to wait, in milliseconds
 * @returns {Promise<any>} the value the condition returned
 */
async function waitFor(condition, what, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await condition();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve_) => setTimeout(resolve_, 250));
  }
  throw new Error(
    `Délai dépassé : ${what}${lastError ? ` (${lastError.message})` : ""}`,
  );
}

/**
 * A tiny JSON request over a WebSocket.
 *
 * @param {string} url the WebSocket address
 * @returns {Promise<object>} a client with a `send` method
 */
function connect(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;

    const timer = setTimeout(() => {
      rejectPromise(new Error("Le WebSocket ne s’est pas ouvert à temps."));
      socket.close();
    }, 10000);

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: done, reject, method } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          const error = message.error;
          const detail = error.message ?? error.type ?? JSON.stringify(error);
          reject(new Error(`${method} : ${detail}`));
        } else {
          done(message.result);
        }
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      rejectPromise(new Error("WebSocket en erreur"));
    });

    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolvePromise({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          return new Promise((done, reject) => {
            pending.set(id, { resolve: done, reject, method });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    });
  });
}


/**
 * Install the package through the WebDriver BiDi extension domain.
 *
 * @param {object} client the BiDi client
 * @param {string} path the absolute path of the package
 * @returns {Promise<string>} the identifier of the add-on
 */
async function installExtension(client, path) {
  const installed = await client.send("webExtension.install", {
    extensionData: { type: "path", path },
  });
  return installed?.extension ?? "inconnu";
}

/**
 * Start a Firefox on the debugging port and wait for its BiDi socket.
 *
 * @param {string} profile the profile directory
 * @returns {Promise<object>} the BiDi client
 */
async function startFirefox(profile) {
  const firefox = spawn(
    "firefox",
    [
      "--profile",
      profile,
      "--remote-debugging-port",
      String(PORT),
      "--no-remote",
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  firefox.unref();

  return waitFor(
    async () => {
      try {
        return await connect(`ws://127.0.0.1:${PORT}/session`);
      } catch {
        return null;
      }
    },
    "Firefox n’ouvre pas le port BiDi",
  );
}

/**
 * Stop a Firefox and wait for it to release the port.
 *
 * @param {string} profile the profile directory
 * @returns {Promise<void>} resolves once the browser is gone
 */
async function stopFirefox(profile) {
  spawn("pkill", ["-f", `firefox.*--profile ${profile}`], { stdio: "ignore" });
  await waitFor(
    async () => {
      const response = await fetch(
        `http://127.0.0.1:${PORT}/json/version`,
      ).catch(() => null);
      return response === null || !response.ok;
    },
    "Firefox ne libère pas le port",
    20000,
  );
}

/**
 * Run the smoke test.
 *
 * @returns {Promise<void>} resolves once the extension is installed
 */
async function main() {
  const profile = join(tmpdir(), `lien-clair-firefox-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  console.log(`Profil : ${profile}`);

  const client = await startFirefox(profile);
  try {
    await client.send("session.new", { capabilities: {} });

    const installed = await installExtension(client, resolve(EXTENSION_DIR));
    console.log(`Extension installée : ${installed}`);

    if (installed !== ADDON_ID) {
      throw new Error(`Identifiant inattendu : ${installed}`);
    }

    console.log(
      "\nOK : Firefox accepte le paquet et charge l’extension sans erreur.",
    );
  } finally {
    client.close();
    await stopFirefox(profile);
  }
}

main().catch((error) => {
  console.error(`ÉCHEC : ${error.message}`);
  process.exitCode = 1;
});
