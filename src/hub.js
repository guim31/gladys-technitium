// -----------------------------------------------------------------------------
// The Technitium hub: one record per configured server, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired on transitions, and the
// blocking commands of the switch, the widget and the scene actions.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// and the scene events must fire even for a server whose device was not added.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, deviceIds, featureValues, serverName, slotOf } from './devices.js';
import { ERROR_KINDS, TechnitiumClient } from './technitium/client.js';
import {
  parseDhcp,
  parsePauseEnd,
  parseSettings,
  parseStats,
  parseUpdate,
} from './technitium/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATS_TEXT,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'technitium-hub' });

export const WIDGET_KEY = 'technitium';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  PAUSED: 'blocking_paused',
  RESUMED: 'blocking_resumed',
  UPDATE: 'update_available',
  UNREACHABLE: 'server_unreachable',
  RECOVERED: 'server_recovered',
});

// Who changed the blocking state (`origin` filter and variable of the triggers).
export const ORIGINS = Object.freeze({
  GLADYS: 'gladys', // the switch, the widget or a scene action
  TECHNITIUM: 'technitium', // anything else: the Technitium web console, another tool
  TIMER: 'timer', // the end of a pause
});

export const HUB_TIMINGS = {
  // Each check makes the server ask the Technitium update service: a few a day.
  updateMs: 6 * 60 * 60_000,
  // An unchanged value is published again this often, so Gladys never shows
  // it as stale ("no recent value" after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a server counts as down (scene event).
  downAfterFailures: 2,
  // A blocking change seen this long after a Gladys command is Gladys' own.
  ownChangeMs: 30_000,
  // Read again this long after a pause ends, to publish the resume promptly.
  pauseEndSlackMs: 2_000,
};

// Longest pause accepted from a scene or the widget: one day.
export const MAX_PAUSE_MINUTES = 1440;
export const DEFAULT_PAUSE_MINUTES = 5;

/** Minutes of a pause typed in a scene or a form: a number, or a string ("5", "2,5"). */
export function parseMinutes(raw, fallback = DEFAULT_PAUSE_MINUTES) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN;
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.min(MAX_PAUSE_MINUTES, Math.round(number));
}

const signature = (server, config) =>
  JSON.stringify([server.url, server.token, config.allowSelfSigned]);

/** An error of a DHCP call that only means "no DHCP to show". */
const noDhcp = (err) => err.kind === ERROR_KINDS.DENIED || err.kind === ERROR_KINDS.HTTP;

