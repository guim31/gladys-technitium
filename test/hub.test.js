// -----------------------------------------------------------------------------
// The hub, end to end: the SDK's fake Gladys on one side, in-memory Technitium
// servers on the other, a manual clock. Devices, states, transitions and
// their scene events, commands, reconfiguration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGINS, TRIGGERS, WIDGET_KEY, parseMinutes } from '../src/hub.js';
import { Store } from '../src/store.js';
import {
  FakeTechnitium,
  TOKEN,
  URL_1,
  URL_2,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const TWO_SERVERS = {
  server_1_url: URL_1,
  server_1_token: TOKEN,
  server_1_name: 'Primary',
  server_2_url: URL_2,
  server_2_token: TOKEN,
  server_2_name: 'Secondary',
  language: 'en',
};

async function world(t, options = {}) {
  const clock = options.clock ?? createClock();
  const servers = options.servers ?? { [URL_1]: new FakeTechnitium({ now: clock.now }) };
  const result = await createWorld({ ...options, clock, servers });
  t.after(() => result.app.stop());
  return { ...result, server: servers[URL_1], servers };
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const blockingOf = (device) => device.features.find((f) => f.external_id.endsWith(':blocking'));

test('one device per configured server, with its states, status and transport', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.name, 'Technitium');
  assert.equal(device.external_id, deviceId(w.gladys));
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
  assert.deepEqual(device.params, [{ name: 'TECHNITIUM_URL', value: URL_1 }]);
  const state = (key) => w.fake.lastState(featureId(w.gladys, key));
  assert.equal(state('blocking'), 1);
  assert.equal(state('queries_last_hour'), 24);
  assert.equal(state('queries_last_day'), 925);
  assert.equal(state('blocked_last_day'), 49);
  assert.equal(state('blocked_percent_last_day'), 5);
  assert.equal(state('clients_last_day'), 6);
  assert.equal(state('zones'), 0);
  assert.equal(state('blocked_domains'), 1);
  assert.equal(state('update_available'), 0);
  assert.equal(state('version'), '15.6.1');
  // No DHCP scope enabled: no leases feature.
  assert.ok(!device.features.some((f) => f.external_id.endsWith(':dhcp_leases')));
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(w.fake.transports, [
    { device_external_id: deviceId(w.gladys), transport: 'local' },
  ]);
});

test('a server without name is named after its address', async (t) => {
  const w = await world(t, { config: { server_1_url: '192.0.2.10', server_1_token: TOKEN } });
  assert.equal(w.fake.discoveredDevices[0].name, 'Technitium 192.0.2.10:5380');
});

test('a DHCP server gets a leases feature, which follows the scopes', async (t) => {
  const clock = createClock();
  const server = new FakeTechnitium({ now: clock.now, dhcp: true });
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  const leases = featureId(w.gladys, 'dhcp_leases');
  assert.ok(w.fake.discoveredDevices[0].features.some((f) => f.external_id === leases));
  assert.equal(w.fake.lastState(leases), 3);

  // The scope disabled: the device is published again without the feature.
  server.scopes.scopes[0].enabled = false;
  await w.hub.pollAll();
  assert.ok(!w.fake.discoveredDevices[0].features.some((f) => f.external_id === leases));

  // A token without the DHCP permission: no DHCP, the rest still read.
  server.scopes.scopes[0].enabled = true;
  server.denied = ['/api/dhcp'];
  await w.hub.pollAll();
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.ok(!w.fake.discoveredDevices[0].features.some((f) => f.external_id === leases));
});

test('only the changes are published, everything again when a device is added', async (t) => {
  const w = await world(t);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');

  w.server.day.stats.totalQueries += 10;
  w.server.day.stats.totalBlocked += 2;
  await w.hub.pollAll();
  assert.deepEqual(
    w.fake.states.slice(before).map((state) => state.device_feature_external_id),
    [featureId(w.gladys, 'queries_last_day'), featureId(w.gladys, 'blocked_last_day')],
  );

  const sent = w.fake.states.length;
  const refreshes = w.fake.widgetRefreshes.length;
  await createAll(w);
  assert.equal(w.fake.states.length - sent, 10, 'every feature again');
  assert.equal(w.fake.widgetRefreshes.length, refreshes + 1);
  assert.equal(w.fake.widgetRefreshes.at(-1), WIDGET_KEY);
});

test('an unchanged value is published again after the heartbeat', async (t) => {
  const w = await world(t, { timings: { heartbeatMs: 1000 } });
  const before = w.fake.states.length;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await w.hub.pollAll();
  assert.equal(w.fake.states.length - before, 10);
});

