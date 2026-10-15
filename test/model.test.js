// -----------------------------------------------------------------------------
// Reading the Technitium answers (a real server 15.6.1, examples of APIDOCS.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDhcp,
  parsePauseEnd,
  parseSettings,
  parseStats,
  parseUpdate,
} from '../src/technitium/model.js';
import { fixture } from './helpers/fakeTechnitium.js';

const PAUSED_AT = Date.parse('2026-10-15T23:41:00Z');

test('blocking on, version (real answer)', () => {
  assert.deepEqual(parseSettings(fixture('real/settings').response, PAUSED_AT), {
    version: '15.6.1',
    blocking: 'enabled',
    pauseEndsAt: null,
  });
});

test('a temporary pause and its end (real answers)', () => {
  const settings = fixture('real/settings-paused').response;
  const till = parsePauseEnd(fixture('real/temporary-disable').response);
  assert.equal(till, Date.parse(settings.temporaryDisableBlockingTill));
  assert.deepEqual(parseSettings(settings, PAUSED_AT), {
    version: '15.6.1',
    blocking: 'disabled',
    pauseEndsAt: till,
  });
  // Past its end, or known to be stale: a lasting change.
  assert.equal(parseSettings(settings, till + 1).pauseEndsAt, null);
  assert.equal(parseSettings(settings, PAUSED_AT, till).pauseEndsAt, null);
  assert.equal(parsePauseEnd({}), null);
});

test('settings without a blocking state: unknown', () => {
  assert.equal(parseSettings({}, 0).blocking, 'unknown');
  assert.equal(parseSettings(null, 0).version, null);
});

test('statistics: real last hour, documentation example for the day', () => {
  assert.deepEqual(parseStats(fixture('real/stats-last-hour').response), {
    queries: 24,
    blocked: 4,
    percentBlocked: (100 * 4) / 24,
    clients: 1,
    zones: 0,
    blockedDomains: 1,
    cachedEntries: 9,
  });
  const day = parseStats(fixture('stats-last-day').response);
  assert.equal(day.queries, 925);
  assert.equal(day.blocked, 49);
  assert.equal(day.clients, 6);
  assert.equal(day.zones, 19);
  // Block list domains plus the domains blocked by hand.
  assert.equal(day.blockedDomains, 307448);
});

test('statistics: no query yet is 0 %, an empty answer is nothing', () => {
  assert.equal(parseStats(fixture('real/stats-last-day').response).percentBlocked, 0);
  assert.deepEqual(parseStats({}), {
    queries: null,
    blocked: null,
    percentBlocked: null,
    clients: null,
    zones: null,
    blockedDomains: null,
    cachedEntries: null,
  });
});

test('update check: none (real answer), available (documentation example)', () => {
  assert.deepEqual(parseUpdate(fixture('real/check-for-update').response), {
    available: false,
    version: null,
  });
  assert.deepEqual(parseUpdate(fixture('check-for-update-available').response), {
    available: true,
    version: '15.7',
  });
});

test('DHCP: no enabled scope means no DHCP; leases of the enabled scopes only', () => {
  assert.equal(
    parseDhcp(fixture('real/dhcp-scopes').response, fixture('real/dhcp-leases-empty').response),
    null,
  );
  assert.equal(
    parseDhcp(fixture('dhcp-scopes-enabled').response, fixture('dhcp-leases').response),
    3,
  );
  assert.equal(parseDhcp(fixture('dhcp-scopes-enabled').response, {}), 0);
});
