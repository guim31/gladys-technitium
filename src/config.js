// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three Technitium servers, each in its own slot (address, API token,
// name). The slot number is the device identity: changing the address of a
// slot (an IP for a name, HTTP for HTTPS) keeps the device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// What turning the blocking switch off does: a pause of that many minutes,
// `0` until it is turned back on.
export const SWITCH_OFF_MINUTES = ['0', '5', '15', '30', '60'];

export const DEFAULT_CONFIG = {
  server_1_url: '',
  server_1_token: '',
  server_1_name: '',
  server_2_url: '',
  server_2_token: '',
  server_2_name: '',
  server_3_url: '',
  server_3_token: '',
  server_3_name: '',
  allow_self_signed: false,
  poll_interval: '60',
  switch_off_minutes: '5',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

// The port of the Technitium web console and API over HTTP.
export const DEFAULT_PORT = 5380;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `dns.home:5380`), or the URL copied from the browser
 * (`https://dns.example.net/`). A bare host gets HTTP and the console port
 * 5380; a URL with a scheme keeps its own port (a reverse proxy on 443).
 * The path is dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!hasScheme && url.port === '') {
    url.port = String(DEFAULT_PORT);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const servers = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`server_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseServerUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    servers.push({
      slot,
      url,
      token: text(`server_${slot}_token`),
      name: text(`server_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    servers,
    invalidSlots: invalid,
    allowSelfSigned: source.allow_self_signed === true || source.allow_self_signed === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    switchOffMinutes: Number(pick('switch_off_minutes', SWITCH_OFF_MINUTES)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
