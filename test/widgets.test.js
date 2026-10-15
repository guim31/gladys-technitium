// -----------------------------------------------------------------------------
// The `technitium` dashboard widget: content within the core budget (checked with
// the SDK's validator), every server or one, the buttons and their actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { ACTIONS } from '../src/widgets.js';
import {
  FakeTechnitium,
  TOKEN,
  URL_1,
  URL_2,
  createClock,
  createWorld,
  deviceId,
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

async function world(t, { config, servers } = {}) {
  const clock = createClock();
  const result = await createWorld({
    clock,
    config,
    servers: servers?.(clock) ?? { [URL_1]: new FakeTechnitium({ now: clock.now }) },
  });
  t.after(() => result.app.stop());
  return result;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (tree, type) => tree.components.filter((component) => component.type === type);

test('one server: figures, state, four buttons, within the budget', async (t) => {
  const w = await world(t);
  const tree = await content(w);
  assert.ok(tree.components.length <= 8);
  assert.deepEqual(
    ofType(tree, 'value').map(({ label, value, unit }) => [label, value, unit]),
    [
      ['Queries 24 h', 925, undefined],
      ['Blocked 24 h', 49, undefined],
      ['Share blocked', 5.3, '%'],
    ],
  );
  const [status] = ofType(tree, 'status');
  assert.deepEqual(
    status.items.map(({ label, value }) => [label, value]),
    [
      ['Technitium', 'Blocking'],
      ['Queries last hour', 24],
      ['Clients 24 h', 6],
      ['Blocked domains', 1],
    ],
  );
  const buttons = ofType(tree, 'button');
  assert.deepEqual(
    buttons.map((button) => [button.label, button.action.key, button.icon]),
    [
      ['Pause 5 min', ACTIONS.PAUSE_SHORT, 'pause'],
      ['Pause 30 min', ACTIONS.PAUSE_LONG, 'pause'],
      ['Pause…', ACTIONS.PAUSE_CUSTOM, 'clock'],
      ['Resume', ACTIONS.RESUME, 'check-circle'],
    ],
  );
  assert.equal(new Set(buttons.map((button) => button.action.key)).size, 4, 'unique keys');
  assert.ok(
    buttons.every((button) => button.style !== 'primary'),
    'primary is invisible in dark',
  );
  assert.equal(tree.ttl_seconds, 60);
});

test('a pause shows its countdown, refreshes sooner, and Resume loses its check mark', async (t) => {
  const w = await world(t, {
    servers: (clock) => {
      const server = new FakeTechnitium({ now: clock.now });
      server.setBlocking(false, 4);
      return { [URL_1]: server };
    },
  });
  const tree = await content(w, {}, 'fr');
  assert.equal(ofType(tree, 'status')[0].items[0].value, 'En pause · 4 min');
  assert.equal(ofType(tree, 'button').at(-1).icon, 'play');
  assert.equal(tree.ttl_seconds, 30);
});

test('two servers: summed figures, one row each, DHCP leases, an update row', async (t) => {
  const w = await world(t, {
    config: TWO_SERVERS,
    servers: (clock) => ({
      [URL_1]: new FakeTechnitium({ now: clock.now }),
      [URL_2]: new FakeTechnitium({ now: clock.now, update: true, dhcp: true }),
    }),
  });
  w.network.servers.get(URL_2).day.stats.totalQueries = 75;
  w.network.servers.get(URL_2).day.stats.totalBlocked = 1;
  await w.hub.pollAll();
  const tree = await content(w, {}, 'de');
  assert.deepEqual(
    ofType(tree, 'value').map((tile) => tile.value),
    [1000, 50, 5],
  );
  assert.deepEqual(
    ofType(tree, 'status')[0].items.map(({ label, value }) => [label, value]),
    [
      ['Primary', 'Blockiert'],
      ['Secondary', 'Blockiert'],
      ['Anfragen letzte Stunde', 48],
      ['Clients 24 h', 12],
      ['Blockierte Domains', 1],
      ['DHCP-Leases', 3],
      ['Update verfügbar · Secondary', '15.7'],
    ],
  );

  // Restricted to one server in the widget settings.
  const one = await content(w, { device: deviceId(w.gladys, 1) });
  assert.deepEqual(
    ofType(one, 'value').map((tile) => tile.value),
    [925, 49, 5.3],
  );
});

test('an unreachable server is shown, and nothing answers at all', async (t) => {
  const w = await world(t);
  w.network.servers.get(URL_1).online = false;
  await w.hub.pollAll();
  const tree = await content(w);
  assert.deepEqual(ofType(tree, 'value'), []);
  assert.match(ofType(tree, 'text')[0].text, /No Technitium server answers/);
  assert.deepEqual(ofType(tree, 'status')[0].items, [
    { label: 'Technitium', icon: 'alert-triangle', value: 'Unreachable', color: 'danger' },
  ]);
});

test('no server configured, or a server no longer configured', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match(ofType(await content(empty), 'text')[0].text, /Enter the address/);
  const w = await world(t);
  const tree = await content(w, { device: deviceId(w.gladys, 3) }, 'es');
  assert.match(ofType(tree, 'text')[0].text, /ya no está en la configuración/);
});

test('the buttons pause and resume every server', async (t) => {
  const w = await world(t, {
    config: TWO_SERVERS,
    servers: (clock) => ({
      [URL_1]: new FakeTechnitium({ now: clock.now }),
      [URL_2]: new FakeTechnitium({ now: clock.now }),
    }),
  });
  const servers = [...w.network.servers.values()];
  let ack = await w.fake.widgetAction(
    WIDGET_KEY,
    ACTIONS.PAUSE_SHORT,
    { minutes: 5 },
    { settings: {} },
  );
  assert.equal(ack.data.message.en, 'Blocking paused for 5 min on 2 server(s).');
  assert.ok(servers.every((server) => server.requests.at(-1).query.minutes === '5'));

  ack = await w.fake.widgetAction(
    WIDGET_KEY,
    ACTIONS.PAUSE_LONG,
    { minutes: 30 },
    { settings: {} },
  );
  assert.equal(ack.success, true);
  assert.ok(servers.every((server) => server.requests.at(-1).query.minutes === '30'));

  ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.RESUME, {}, { settings: {} });
  assert.equal(ack.data.message.fr, 'Blocage réactivé sur 2 serveur(s).');
  assert.ok(servers.every((server) => server.blocking));
  assert.equal(w.fake.sceneEvents.filter((event) => event.key === TRIGGERS.RESUMED).length, 2);
});

