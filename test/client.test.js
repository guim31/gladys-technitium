// -----------------------------------------------------------------------------
// The Technitium client against the in-memory server: the bearer token, the
// JSON `status` of every answer, permissions, network errors, the commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, TechnitiumClient, safeLocation } from '../src/technitium/client.js';
import { FakeTechnitium, TOKEN, fixture } from './helpers/fakeTechnitium.js';

const URL = 'http://192.0.2.10:5380';

function setup(serverOptions = {}, clientOptions = {}) {
  const server = new FakeTechnitium(serverOptions);
  const client = new TechnitiumClient({
    url: URL,
    token: TOKEN,
    request: (url, options) => server.handle(url, options),
    ...clientOptions,
  });
  return { server, client };
}

const rejectsWith = (promise, kind) =>
  assert.rejects(promise, (err) => {
    assert.equal(err.kind, kind);
    return true;
  });

test('the token travels in the Authorization header, never in the address', async () => {
  const { server, client } = setup();
  const settings = await client.getSettings();
  assert.equal(settings.version, '15.6.1');
  const [request] = server.requests;
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(request.query.token, undefined);
  await client.getStats('LastHour');
  assert.deepEqual(server.requests[1].query, { type: 'LastHour', utc: 'true' });
});

test('a refused token is an auth error; no token is one too, without a request', async () => {
  const { client } = setup({ token: 'another' });
  await rejectsWith(client.getSettings(), ERROR_KINDS.AUTH);
  const { server, client: empty } = setup({}, { token: '' });
  await rejectsWith(empty.getSettings(), ERROR_KINDS.AUTH);
  assert.equal(server.requests.length, 0);
});

test('a missing permission is told apart (real answer "Access was denied.")', async () => {
  const { client } = setup({ denied: ['/api/settings'] });
  await rejectsWith(client.getSettings(), ERROR_KINDS.DENIED);
  await client.getStats('LastDay');
});

test('an API error answers its message, on one line', async () => {
  const { client } = setup();
  await assert.rejects(client.getStats('Nope'), (err) => {
    assert.equal(err.kind, ERROR_KINDS.HTTP);
    assert.match(err.message, /Requested value 'Nope' was not found/);
    return true;
  });
});

test('something else at the address: not a Technitium server', async () => {
  const { client } = setup({ kind: 'other' });
  await rejectsWith(client.getSettings(), ERROR_KINDS.NOT_TECHNITIUM);
  const html = new TechnitiumClient({
    url: URL,
    token: TOKEN,
    request: async () => ({ status: 200, headers: {}, body: '<!DOCTYPE html>' }),
  });
  await rejectsWith(html.getSettings(), ERROR_KINDS.NOT_TECHNITIUM);
  const answer = (status) =>
    new TechnitiumClient({
      url: URL,
      token: TOKEN,
      request: async () => ({ status, headers: {}, body: 'Bad gateway' }),
    });
  // A reverse proxy whose Technitium is down: the server does not answer.
  await rejectsWith(answer(502).getSettings(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(answer(400).getSettings(), ERROR_KINDS.HTTP);
});

test('network errors: unreachable, certificate refused, redirect', async () => {
  const failing = (code) =>
    new TechnitiumClient({
      url: URL,
      token: TOKEN,
      request: async () => {
        const error = new Error(code);
        error.code = code;
        throw error;
      },
    });
  await rejectsWith(failing('ECONNREFUSED').getSettings(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(failing('ETIMEDOUT').getSettings(), ERROR_KINDS.UNREACHABLE);
  await rejectsWith(failing('DEPTH_ZERO_SELF_SIGNED_CERT').getSettings(), ERROR_KINDS.TLS);
  const redirected = new TechnitiumClient({
    url: URL,
    token: TOKEN,
    request: async () => ({
      status: 302,
      headers: { location: 'https://192.0.2.10:53443/' },
      body: '',
    }),
  });
  await rejectsWith(redirected.getSettings(), ERROR_KINDS.REDIRECT);
});

test('the self-signed option reaches the transport', async () => {
  const { server, client } = setup({}, { insecure: true });
  await client.getSettings();
  assert.ok(server.requests.every((r) => r.insecure === true));
});

test('the token never appears in an error message', async () => {
  const { client } = setup({ token: 'other' }, { token: 'my-very-secret' });
  await assert.rejects(client.getSettings(), (err) => {
    assert.doesNotMatch(err.message, /my-very-secret/);
    return true;
  });
});

test('pause, then resume (the pause cancelled), flush the cache', async () => {
  const { server, client } = setup();
  const answer = await client.temporaryDisableBlocking(15);
  assert.ok(Date.parse(answer.temporaryDisableBlockingTill) > Date.now());
  assert.equal(server.blocking, false);
  const settings = await client.setBlocking(true);
  assert.equal(settings.enableBlocking, true);
  assert.equal(server.pauseEnd, null);
  assert.deepEqual(await client.flushCache(), {});
  assert.equal(server.flushes, 1);
});

test('the real answers parse as the client expects', () => {
  for (const name of ['settings', 'temporary-disable', 'check-for-update', 'cache-flush']) {
    assert.equal(fixture(`real/${name}`).status, 'ok', name);
  }
  assert.equal(fixture('real/invalid-token').status, 'invalid-token');
  assert.equal(fixture('real/access-denied').errorMessage, 'Access was denied.');
});

test('a redirect target is logged without credentials nor query string', () => {
  assert.equal(
    safeLocation('https://user:pw@192.0.2.10:53443/index.html?token=abc'),
    'https://192.0.2.10:53443/index.html',
  );
  assert.equal(safeLocation('/login?x=1'), '/login');
  assert.equal(safeLocation(undefined), '?');
});