test('the switch pauses the blocking for the configured time and resumes it', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_token: TOKEN, switch_off_minutes: '15' },
  });
  await createAll(w);
  const [device] = w.fake.devices;
  const feature = blockingOf(device);

  assert.equal((await w.fake.setValue(device, feature, 0)).success, true);
  assert.deepEqual(w.server.requests.at(-1), {
    ...w.server.requests.at(-1),
    path: '/api/settings/temporaryDisableBlocking',
    query: { minutes: '15' },
  });
  assert.equal(w.fake.lastState(feature.external_id), 0);
  assert.deepEqual(events(w, TRIGGERS.PAUSED).at(-1).data, {
    device: device.external_id,
    server: 'Technitium 192.0.2.10:5380',
    origin: ORIGINS.GLADYS,
    duration_minutes: 15,
  });

  assert.equal((await w.fake.setValue(device, feature, 1)).success, true);
  assert.equal(w.server.requests.at(-1).path, '/api/settings/set');
  assert.deepEqual(w.server.requests.at(-1).query, { enableBlocking: 'true' });
  assert.equal(w.server.pauseEnd, null, 'the pause is cancelled');
  assert.equal(w.fake.lastState(feature.external_id), 1);
  assert.equal(events(w, TRIGGERS.RESUMED).at(-1).data.origin, ORIGINS.GLADYS);

  // A read-only feature cannot be controlled.
  const counter = device.features.find((f) => f.external_id.endsWith(':queries_last_day'));
  assert.equal((await w.fake.setValue(device, counter, 1)).success, false);
});

test('turned off until turned back on: a running pause is cancelled first', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_token: TOKEN, switch_off_minutes: '0' },
  });
  await createAll(w);
  // A pause made in the web console is running.
  w.server.setBlocking(false, 30);
  await w.hub.pollAll();
  const [device] = w.fake.devices;
  await w.fake.setValue(device, blockingOf(device), 0);
  assert.deepEqual(
    w.server.requests.slice(-2).map((request) => request.query),
    [{ enableBlocking: 'true' }, { enableBlocking: 'false' }],
  );
  assert.equal(w.server.pauseEnd, null, 'the pause timer would turn the blocking back on');
  assert.equal(events(w, TRIGGERS.PAUSED).length, 1, 'already off: no second event');

  // Technitium still reports the end of the cancelled pause: not a pause.
  w.clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(w.hub.pauseMinutesLeft(w.hub.records.get(1)), null);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);
});

test('a pause made in the web console is seen, and its automatic end', async (t) => {
  const w = await world(t);
  w.clock.advance(60_000);
  w.server.setBlocking(false, 5);
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.PAUSED).at(-1).data, {
    device: deviceId(w.gladys),
    server: 'Technitium',
    origin: ORIGINS.TECHNITIUM,
    duration_minutes: 5,
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);

  w.clock.advance(301_000);
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.RESUMED).at(-1).data, {
    device: deviceId(w.gladys),
    server: 'Technitium',
    origin: ORIGINS.TIMER,
    paused_minutes: 5,
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 1);
});

test('blocking turned back on outside Gladys before the end of the pause', async (t) => {
  const w = await world(t);
  w.server.setBlocking(false, 30);
  await w.hub.pollAll();
  w.clock.advance(120_000);
  w.server.setBlocking(true);
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.RESUMED).map((event) => [event.data.origin, event.data.paused_minutes]),
    [[ORIGINS.TECHNITIUM, 2]],
  );
});

test('a server already off at start fires nothing', async (t) => {
  const clock = createClock();
  const server = new FakeTechnitium({ now: clock.now });
  server.setBlocking(false);
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);
  // Turned on later: off for an unknown time.
  server.setBlocking(true);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.RESUMED)[0].data.paused_minutes, 0);
});

