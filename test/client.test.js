// -----------------------------------------------------------------------------
// The intuis HTTP client against the fake cloud: sign-in, both clusters, both
// app identifiers, token refresh, error kinds, and no secret in any message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_CLIENTS, BASE_URLS, IntuisClient, accountKey } from '../src/intuis/client.js';
import {
  HOME_ID,
  KNOWN_CLIENT_IDS,
  PASSWORD,
  USERNAME,
  createFakeIntuis,
} from './helpers/fakeIntuis.js';

function client(cloud, options = {}) {
  const sessions = [];
  const instance = new IntuisClient({
    username: USERNAME,
    password: PASSWORD,
    fetch: cloud.fetch,
    onSession: (session) => sessions.push(session),
    ...options,
  });
  return { instance, sessions };
}

test('signs in with the password grant of the intuis app, then reads the homes', async () => {
  const cloud = createFakeIntuis();
  const { instance, sessions } = client(cloud);
  const homes = await instance.homesData();
  assert.equal(homes.length, 2);

  const [login] = cloud.requests;
  assert.equal(login.path, '/oauth2/token');
  assert.equal(login.host, new URL(BASE_URLS[0]).host);
  assert.equal(login.form.get('grant_type'), 'password');
  assert.equal(login.form.get('client_id'), APP_CLIENTS[0].id);
  assert.equal(login.form.get('scope'), 'read_muller write_muller');
  assert.equal(login.form.get('user_prefix'), 'muller');
  assert.equal(cloud.requests[1].headers.Authorization, 'Bearer access-1');

  // The session is handed over for /data, without the password.
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].access_token, 'access-1');
  assert.equal(sessions[0].refresh_token, 'refresh-1');
  assert.equal(sessions[0].account, accountKey(USERNAME));
  assert.ok(!JSON.stringify(sessions).includes(PASSWORD));
});

test('the account fingerprint does not reveal the e-mail', () => {
  assert.equal(accountKey(USERNAME), accountKey(` ${USERNAME.toUpperCase()} `));
  assert.ok(!accountKey(USERNAME).includes('example'));
});

test('a saved session is reused: no sign-in at start', async () => {
  const cloud = createFakeIntuis();
  const first = client(cloud);
  await first.instance.homesData();
  const second = client(cloud, { session: first.sessions.at(-1) });
  await second.instance.homeStatus(HOME_ID);
  assert.equal(cloud.count('/oauth2/token'), 1);
});

test('the session of another account is dropped', async () => {
  const cloud = createFakeIntuis();
  const first = client(cloud);
  await first.instance.homesData();
  const other = new IntuisClient({
    username: 'someone.else@example.com',
    password: 'x',
    session: first.sessions.at(-1),
    fetch: cloud.fetch,
  });
  assert.equal(other.session, null);
});

test('an expired access token is refreshed once and the call replayed', async () => {
  const cloud = createFakeIntuis();
  const { instance } = client(cloud);
  await instance.homesData();
  cloud.expireToken();
  const status = await instance.homeStatus(HOME_ID);
  assert.equal(status.id, HOME_ID);
  const tokenCalls = cloud.requests.filter((request) => request.path === '/oauth2/token');
  assert.equal(tokenCalls.length, 2);
  assert.equal(tokenCalls[1].form.get('grant_type'), 'refresh_token');
  assert.equal(tokenCalls[1].form.get('refresh_token'), 'refresh-1');
});

test('a token close to its expiry is refreshed before the call', async () => {
  const cloud = createFakeIntuis();
  let now = 1_000_000;
  const { instance } = client(cloud, { now: () => now });
  await instance.homesData();
  now += 3 * 3600 * 1000; // the 3 hours of the token
  await instance.homesData();
  assert.equal(cloud.requests.filter((r) => r.path === '/oauth2/token').length, 2);
  assert.equal(cloud.count('/api/homesdata'), 2);
});

test('a revoked refresh token falls back to the password', async () => {
  const cloud = createFakeIntuis();
  const { instance } = client(cloud);
  await instance.homesData();
  cloud.refreshToken = 'revoked';
  cloud.expireToken();
  await instance.homesData();
  const grants = cloud.requests
    .filter((request) => request.path === '/oauth2/token')
    .map((request) => request.form.get('grant_type'));
  assert.deepEqual(grants, ['password', 'refresh_token', 'password']);
});

