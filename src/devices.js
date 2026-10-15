// -----------------------------------------------------------------------------
// One Gladys device per Technitium DNS server.
//
// Identity: the configuration slot (1 to 3), not the address: switching a
// slot from an IP to a host name, or from HTTP to HTTPS, keeps the device and
// its history. The API exposes no stable instance id to use instead (the
// server domain name can be renamed).
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - blocking: switch/binary, writable — 1 blocking on, 0 off (a pause of
//     the configured length, or until turned back on);
//   - queries of the last hour, of the last day; blocked queries and their
//     share, clients of the last day: counter-sensor/integer (the share is
//     rounded: Gladys has no decimal percentage sensor; the widget shows the
//     decimal);
//   - authoritative zones, blocked domains: counter-sensor/integer;
//   - update available: counter-sensor/integer, 0 or 1 (Gladys has no yes/no
//     "update" couple; a scene can test "= 1");
//   - version: text/text;
//   - DHCP leases: counter-sensor/integer, only when a DHCP scope is enabled.
//
// The server being reachable is the device transport (local / unreachable),
// with its own scene triggers, not a feature.
//
// The devices are published with should_poll: false: the integration reads
// the servers on its own timer (src/hub.js), at the interval chosen in the
// configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SLOTS, hostOf } from './config.js';

export const DEVICE_TYPE = 'technitium';
export const URL_PARAM = 'TECHNITIUM_URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  BLOCKING: 'blocking',
  QUERIES_HOUR: 'queries_last_hour',
  QUERIES_DAY: 'queries_last_day',
  BLOCKED_DAY: 'blocked_last_day',
  BLOCKED_PERCENT_DAY: 'blocked_percent_last_day',
  CLIENTS_DAY: 'clients_last_day',
  ZONES: 'zones',
  BLOCKED_DOMAINS: 'blocked_domains',
  UPDATE: 'update_available',
  VERSION: 'version',
  DHCP_LEASES: 'dhcp_leases',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.BLOCKING]: 'Blocking',
    [FEATURE_KEYS.QUERIES_HOUR]: 'DNS queries (last hour)',
    [FEATURE_KEYS.QUERIES_DAY]: 'DNS queries (24 h)',
    [FEATURE_KEYS.BLOCKED_DAY]: 'Blocked queries (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT_DAY]: 'Share blocked (24 h)',
    [FEATURE_KEYS.CLIENTS_DAY]: 'Clients (24 h)',
    [FEATURE_KEYS.ZONES]: 'Zones',
    [FEATURE_KEYS.BLOCKED_DOMAINS]: 'Blocked domains',
    [FEATURE_KEYS.UPDATE]: 'Update available',
    [FEATURE_KEYS.VERSION]: 'Version',
    [FEATURE_KEYS.DHCP_LEASES]: 'DHCP leases',
  },
  fr: {
    [FEATURE_KEYS.BLOCKING]: 'Blocage',
    [FEATURE_KEYS.QUERIES_HOUR]: 'Requêtes DNS (dernière heure)',
    [FEATURE_KEYS.QUERIES_DAY]: 'Requêtes DNS (24 h)',
    [FEATURE_KEYS.BLOCKED_DAY]: 'Requêtes bloquées (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT_DAY]: 'Part bloquée (24 h)',
    [FEATURE_KEYS.CLIENTS_DAY]: 'Clients (24 h)',
    [FEATURE_KEYS.ZONES]: 'Zones',
    [FEATURE_KEYS.BLOCKED_DOMAINS]: 'Domaines bloqués',
    [FEATURE_KEYS.UPDATE]: 'Mise à jour disponible',
    [FEATURE_KEYS.VERSION]: 'Version',
    [FEATURE_KEYS.DHCP_LEASES]: 'Baux DHCP',
  },
  de: {
    [FEATURE_KEYS.BLOCKING]: 'Blockierung',
    [FEATURE_KEYS.QUERIES_HOUR]: 'DNS-Anfragen (letzte Stunde)',
    [FEATURE_KEYS.QUERIES_DAY]: 'DNS-Anfragen (24 h)',
    [FEATURE_KEYS.BLOCKED_DAY]: 'Blockierte Anfragen (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT_DAY]: 'Anteil blockiert (24 h)',
    [FEATURE_KEYS.CLIENTS_DAY]: 'Clients (24 h)',
    [FEATURE_KEYS.ZONES]: 'Zonen',
    [FEATURE_KEYS.BLOCKED_DOMAINS]: 'Blockierte Domains',
    [FEATURE_KEYS.UPDATE]: 'Update verfügbar',
    [FEATURE_KEYS.VERSION]: 'Version',
    [FEATURE_KEYS.DHCP_LEASES]: 'DHCP-Leases',
  },
  es: {
    [FEATURE_KEYS.BLOCKING]: 'Bloqueo',
    [FEATURE_KEYS.QUERIES_HOUR]: 'Consultas DNS (última hora)',
    [FEATURE_KEYS.QUERIES_DAY]: 'Consultas DNS (24 h)',
    [FEATURE_KEYS.BLOCKED_DAY]: 'Consultas bloqueadas (24 h)',
    [FEATURE_KEYS.BLOCKED_PERCENT_DAY]: 'Proporción bloqueada (24 h)',
    [FEATURE_KEYS.CLIENTS_DAY]: 'Clientes (24 h)',
    [FEATURE_KEYS.ZONES]: 'Zonas',
    [FEATURE_KEYS.BLOCKED_DOMAINS]: 'Dominios bloqueados',
    [FEATURE_KEYS.UPDATE]: 'Actualización disponible',
    [FEATURE_KEYS.VERSION]: 'Versión',
    [FEATURE_KEYS.DHCP_LEASES]: 'Concesiones DHCP',
  },
};

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 1_000_000_000;