export class TechnitiumHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/technitium/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} server records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.saved = { announcedUpdates: {} };
    /** Whether the published device of a slot carries the DHCP feature. */
    this.dhcpPublished = new Map();
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged as warnings, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (servers connected, lost, back, user
  // commands). A problem that repeats every cycle is logged once at its own
  // level, then at debug until it clears. LOG_LEVEL=debug shows everything.

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      announcedUpdates:
        saved.announcedUpdates && typeof saved.announcedUpdates === 'object'
          ? saved.announcedUpdates
          : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
    for (const record of this.records.values()) {
      await this.publishStates(record, { force: true });
    }
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.servers.map((server) => [server.slot, server]));
    for (const [slot, record] of this.records) {
      const server = wanted.get(slot);
      if (!server || record.signature !== signature(server, config)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    for (const server of config.servers) {
      const record = this.records.get(server.slot);
      if (record) {
        record.server = server; // a new name: same session
      } else {
        this.records.set(server.slot, this.newRecord(server, config));
      }
    }
    await this.publishDevices();
    await this.pollAll({ update: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      client: new TechnitiumClient({
        url: server.url,
        token: server.token,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      snapshot: {
        reachable: null,
        version: null,
        blocking: null,
        pauseEndsAt: null,
        hour: null,
        day: null,
        update: null,
        dhcpLeases: null,
      },
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      pausedAt: null,
      // End of a cancelled pause that Technitium may still report (src/technitium/model.js).
      staleTill: null,
      ownChangeUntil: 0,
      updateAt: 0,
      polling: null,
      retryTimer: null,
      pauseTimer: null,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
    clearTimeout(record.pauseTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
      clearTimeout(record.pauseTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Poll failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices -----------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) => {
      this.dhcpPublished.set(record.server.slot, typeof record.snapshot.dhcpLeases === 'number');
      return buildDevice(this.gladys, record.server, this.config.language, record.snapshot);
    });
    // Even an empty list: the Discovery tab then shows no stale server.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the devices again, read the servers. */
  async rediscover() {
    await this.pollAll({ update: true });
    await this.publishDevices();
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      return;
    }
    await this.publishStates(record, { force: true });
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the servers -------------------------------------------------------

  async pollAll({ update = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { update })));
    await this.afterChanges(changes.some(Boolean));
  }

  /** Gladys asks for a refresh (onPoll): read that server now. */
  async pollDevice(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (record) {
      await this.afterChanges(await this.poll(record, { update: false }));
    }
  }

  /**
   * Read one server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record, { update }) {
    record.polling ??= this.read(record, { update }).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record, { update }) {
    const due = update || this.now() - record.updateAt >= this.timings.updateMs;
    const { client } = record;
    try {
      const [settings, hour, day, updateInfo, dhcp] = await Promise.all([
        client.getSettings(),
        client.getStats('LastHour'),
        client.getStats('LastDay'),
        due ? client.checkForUpdate().catch((err) => err) : null,
        Promise.all([client.listDhcpScopes(), client.listDhcpLeases()]).catch((err) => err),
      ]);
      let updateSnapshot = record.snapshot.update;
      const updateKey = `update:${record.server.slot}`;
      if (updateInfo && !(updateInfo instanceof Error)) {
        updateSnapshot = parseUpdate(updateInfo);
        record.updateAt = this.now();
        this.resolved(updateKey);
      } else if (updateInfo instanceof Error) {
        // Tried again at the next update check, not at every reading.
        record.updateAt = this.now();
        this.problem(
          updateKey,
          `${this.label(record)}: update check failed: ${updateInfo.message}`,
        );
      }
      let dhcpLeases = null;
      if (dhcp instanceof Error) {
        if (!dhcp.kind || !noDhcp(dhcp)) {
          throw dhcp;
        }
        // A token without the DHCP permission, or no DHCP: nothing to show.
        logger.debug(`${this.label(record)}: DHCP not read: ${dhcp.message}`);
      } else {
        dhcpLeases = parseDhcp(dhcp[0], dhcp[1]);
      }
      return await this.applySuccess(record, {
        ...parseSettings(settings, this.now(), record.staleTill),
        hour: parseStats(hour),
        day: parseStats(day),
        update: updateSnapshot,
        dhcpLeases,
      });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  label(record) {
    return `Technitium ${record.server.slot} (${serverName(record.server)})`;
  }

  async applySuccess(record, next, { origin } = {}) {
    if (record.dropped) {
      return false;
    }
    let widgetChanged = record.snapshot.reachable !== true || record.error !== null;
    if (record.down) {
      const downMinutes = Math.round((this.now() - record.downSince) / 60_000);
      logger.info(`${this.label(record)} answers again after ${downMinutes} min`);
      await this.fire(TRIGGERS.RECOVERED, record, { down_minutes: downMinutes });
    } else if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (record.snapshot.reachable === null) {
      logger.info(`${this.label(record)}: connected`);
    }
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    record.error = null;

    const previous = record.snapshot;
    widgetChanged ||= previous.blocking !== next.blocking;
    await this.blockingTransition(record, previous, next, origin);
    await this.updateTransition(record, next.update, next.version);
    widgetChanged ||= Boolean(previous.update?.available) !== Boolean(next.update?.available);

    record.snapshot = { reachable: true, ...next };
    this.schedulePauseEnd(record);
    if (this.dhcpPublished.get(record.server.slot) !== (typeof next.dhcpLeases === 'number')) {
      // A DHCP scope was enabled or disabled: the device gains or loses its
      // leases feature (Gladys proposes "Update" in the Discovery tab).
      await this.publishDevices();
    }
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.snapshot = { ...record.snapshot, reachable: false };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    // Only silence counts as down: a refused token is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.fire(TRIGGERS.UNREACHABLE, record, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record, { update: false })
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** A pause ends on its own: read the server right after, not at the next interval. */
  schedulePauseEnd(record) {
    clearTimeout(record.pauseTimer);
    const { blocking, pauseEndsAt } = record.snapshot;
    if (!this.timersEnabled || this.stopped || blocking !== 'disabled' || !pauseEndsAt) {
      return;
    }
    const delay = Math.max(0, pauseEndsAt - this.now()) + this.timings.pauseEndSlackMs;
    if (delay >= this.config.pollIntervalMs) {
      return; // the regular poll comes first
    }
    record.pauseTimer = setTimeout(() => {
      this.poll(record, { update: false })
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('pause-end'))
        .catch((err) => this.problem('pause-end', 'Pause end check failed', err, 'error'));
    }, delay);
    record.pauseTimer.unref?.();
  }

  async blockingTransition(record, previous, next, origin) {
    const now = this.now();
    if (next.blocking === 'disabled') {
      record.pauseEndsAt = next.pauseEndsAt;
    }
    const before = previous.blocking;
    if (!['enabled', 'disabled'].includes(before) || before === next.blocking) {
      return;
    }
    const own = origin === ORIGINS.GLADYS || now < record.ownChangeUntil;
    if (next.blocking === 'disabled') {
      record.pausedAt = now;
      await this.fire(TRIGGERS.PAUSED, record, {
        origin: own ? ORIGINS.GLADYS : ORIGINS.TECHNITIUM,
        duration_minutes: next.pauseEndsAt ? Math.ceil((next.pauseEndsAt - now) / 60_000) : 0,
      });
    } else if (next.blocking === 'enabled') {
      const timerEnded =
        record.pauseEndsAt !== null && now >= record.pauseEndsAt - this.timings.pauseEndSlackMs;
      await this.fire(TRIGGERS.RESUMED, record, {
        origin: own ? ORIGINS.GLADYS : timerEnded ? ORIGINS.TIMER : ORIGINS.TECHNITIUM,
        paused_minutes: record.pausedAt === null ? 0 : Math.round((now - record.pausedAt) / 60_000),
      });
      record.pausedAt = null;
      record.pauseEndsAt = null;
    }
  }

  /** Announce each new version once, across restarts. */
  async updateTransition(record, next, currentVersion) {
    if (!next) {
      return;
    }
    const slot = String(record.server.slot);
    const announced = this.saved.announcedUpdates;
    if (!next.available) {
      if (announced[slot]) {
        delete announced[slot];
        this.store.save(this.saved);
      }
      return;
    }
    const key = next.version ?? '?';
    if (announced[slot] === key) {
      return;
    }
    announced[slot] = key;
    this.store.save(this.saved);
    logger.info(`${this.label(record)}: update available (${key})`);
    await this.fire(TRIGGERS.UPDATE, record, {
      version: next.version ?? '',
      current_version: currentVersion ?? '',
    });
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.server.slot).device,
        server: serverName(record.server),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  async publishStates(record, { force = false } = {}) {
    const states = [];
    for (const { externalId, value } of featureValues(
      this.gladys,
      record.server.slot,
      record.snapshot,
    )) {
      if (value === null) {
        continue;
      }
      states.push(
        typeof value === 'string'
          ? { device_feature_external_id: externalId, text: value }
          : { device_feature_external_id: externalId, state: value },
      );
    }
    try {
      // The SDK keeps the last value per feature: only changes leave, plus
      // the heartbeat. A forced publication (device just added, Gladys
      // restarted) forgets them first, so everything is sent.
      if (force) {
        this.gladys.forgetPublishedStates(deviceIds(this.gladys, record.server.slot).device);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.snapshot.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.server.slot).device;
      const transport = record.snapshot.reachable
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every server answers. */
  connectionStatus() {
    const { servers, invalidSlots } = this.config;
    if (servers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      const parts = failing.map((record) =>
        labelled(
          serverName(record.server),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one server of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  /**
   * The servers a command targets: one device, or every configured server.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noServer, this.config?.language));
    }
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownServer, this.config.language));
    }
    return [record];
  }

  /** Run `command` on each targeted server; resolves with the records that accepted. */
  async onServers(deviceExternalId, describe, command) {
    const records = this.targets(deviceExternalId);
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          await command(record);
          logger.info(`${this.label(record)}: ${describe}`);
          return record;
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          logger.warn(`${this.label(record)}: ${describe} failed: ${err.message}`);
          await this.applyFailure(record, err);
          return null;
        }
      }),
    );
    await this.afterChanges(true);
    const done = results.filter(Boolean);
    if (done.length === 0) {
      const [record] = records;
      throw new Error(
        records.length === 1 && record.error
          ? labelled(
              serverName(record.server),
              pick(ERROR_TEXT[record.error.kind], this.config.language),
              this.config.language,
            )
          : pick(ACTION_TEXT.failed, this.config.language),
      );
    }
    return done;
  }

  /** Apply a new blocking state answered by a command, without waiting for the next read. */
  async applyBlocking(record, blocking, pauseEndsAt) {
    record.ownChangeUntil = this.now() + this.timings.ownChangeMs;
    const { reachable: _reachable, ...known } = record.snapshot;
    await this.applySuccess(
      record,
      { ...known, blocking, pauseEndsAt },
      { origin: ORIGINS.GLADYS },
    );
  }

  /**
   * Pause the blocking for `minutes` (0: until resumed) on the targeted
   * servers. Resolves with the number of servers that accepted.
   */
  async pause(deviceExternalId, minutes) {
    const done = await this.onServers(
      deviceExternalId,
      minutes ? `blocking paused for ${minutes} min` : 'blocking disabled',
      async (record) => {
        if (minutes > 0) {
          const answer = await record.client.temporaryDisableBlocking(minutes);
          await this.applyBlocking(
            record,
            'disabled',
            parsePauseEnd(answer) ?? this.now() + minutes * 60_000,
          );
          return;
        }
        // Turning the blocking off does not stop a running pause, whose end
        // would turn it back on: turning it on first does.
        await record.client.setBlocking(true);
        const answer = await record.client.setBlocking(false);
        // The end of the cancelled pause, still reported: ignore it from now on.
        record.staleTill = parsePauseEnd(answer);
        await this.applyBlocking(record, 'disabled', null);
      },
    );
    return done.length;
  }

  /** Resume the blocking on the targeted servers (also ends a pause). */
  async resume(deviceExternalId) {
    const done = await this.onServers(deviceExternalId, 'blocking resumed', async (record) => {
      await record.client.setBlocking(true);
      await this.applyBlocking(record, 'enabled', null);
    });
    return done.length;
  }

  /** Empty the DNS cache of the targeted servers. */
  async flushCache(deviceExternalId) {
    const done = await this.onServers(deviceExternalId, 'cache flushed', (record) =>
      record.client.flushCache(),
    );
    return done.length;
  }

  /** The blocking switch of a device. */
  async setValue(device, feature, value) {
    const slot = slotOf(this.gladys, device.external_id);
    if (slot === null || feature.external_id !== deviceIds(this.gladys, slot).feature('blocking')) {
      throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
    if (Number(value) === 1) {
      await this.resume(device.external_id);
    } else {
      await this.pause(device.external_id, this.config.switchOffMinutes);
    }
  }

  // --- Reports -------------------------------------------------------------------------------

  /** Minutes left in a pause, null when there is none. */
  pauseMinutesLeft(record) {
    const { blocking, pauseEndsAt } = record.snapshot;
    if (blocking !== 'disabled' || !pauseEndsAt) {
      return null;
    }
    return Math.max(1, Math.ceil((pauseEndsAt - this.now()) / 60_000));
  }

  /** "Test the connection": read every server now, one line each. */
  async testConnection() {
    await this.pollAll({ update: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = serverName(record.server);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { blocking, version, update, dhcpLeases } = record.snapshot;
        const parts = [text.ok];
        if (version) {
          parts.push(`v${version}`);
        }
        const left = this.pauseMinutesLeft(record);
        parts.push(blocking === 'enabled' ? text.on : left ? text.paused(left) : text.off);
        if (typeof dhcpLeases === 'number') {
          parts.push(text.leases(dhcpLeases));
        }
        if (update?.available) {
          parts.push(text.update(update.version ?? '?'));
        }
        return labelled(name, parts.join(', '), language);
      });
      // Addresses that could not be read are not records: say it too.
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /**
   * "Read the statistics" scene action: read the targeted servers now, and
   * sum their last 24 hours, with a sentence in the configured language.
   */
  async statistics(deviceExternalId) {
    const records = this.targets(deviceExternalId);
    const changes = await Promise.all(
      records.map((record) => this.poll(record, { update: false })),
    );
    await this.afterChanges(changes.some(Boolean));
    const answering = records.filter((record) => !record.error && record.snapshot.day);
    if (answering.length === 0) {
      throw new Error(pick(ACTION_TEXT.failed, this.config.language));
    }
    const sum = (period, key) =>
      answering.reduce((total, record) => total + (record.snapshot[period]?.[key] ?? 0), 0);
    const queries = sum('day', 'queries');
    const blocked = sum('day', 'blocked');
    const percent = queries > 0 ? Math.round((1000 * blocked) / queries) / 10 : 0;
    const lastHour = sum('hour', 'queries');
    const text = STATS_TEXT[this.config.language] ?? STATS_TEXT.en;
    return {
      sentence: text.sentence({ queries, blocked, percent, lastHour }),
      queries_last_day: queries,
      blocked_last_day: blocked,
      blocked_percent: percent,
      queries_last_hour: lastHour,
      blocking_enabled: answering.every((record) => record.snapshot.blocking === 'enabled'),
    };
  }

  /** What the widget shows, for one server or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    return record ? [record] : [];
  }
}
