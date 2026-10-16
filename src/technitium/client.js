// -----------------------------------------------------------------------------
// Technitium DNS Server HTTP API client (APIDOCS.md of
// TechnitiumSoftware/DnsServer, checked on a real server 15.6.1).
//
// Authentication: an API token, created in the web console (user menu →
// Create API Token) or by /api/user/createToken. It does not expire and is
// sent in the `Authorization: Bearer` header, which needs version 15.0 or
// later (older versions only read a `token=` query parameter, which would end
// up in proxy logs: not supported).
//
// Every answer is HTTP 200 with a JSON `status`: `ok`, `error` (with an
// `errorMessage`, "Access was denied." for a missing permission),
// `invalid-token` or `2fa-required`. An unknown path is a 404 without body.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address or port, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // token refused or expired
  DENIED: 'denied', // the token's user lacks a permission
  NOT_TECHNITIUM: 'not_technitium', // something answers, not the Technitium API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other error
});

export class TechnitiumError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TechnitiumError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new TechnitiumError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new TechnitiumError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

/** A redirect target fit for the logs: no user, password or query string. */
export function safeLocation(location) {
  if (typeof location !== 'string' || location === '') {
    return '?';
  }
  try {
    const url = new URL(location, 'http://relative.invalid');
    return url.host === 'relative.invalid' ? url.pathname : `${url.origin}${url.pathname}`;
  } catch {
    return '?';
  }
}

// Server error messages are logged: keep them short and on one line.
const shortMessage = (text) =>
  typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 160) : 'unknown error';

export class TechnitiumClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port]`
   * @param {string} options.token API token
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, token, insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  /**
   * One API call. Resolves with the `response` object of a `status: ok`
   * answer (`{}` when there is none).
   * @param {string} path e.g. `/api/settings/get`
   * @param {Record<string, string|number|boolean>} [query]
   */
  async call(path, query = {}) {
    if (!this.token) {
      throw new TechnitiumError(ERROR_KINDS.AUTH, 'No API token');
    }
    const search = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    ).toString();
    let response;
    try {
      response = await this.request(`${this.url}${path}${search ? `?${search}` : ''}`, {
        headers: { authorization: `Bearer ${this.token}` },
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new TechnitiumError(
        ERROR_KINDS.REDIRECT,
        `Redirected to ${safeLocation(response.headers?.location)}`,
        { status },
      );
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      data = undefined;
    }
    if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
      // A 404 is the answer of a Technitium server to an unknown path too, but
      // every path used here exists since version 10: whatever answered is not one.
      // A 5xx without JSON is a reverse proxy whose Technitium is down: silence.
      throw new TechnitiumError(
        status >= 500
          ? ERROR_KINDS.UNREACHABLE
          : status === 200 || status === 404
            ? ERROR_KINDS.NOT_TECHNITIUM
            : ERROR_KINDS.HTTP,
        `${path} answered HTTP ${status} without the Technitium JSON`,
        { status },
      );
    }
    if (data.status === 'ok') {
      return data.response && typeof data.response === 'object' ? data.response : {};
    }
    if (data.status === 'invalid-token') {
      throw new TechnitiumError(ERROR_KINDS.AUTH, 'Token refused or expired', { status });
    }
    if (data.status === '2fa-required') {
      throw new TechnitiumError(ERROR_KINDS.AUTH, 'Two-factor authentication required', {
        status,
      });
    }
    if (/access was denied/i.test(data.errorMessage ?? '')) {
      throw new TechnitiumError(ERROR_KINDS.DENIED, `${path}: access denied`, { status });
    }
    throw new TechnitiumError(ERROR_KINDS.HTTP, `${path}: ${shortMessage(data.errorMessage)}`, {
      status,
    });
  }

  /** Version, blocking state and temporary pause end (permission Settings: View). */
  getSettings() {
    return this.call('/api/settings/get');
  }

  /**
   * Dashboard statistics (permission Dashboard: View).
   * @param {'LastHour'|'LastDay'} type
   */
  getStats(type) {
    return this.call('/api/dashboard/stats/get', { type, utc: true });
  }

  /** Asks the server to check for an update (no permission needed). */
  checkForUpdate() {
    return this.call('/api/user/checkForUpdate');
  }

  /** DHCP scopes and leases (permission DhcpServer: View). */
  listDhcpScopes() {
    return this.call('/api/dhcp/scopes/list');
  }

  listDhcpLeases() {
    return this.call('/api/dhcp/leases/list');
  }

  /** Blocking off until `minutes` have passed, then on again (Settings: Modify). */
  temporaryDisableBlocking(minutes) {
    return this.call('/api/settings/temporaryDisableBlocking', { minutes });
  }

  /**
   * Blocking on or off for good (Settings: Modify). Answers the settings.
   * Turning it on also cancels a running temporary pause.
   */
  setBlocking(enabled) {
    return this.call('/api/settings/set', { enableBlocking: enabled });
  }

  /** Empties the DNS cache (permission Cache: Delete). */
  flushCache() {
    return this.call('/api/cache/flush');
  }
}