test('a wrong password is a "credentials" error, tried once, without the password in it', async () => {
  const cloud = createFakeIntuis();
  cloud.password = 'something else';
  const { instance } = client(cloud);
  await assert.rejects(instance.homesData(), (err) => {
    assert.equal(err.kind, 'credentials');
    assert.ok(!err.message.includes(PASSWORD));
    assert.ok(!err.message.includes(USERNAME));
    return true;
  });
  // Refused by intuis: neither the other cluster nor the other app is tried.
  assert.equal(cloud.count('/oauth2/token'), 1);
});

test('the second app identifiers are tried when intuis no longer knows the first', async () => {
  const cloud = createFakeIntuis({ clientIds: [KNOWN_CLIENT_IDS[1]] });
  const { instance, sessions } = client(cloud);
  await instance.homesData();
  assert.deepEqual(
    cloud.requests.filter((r) => r.path === '/oauth2/token').map((r) => r.form.get('client_id')),
    [APP_CLIENTS[0].id, APP_CLIENTS[1].id],
  );
  assert.equal(sessions.at(-1).client_id, APP_CLIENTS[1].id);
  // The refresh uses the identifiers that issued the token.
  cloud.expireToken();
  await instance.homesData();
  const refresh = cloud.requests.filter((r) => r.path === '/oauth2/token').at(-1);
  assert.equal(refresh.form.get('grant_type'), 'refresh_token');
  assert.equal(refresh.form.get('client_id'), APP_CLIENTS[1].id);
});

test('the second cluster is used when the first is unreachable', async () => {
  const cloud = createFakeIntuis();
  cloud.deadHosts.add(new URL(BASE_URLS[0]).host);
  const { instance, sessions } = client(cloud);
  await instance.homesData();
  assert.equal(sessions.at(-1).base_url, BASE_URLS[1]);
  assert.equal(cloud.requests.at(-1).host, new URL(BASE_URLS[1]).host);
});

test('errors carry a kind: network, rate_limited, api', async () => {
  const cloud = createFakeIntuis();
  const { instance } = client(cloud);
  await instance.homesData();

  cloud.failure = 'network';
  await assert.rejects(instance.homesData(), { kind: 'network' });

  cloud.failure = 'rate_limited';
  await assert.rejects(instance.homesData(), (err) => {
    assert.equal(err.kind, 'rate_limited');
    assert.equal(err.retryAfterMs, 120_000);
    return true;
  });

  cloud.failure = 'server';
  await assert.rejects(instance.homesData(), { kind: 'api', status: 503 });

  cloud.failure = null;
  await assert.rejects(
    instance.setRoomState(HOME_ID, 'missing-room', { therm_setpoint_mode: 'home' }),
    (err) => err.kind === 'api' && err.code === 31,
  );
});

test('parallel calls share one sign-in', async () => {
  const cloud = createFakeIntuis();
  const { instance } = client(cloud);
  await Promise.all([instance.homesData(), instance.homeStatus(HOME_ID), instance.homesData()]);
  assert.equal(cloud.count('/oauth2/token'), 1);
});

test('the commands send the shapes of the intuis app', async () => {
  const cloud = createFakeIntuis();
  const { instance } = client(cloud);
  await instance.setRoomState(
    HOME_ID,
    '2140019301',
    {
      therm_setpoint_mode: 'manual',
      therm_setpoint_temperature: 21,
      therm_setpoint_end_time: 1767200000,
    },
    'Europe/Paris',
  );
  const setstate = cloud.requests.at(-1);
  assert.equal(setstate.path, '/syncapi/v1/setstate');
  assert.equal(setstate.headers['Content-Type'], 'application/json');
  assert.deepEqual(setstate.body, {
    app_identifier: 'app_muller',
    home: {
      id: HOME_ID,
      timezone: 'Europe/Paris',
      rooms: [
        {
          id: '2140019301',
          therm_setpoint_mode: 'manual',
          therm_setpoint_temperature: 21,
          therm_setpoint_end_time: 1767200000,
        },
      ],
    },
  });

  await instance.setHomeMode(HOME_ID, 'hg');
  assert.deepEqual(cloud.requests.at(-1).body, { home_id: HOME_ID, mode: 'hg' });
  assert.equal(cloud.requests.at(-1).path, '/api/setthermmode');

  await instance.roomMeasure({
    homeId: HOME_ID,
    roomId: '2140019301',
    scale: '1day',
    begin: 1,
    end: 2,
  });
  const measure = cloud.requests.at(-1);
  assert.equal(measure.path, '/api/getroommeasure');
  assert.equal(
    measure.form.get('type'),
    'sum_energy_elec,sum_energy_elec$0,sum_energy_elec$1,sum_energy_elec$2',
  );
  assert.equal(measure.form.get('scale'), '1day');
});