test('a server that stops answering: down after two reads, once, then back', async (t) => {
  const w = await world(t);
  w.server.online = false;
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.UNREACHABLE), [], 'one failure is a blip');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /^Technitium : ne répond pas$/);

  w.clock.advance(15_000);
  await w.hub.pollAll();
  w.clock.advance(60_000);
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.UNREACHABLE).map((event) => event.data),
    [{ device: deviceId(w.gladys), server: 'Technitium', error: 'does not answer' }],
  );

  w.server.online = true;
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.RECOVERED).map((event) => event.data),
    [{ device: deviceId(w.gladys), server: 'Technitium', down_minutes: 1 }],
  );
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a refused token or a missing permission is reported, not counted as an outage', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_token: 'wrong', language: 'de' },
  });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(
    w.fake.connectionStatus.message.en,
    'Technitium 192.0.2.10:5380: API token refused: create a new one',
  );
  assert.equal(
    w.fake.connectionStatus.message.de,
    'Technitium 192.0.2.10:5380: API-Token abgelehnt: Erstelle ein neues',
  );
  // No state is invented for an unread server.
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), undefined);

  w.server.denied = ['/api/settings'];
  await w.fake.configUpdated({ server_1_url: URL_1, server_1_token: TOKEN });
  assert.match(w.fake.connectionStatus.message.en, /access denied/);
});

test('an update is announced once, across restarts, and again for a newer version', async (t) => {
  const clock = createClock();
  const server = new FakeTechnitium({ now: clock.now, update: true });
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  assert.deepEqual(
    events(w, TRIGGERS.UPDATE).map((event) => event.data),
    [
      {
        device: deviceId(w.gladys),
        server: 'Technitium',
        version: '15.7',
        current_version: '15.6.1',
      },
    ],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, 'update_available')), 1);
  await w.hub.rediscover();
  assert.equal(events(w, TRIGGERS.UPDATE).length, 1);

  // A restart with the same /data: nothing new to announce.
  await w.app.stop();
  const again = await createWorld({ clock, servers: { [URL_1]: server }, dataDir: w.dataDir });
  t.after(() => again.app.stop());
  assert.equal(events(again, TRIGGERS.UPDATE).length, 0);

  // A newer release: announced.
  server.update.updateVersion = '15.8';
  await again.hub.rediscover();
  assert.equal(events(again, TRIGGERS.UPDATE).at(-1).data.version, '15.8');

  // Updated, then a new update later: announced again.
  server.update = { dnsServerEnableCheckForUpdate: true, updateAvailable: false };
  await again.hub.rediscover();
  assert.equal(again.fake.lastState(featureId(again.gladys, 'update_available')), 0);
  server.update = { updateAvailable: true, updateVersion: '15.8' };
  await again.hub.rediscover();
  assert.equal(events(again, TRIGGERS.UPDATE).length, 2);
});

test('updates are checked every six hours, and a failure there does not stop the poll', async (t) => {
  const w = await world(t);
  const checks = () =>
    w.server.requests.filter((request) => request.path === '/api/user/checkForUpdate').length;
  assert.equal(checks(), 1);
  await w.hub.pollAll();
  assert.equal(checks(), 1);
  w.clock.advance(6 * 60 * 60_000);
  await w.hub.pollAll();
  assert.equal(checks(), 2);

  const original = w.server.handle.bind(w.server);
  w.server.handle = (url, options) =>
    url.includes('/api/user/checkForUpdate')
      ? { status: 500, headers: {}, body: '' }
      : original(url, options);
  w.clock.advance(6 * 60 * 60_000);
  w.server.day.stats.totalClients = 11;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'clients_last_day')), 11);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'update_available')), 0, 'kept');
});

test('scene actions pause and resume every server, or one', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakeTechnitium({ now: clock.now }),
    [URL_2]: new FakeTechnitium({ now: clock.now }),
  };
  const w = await world(t, { clock, servers, config: TWO_SERVERS });

  let ack = await w.fake.sceneAction('pause_blocking', { minutes: 10 });
  assert.deepEqual(ack.data.outputs, { servers: 2, minutes: 10 });
  for (const server of Object.values(servers)) {
    assert.deepEqual(server.requests.at(-1).query, { minutes: '10' });
  }
  assert.deepEqual(
    events(w, TRIGGERS.PAUSED).map((event) => event.data.server),
    ['Primary', 'Secondary'],
  );

  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 2) });
  assert.deepEqual(ack.data.outputs, { servers: 1 });
  assert.equal(servers[URL_2].blocking, true);
  assert.equal(servers[URL_1].blocking, false);

  // Defaults applied by Gladys, or a variable typed as text.
  ack = await w.fake.sceneAction('pause_blocking', {
    device: deviceId(w.gladys, 1),
    minutes: '2,5',
  });
  assert.deepEqual(ack.data.outputs, { servers: 1, minutes: 3 });
  ack = await w.fake.sceneAction('pause_blocking', { minutes: 0 });
  assert.deepEqual(ack.data.outputs, { servers: 2, minutes: 0 });
  assert.deepEqual(servers[URL_1].requests.at(-1).query, { enableBlocking: 'false' });

  // One server down: the other one is paused, the action succeeds.
  servers[URL_2].online = false;
  ack = await w.fake.sceneAction('pause_blocking', {});
  assert.deepEqual(ack.data.outputs, { servers: 1, minutes: 5 });

  // All down: the action fails with a reason.
  servers[URL_1].online = false;
  ack = await w.fake.sceneAction('resume_blocking', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'No Technitium server accepted the command.');
  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 1) });
  assert.equal(ack.error, 'Primary: does not answer');

  // A device no longer configured.
  ack = await w.fake.sceneAction('resume_blocking', { device: deviceId(w.gladys, 3) });
  assert.equal(ack.error, 'This Technitium server is no longer in the configuration.');
});