test('the Pause… form: the typed duration, or a request to update Gladys', async (t) => {
  const w = await world(t);
  const server = w.network.servers.get(URL_1);
  let ack = await w.fake.widgetAction(
    WIDGET_KEY,
    ACTIONS.PAUSE_CUSTOM,
    {},
    { settings: { device: deviceId(w.gladys) }, values: { minutes: 90 } },
  );
  assert.equal(ack.success, true);
  assert.equal(server.requests.at(-1).query.minutes, '90');

  // Gladys 5.1 relays the tap without the form.
  ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.PAUSE_CUSTOM, {}, { settings: {} });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Update Gladys to 5\.2\.0/);

  ack = await w.fake.widgetAction(WIDGET_KEY, 'reboot', {}, { settings: {} });
  assert.equal(ack.success, false);
});

test('the form field is valid for the core (number, integer bounds, default inside)', async (t) => {
  const w = await world(t);
  const tree = await content(w);
  const [field] = ofType(tree, 'button').find((b) => b.action.key === ACTIONS.PAUSE_CUSTOM).action
    .fields;
  assert.equal(field.type, 'number');
  assert.ok(Number.isInteger(field.min) && Number.isInteger(field.max));
  assert.ok(field.default >= field.min && field.default <= field.max);
  assert.deepEqual(Object.keys(field.label).sort(), ['de', 'en', 'es', 'fr']);
});
