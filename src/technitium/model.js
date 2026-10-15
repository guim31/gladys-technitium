// -----------------------------------------------------------------------------
// Reading the Technitium answers into the plain values the integration uses.
// Pure functions, tested against answers of a real server
// (test/fixtures/technitium/real/) and the examples of APIDOCS.md.
// -----------------------------------------------------------------------------

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const count = (value) => {
  const number = finite(value);
  return number === null ? null : Math.max(0, Math.round(number));
};

/**
 * GET /api/settings/get → `{ version, blocking, pauseEndsAt }`.
 * `blocking` is 'enabled' or 'disabled'; `pauseEndsAt` the instant (ms) a
 * temporary pause ends, null for a lasting change.
 *
 * Technitium keeps the end of the last temporary pause after the pause was
 * cancelled, and reports it again if the blocking is turned off for good
 * before that instant: `ignoreTill` (an end known to be stale) filters it out.
 * @param {object} data
 * @param {number} now
 * @param {number|null} [ignoreTill]
 */
export function parseSettings(data, now, ignoreTill = null) {
  const version = typeof data?.version === 'string' && data.version ? data.version : null;
  if (typeof data?.enableBlocking !== 'boolean') {
    return { version, blocking: 'unknown', pauseEndsAt: null };
  }
  if (data.enableBlocking) {
    return { version, blocking: 'enabled', pauseEndsAt: null };
  }
  const till = Date.parse(data.temporaryDisableBlockingTill ?? '');
  const pauseEndsAt = Number.isFinite(till) && till > now && till !== ignoreTill ? till : null;
  return { version, blocking: 'disabled', pauseEndsAt };
}

/** The end of a pause in a temporaryDisableBlocking answer, null if unreadable. */
export function parsePauseEnd(data) {
  const till = Date.parse(data?.temporaryDisableBlockingTill ?? '');
  return Number.isFinite(till) ? till : null;
}

/**
 * GET /api/dashboard/stats/get → the dashboard counters.
 * `LastHour` covers the last 60 minutes, minute by minute. `LastDay` the 24
 * hours before the current one, hour by hour: the current hour is not in it
 * (StatsManager.GetLastDayHourWiseStats), so the day lags up to an hour.
 */
export function parseStats(data) {
  const stats = data?.stats ?? {};
  const total = count(stats.totalQueries);
  const blocked = count(stats.totalBlocked);
  return {
    queries: total,
    blocked,
    percentBlocked: total ? (100 * (blocked ?? 0)) / total : total === 0 ? 0 : null,
    clients: count(stats.totalClients),
    // Authoritative zones hosted by the server.
    zones: count(stats.zones),
    // Domains on the downloaded block lists, plus the ones blocked by hand.
    blockedDomains:
      count(stats.blockListZones) === null && count(stats.blockedZones) === null
        ? null
        : (count(stats.blockListZones) ?? 0) + (count(stats.blockedZones) ?? 0),
    cachedEntries: count(stats.cachedEntries),
  };
}

/** GET /api/user/checkForUpdate → `{ available, version }`. */
export function parseUpdate(data) {
  const available = data?.updateAvailable === true;
  return {
    available,
    version:
      available && typeof data.updateVersion === 'string' && data.updateVersion
        ? data.updateVersion
        : null,
  };
}

/**
 * DHCP: the number of leases when at least one scope is enabled, null when
 * the DHCP server is not in use (the feature is then not published).
 */
export function parseDhcp(scopes, leases) {
  const list = Array.isArray(scopes?.scopes) ? scopes.scopes : [];
  if (!list.some((scope) => scope?.enabled === true)) {
    return null;
  }
  const enabled = new Set(list.filter((scope) => scope?.enabled === true).map((s) => s.name));
  const all = Array.isArray(leases?.leases) ? leases.leases : [];
  return all.filter((lease) => enabled.has(lease?.scope)).length;
}