test('scene actions flush the cache and read the statistics into a sentence', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakeTechnitium({ now: clock.now }),
    [URL_2]: new FakeTechnitium({ now: clock.now }),
  };
  const w = await world(t, { clock, servers, config: { ...TWO_SERVERS, language: 'fr' } });

  let ack = await w.fake.sceneAction('flush_cache', {});
  assert.deepEqual(ack.data.outputs, { servers: 2 });
  assert.equal(servers[URL_1].flushes, 1);
  assert.equal(servers[URL_2].flushes, 1);

  servers[URL_2].day.stats.totalQueries = 75;
  servers[URL_2].day.stats.totalBlocked = 1;
  ack = await w.fake.sceneAction('read_statistics', {});
  assert.deepEqual(ack.data.outputs, {
    sentence:
      'Sur les dernières 24 heures, 1 000 requêtes DNS, dont 50 bloquées (5 %). ' +
      'Dernière heure : 48 requêtes.',
    queries_last_day: 1000,
    blocked_last_day: 50,
    blocked_percent: 5,
    queries_last_hour: 48,
    blocking_enabled: true,
  });
  ack = await w.fake.sceneAction('read_statistics', { device: deviceId(w.gladys, 1) });
  assert.equal(ack.data.outputs.queries_last_day, 925);
  assert.equal(ack.data.outputs.blocked_percent, 5.3);

  servers[URL_1].online = false;
  servers[URL_2].online = false;
  ack = await w.fake.sceneAction('read_statistics', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, "Aucun serveur Technitium n'a accepté la commande.");
});

test('the scene action errors follow the configured language', async (t) => {
  const w = await world(t, { config: { language: 'fr' } });
  const ack = await w.fake.sceneAction('pause_blocking', {});
  assert.equal(ack.error, "Aucun serveur Technitium n'est configuré.");
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
});

test('reconfiguring keeps an unchanged server and drops the removed ones', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakeTechnitium({ now: clock.now }),
    [URL_2]: new FakeTechnitium({ now: clock.now }),
  };
  const w = await world(t, { clock, servers, config: TWO_SERVERS });
  const record = w.hub.records.get(1);
  await w.fake.configUpdated({ ...TWO_SERVERS, server_1_name: 'Main', server_2_url: '' });
  assert.equal(w.hub.records.get(1), record, 'renamed: same record');
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Main'],
  );
  // A new token: a new client.
  servers[URL_1].token = 'changed';
  await w.fake.configUpdated({ ...TWO_SERVERS, server_1_token: 'changed', server_2_url: '' });
  assert.notEqual(w.hub.records.get(1), record);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the features follow the configured language', async (t) => {
  const w = await world(t, {
    config: { server_1_url: URL_1, server_1_token: TOKEN, language: 'es' },
  });
  const names = w.fake.discoveredDevices[0].features.map((feature) => feature.name);
  assert.equal(names[0], 'Bloqueo');
  assert.equal(names[1], 'Consultas DNS (última hora)');
});

test('a reconnection to Gladys sends everything again', async (t) => {
  const w = await world(t);
  const sent = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.fake.states.length - sent, 10);
  assert.equal(w.fake.connectionStatuses.length, 2);
});

test('Gladys polling a device reads that server', async (t) => {
  const w = await world(t);
  w.server.day.stats.totalQueries = 8000;
  const ack = await w.fake.poll(w.fake.discoveredDevices[0]);
  assert.equal(ack.success, true);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'queries_last_day')), 8000);
});

