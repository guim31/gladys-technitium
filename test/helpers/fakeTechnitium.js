// -----------------------------------------------------------------------------
// In-memory Technitium DNS servers behind the `request` seam of the client
// (src/technitium/http.js). Answers are built from the answers of a real
// server and the examples of APIDOCS.md (test/fixtures/technitium/), with the
// behaviors that matter: the bearer token, a user without permission, the
// blocking state with its temporary pause (and the stale end of a cancelled
// pause the real server keeps reporting), DHCP, a server that does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/technitium/${name}.json`, import.meta.url), 'utf8'));

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const ok = (response) => json(200, { response, server: 'dns-server', status: 'ok' });

export const TOKEN = 'token-of-test';

export class FakeTechnitium {
  /**
   * @param {object} [options]
   * @param {string} [options.token] the accepted API token
   * @param {boolean} [options.update] an update is available
   * @param {boolean} [options.dhcp] a DHCP scope is enabled
   * @param {string[]} [options.denied] path prefixes the token user may not call
   * @param {'technitium'|'other'} [options.kind]
   * @param {() => number} [options.now] clock for the pause
   */
  constructor({
    token = TOKEN,
    update = false,
    dhcp = false,
    denied = [],
    kind = 'technitium',
    now = () => Date.now(),
  } = {}) {
    this.token = token;
    this.kind = kind;
    this.denied = denied;
    this.now = now;
    this.online = true;
    this.settings = fixture('real/settings').response;
    this.hour = fixture('real/stats-last-hour').response;
    this.day = fixture('stats-last-day').response;
    this.update = fixture(update ? 'check-for-update-available' : 'real/check-for-update').response;
    this.scopes = fixture(dhcp ? 'dhcp-scopes-enabled' : 'real/dhcp-scopes').response;
    this.leases = fixture(dhcp ? 'dhcp-leases' : 'real/dhcp-leases-empty').response;
    this.blocking = true;
    this.pauseEnd = null; // blocking comes back at this instant
    this.lastTill = null; // kept after a cancelled pause, as the real server does
    this.flushes = 0;
    this.requests = [];
  }

  /** Blocking changed from elsewhere (the web console). */
  setBlocking(enabled, minutes = null) {
    if (minutes) {
      this.blocking = false;
      this.pauseEnd = this.now() + minutes * 60_000;
      this.lastTill = this.pauseEnd;
      return;
    }
    this.blocking = enabled;
    if (enabled) {
      this.pauseEnd = null; // EnableBlocking = true stops the pause timer
    }
  }

  currentSettings() {
    if (this.pauseEnd !== null && this.now() >= this.pauseEnd) {
      this.blocking = true;
      this.pauseEnd = null;
    }
    const settings = { ...this.settings, enableBlocking: this.blocking };
    delete settings.temporaryDisableBlockingTill;
    if (!this.blocking && this.lastTill !== null && this.now() < this.lastTill) {
      settings.temporaryDisableBlockingTill = new Date(this.lastTill).toISOString();
    }
    return settings;
  }

  /** The `request` function given to the client. */
  handle(url, { headers = {}, insecure } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push({
      path: pathname,
      query: Object.fromEntries(searchParams),
      headers,
      insecure,
    });
    if (!this.online) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.kind === 'other') {
      return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not Found' };
    }
    if (headers.authorization !== `Bearer ${this.token}`) {
      return json(200, fixture('real/invalid-token'));
    }
    if (this.denied.some((prefix) => pathname.startsWith(prefix))) {
      return json(200, fixture('real/access-denied'));
    }
    switch (pathname) {
      case '/api/settings/get':
        return ok(this.currentSettings());
      case '/api/settings/set':
        if (searchParams.has('enableBlocking')) {
          this.setBlocking(searchParams.get('enableBlocking') === 'true');
        }
        return ok(this.currentSettings());
      case '/api/settings/temporaryDisableBlocking': {
        const minutes = Number(searchParams.get('minutes'));
        if (!Number.isInteger(minutes)) {
          return json(200, fixture('real/error'));
        }
        // minutes=0: the timer fires at once, as on the real server.
        this.setBlocking(false, minutes);
        const till = new Date(this.pauseEnd ?? this.now()).toISOString();
        if (minutes <= 0) {
          this.setBlocking(true);
        }
        return ok({ temporaryDisableBlockingTill: till });
      }
      case '/api/dashboard/stats/get':
        if (searchParams.get('type') === 'LastHour') {
          return ok(this.hour);
        }
        if (searchParams.get('type') === 'LastDay') {
          return ok(this.day);
        }
        return json(200, fixture('real/error'));
      case '/api/user/checkForUpdate':
        return ok(this.update);
      case '/api/dhcp/scopes/list':
        return ok(this.scopes);
      case '/api/dhcp/leases/list':
        return ok(this.leases);
      case '/api/cache/flush':
        this.flushes += 1;
        return ok(undefined);
      default:
        return { status: 404, headers: {}, body: '' };
    }
  }
}

/**
 * A network of fake servers, by base URL: the `request` seam of the hub.
 * An address without a server does not answer.
 */
export function createNetwork(servers = {}) {
  const byOrigin = new Map(Object.entries(servers));
  return {
    servers: byOrigin,
    async request(url, options) {
      const server = byOrigin.get(new URL(url).origin);
      if (!server) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return server.handle(url, options);
    },
  };
}