const counter = (key, value, extra = {}) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: COUNTER_MAX,
    ...extra,
  },
  value,
});

// Order = display order in Gladys.
const FEATURES = [
  {
    key: FEATURE_KEYS.BLOCKING,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    value: (snapshot) =>
      snapshot.blocking === 'enabled' ? 1 : snapshot.blocking === 'disabled' ? 0 : null,
  },
  counter(FEATURE_KEYS.QUERIES_HOUR, (snapshot) => snapshot.hour?.queries ?? null),
  counter(FEATURE_KEYS.QUERIES_DAY, (snapshot) => snapshot.day?.queries ?? null),
  counter(FEATURE_KEYS.BLOCKED_DAY, (snapshot) => snapshot.day?.blocked ?? null),
  counter(
    FEATURE_KEYS.BLOCKED_PERCENT_DAY,
    (snapshot) => {
      const percent = snapshot.day?.percentBlocked;
      return typeof percent === 'number' ? Math.round(percent) : null;
    },
    { unit: DEVICE_FEATURE_UNITS.PERCENT, max: 100 },
  ),
  counter(FEATURE_KEYS.CLIENTS_DAY, (snapshot) => snapshot.day?.clients ?? null),
  counter(FEATURE_KEYS.ZONES, (snapshot) => snapshot.hour?.zones ?? null),
  counter(FEATURE_KEYS.BLOCKED_DOMAINS, (snapshot) => snapshot.hour?.blockedDomains ?? null),
  counter(
    FEATURE_KEYS.UPDATE,
    (snapshot) => (snapshot.update ? (snapshot.update.available ? 1 : 0) : null),
    { max: 1, keep_history: false },
  ),
  {
    key: FEATURE_KEYS.VERSION,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      // NOT NULL in the core, even for a text.
      min: 0,
      max: 0,
    },
    value: (snapshot) => snapshot.version ?? null,
  },
  {
    ...counter(FEATURE_KEYS.DHCP_LEASES, (snapshot) => snapshot.dhcpLeases ?? null, {
      max: 65_535,
    }),
    // Published only when the server runs a DHCP scope.
    when: (snapshot) => typeof snapshot.dhcpLeases === 'number',
  },
];

/** External ids of a server's device and features. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

/** The slot of a device external id, null when it is not one of ours. */
export function slotOf(gladys, externalId) {
  for (const slot of SLOTS) {
    if (deviceIds(gladys, slot).device === externalId) {
      return slot;
    }
  }
  return null;
}

/** The name shown for a server: the one typed in the configuration, else its address. */
export const serverName = (server) => server.name ?? `Technitium ${hostOf(server.url)}`;

const present = (feature, snapshot) => !feature.when || feature.when(snapshot ?? {});

/**
 * The discovery payload of a server.
 * @param {object} gladys SDK client
 * @param {{ slot: number, url: string, name: string|null }} server
 * @param {string} language feature names language
 * @param {object} [snapshot] the last reading (decides the DHCP feature)
 */
export function buildDevice(gladys, server, language = 'en', snapshot = {}) {
  const ids = deviceIds(gladys, server.slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(server),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: server.url }],
    features: FEATURES.filter((feature) => present(feature, snapshot)).map(
      ({ key, definition }) => ({
        ...definition,
        name: names[key],
        external_id: ids.feature(key),
      }),
    ),
  };
}

/**
 * The value of every feature for a server snapshot (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|string|null }>}
 */
export function featureValues(gladys, slot, snapshot) {
  const ids = deviceIds(gladys, slot);
  return FEATURES.map((feature) => ({
    key: feature.key,
    externalId: ids.feature(feature.key),
    value: present(feature, snapshot) ? feature.value(snapshot) : null,
  }));
}