test('"Test the connection" reports each server in every language', async (t) => {
  const clock = createClock();
  const servers = {
    [URL_1]: new FakeTechnitium({ now: clock.now, update: true, dhcp: true }),
    [URL_2]: new FakeTechnitium({ now: clock.now, kind: 'other' }),
  };
  const w = await world(t, {
    clock,
    servers,
    config: { ...TWO_SERVERS, server_3_url: 'http://' },
  });
  servers[URL_1].setBlocking(false, 4);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(
    ack.data.message.en,
    'Primary: OK, v15.6.1, paused, 4 min left, 3 DHCP lease(s), update 15.7 available\n' +
      'Secondary: no Technitium server at this address (port 5380?)\n' +
      'Address not understood, e.g. 192.168.1.2 or http://192.168.1.2:5380',
  );
  assert.match(ack.data.message.fr, /^Primary : OK, v15\.6\.1, en pause, encore 4 min/);
});

test('pause durations typed in a scene', () => {
  assert.equal(parseMinutes(10), 10);
  assert.equal(parseMinutes('15'), 15);
  assert.equal(parseMinutes(' 2,5 '), 3);
  assert.equal(parseMinutes(0), 0);
  assert.equal(parseMinutes(99999), 1440);
  assert.equal(parseMinutes(-1), 5);
  // A positive duration never becomes "until resumed".
  assert.equal(parseMinutes(0.4), 1);
  assert.equal(parseMinutes('0,3'), 1);
  assert.equal(parseMinutes('soon'), 5);
  assert.equal(parseMinutes(undefined), 5);
  assert.equal(parseMinutes(null, 30), 30);
});

test('the store survives a corrupt file', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'gladys-technitium-store-'));
  writeFileSync(join(dir, 'technitium-state.json'), '{not json');
  assert.deepEqual(await new Store(dir).load(), {});
});

test('a server removed while it is being read publishes nothing', async (t) => {
  const w = await world(t);
  const sent = w.fake.states.length;
  w.server.day.stats.totalQueries = 9000;
  const reading = w.hub.pollAll();
  await w.fake.configUpdated({ server_1_url: '' });
  await reading;
  assert.equal(w.fake.states.length, sent);
});

test('a read started before a command does not undo it', async (t) => {
  const w = await world(t);
  await createAll(w);
  const original = w.server.handle.bind(w.server);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  // The update check of this read is slow; its settings say "enabled".
  w.server.handle = (url, options) =>
    url.includes('/api/user/checkForUpdate')
      ? held.then(() => original(url, options))
      : original(url, options);
  const reading = w.hub.pollAll({ update: true });
  await new Promise((resolve) => setImmediate(resolve));
  await w.fake.sceneAction('pause_blocking', { minutes: 5 });
  release();
  await reading;
  assert.equal(w.fake.lastState(featureId(w.gladys, 'blocking')), 0);
  assert.deepEqual(events(w, TRIGGERS.RESUMED), []);
  assert.equal(events(w, TRIGGERS.PAUSED).length, 1);
});

test('resume, then the blocking turned off in the console: off, not a pause', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('pause_blocking', { minutes: 60 });
  w.clock.advance(5 * 60_000);
  await w.fake.sceneAction('resume_blocking', {});
  w.server.setBlocking(false);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.PAUSED).at(-1).data.duration_minutes, 0);
  assert.equal(w.hub.pauseMinutesLeft(w.hub.records.get(1)), null);

  // Still known after a restart (the stale end is kept under /data).
  await w.app.stop();
  const again = await createWorld({
    clock: w.clock,
    servers: { [URL_1]: w.server },
    dataDir: w.dataDir,
  });
  t.after(() => again.app.stop());
  assert.equal(again.hub.pauseMinutesLeft(again.hub.records.get(1)), null);
});

test('a command refused for a permission does not mark the server unreachable', async (t) => {
  const w = await world(t);
  w.server.denied = ['/api/settings/temporaryDisableBlocking'];
  const ack = await w.fake.sceneAction('pause_blocking', { minutes: 5 });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Technitium: access denied: the token user lacks a permission');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a passing DHCP error keeps the leases feature', async (t) => {
  const clock = createClock();
  const server = new FakeTechnitium({ now: clock.now, dhcp: true });
  const w = await world(t, { clock, servers: { [URL_1]: server } });
  const published = w.fake.discoveredDevices;
  const original = server.handle.bind(server);
  server.handle = (url, options) =>
    url.includes('/api/dhcp/leases')
      ? { status: 200, headers: {}, body: JSON.stringify({ status: 'error', errorMessage: 'x' }) }
      : original(url, options);
  await w.hub.pollAll();
  assert.equal(w.fake.discoveredDevices, published, 'not published again');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'dhcp_leases')), 3);
});
