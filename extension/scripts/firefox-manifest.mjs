/**
 * The Firefox manifest, produced from the Chrome one.
 *
 * Chrome runs the background context as a service worker, Firefox runs it as
 * an event page, so the service worker key becomes a scripts list. The Gecko
 * block is added, declaring that the extension collects nothing.
 *
 * The module is separate from the build script so the test suite can check
 * the result without running a build.
 */

/** The identifier the extension is signed with on Firefox. */
export const GECKO_ID = "url-safe@url-safe.fr";

/** The oldest Firefox the extension is tested on. */
export const GECKO_MIN_VERSION = "140.0";

/**
 * The oldest Firefox for Android the extension is tested on.
 *
 * The data collection declaration is only understood from Firefox for
 * Android 142, so the Android block has to ask for at least that version.
 */
export const GECKO_ANDROID_MIN_VERSION = "142.0";

/**
 * Produce the Firefox manifest from the Chrome one.
 *
 * @param {object} manifest the Chrome manifest
 * @returns {object} the Firefox manifest
 */
export function toFirefoxManifest(manifest) {
  const { service_worker: serviceWorker, ...background } = manifest.background;
  const firefox = {
    ...manifest,
    background: { ...background, scripts: [serviceWorker] },
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: GECKO_MIN_VERSION,
        data_collection_permissions: {
          required: ["none"],
          optional: ["technicalAndInteraction"],
        },
      },
      gecko_android: {
        strict_min_version: GECKO_ANDROID_MIN_VERSION,
      },
    },
  };

  delete firefox.background.type;
  return firefox;
}
