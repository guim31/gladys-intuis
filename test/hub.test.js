// -----------------------------------------------------------------------------
// The hub against the fake cloud and the SDK's fake Gladys: commands,
// the container's own refresh (no onPoll needed), failures and their logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS } from '../src/i18n.js';
import { ROOMS } from './helpers/fakeIntuis.js';
import { CONFIG, createAll, createWorld, deviceNamed, featureOf, settle } from './helpers/world.js';

const NOW = Date.UTC(2026, 0, 10, 8, 0, 0);
const NOW_S = NOW / 1000;

async function withWorld(options, run) {
  const world = await createWorld({ now: () => NOW, ...options });
  try {
    await run(world);
  } finally {
    await world.app.stop();
  }
}

const lastSetState = (world) =>
  world.intuis.requests.filter((request) => request.path === '/syncapi/v1/setstate').at(-1)?.body;

test('the connection status says connected once the homes are read', async () => {
  await withWorld({}, async ({ gladys }) => {
    assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  });
});

test('not configured: a status asking for the account, no request to intuis', async () => {
  await withWorld({ config: {} }, async ({ gladys, intuis }) => {
    assert.deepEqual(gladys.fake.connectionStatus, {
      connected: false,
      message: STATUS.notConfigured,
    });
    assert.equal(intuis.requests.length, 0);
    assert.deepEqual(gladys.fake.discoveredDevices, []);
  });
});

test('setpoint: a manual setpoint held for the duration set in the app', async () => {
  await withWorld({}, async (world) => {
    await createAll(world);
    const salon = deviceNamed(world, 'Salon');
    const ack = await world.gladys.fake.setValue(salon, featureOf(salon, 'setpoint'), 21.4);
    assert.equal(ack.success, true);
    // getconfigs says 120 minutes; 21.4 is rounded to the half degree.
    assert.deepEqual(lastSetState(world).home.rooms, [
      {
        id: ROOMS.LIVING,
        therm_setpoint_mode: 'manual',
        therm_setpoint_temperature: 21.5,
        therm_setpoint_end_time: NOW_S + 120 * 60,
      },
    ]);
    assert.equal(lastSetState(world).home.timezone, 'Europe/Paris');
    // Re-read right after: Gladys shows the new setpoint and the manual mode.
    await settle(world.hub);
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'setpoint').external_id), 21.5);
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'mode').external_id), 1);
  });
});

test('setpoint: the configured duration wins over the app one', async () => {
  await withWorld({ config: { ...CONFIG, manual_duration: '60' } }, async (world) => {
    const salon = deviceNamed(world, 'Salon');
    await world.gladys.fake.setValue(salon, featureOf(salon, 'setpoint'), 19);
    assert.equal(lastSetState(world).home.rooms[0].therm_setpoint_end_time, NOW_S + 3600);
    assert.equal(world.intuis.count('/syncapi/v1/getconfigs'), 0);
  });
});

test('setpoint: out of range is refused with a sentence, nothing sent', async () => {
  await withWorld({}, async (world) => {
    const salon = deviceNamed(world, 'Salon');
    const ack = await world.gladys.fake.setValue(salon, featureOf(salon, 'setpoint'), 35);
    assert.equal(ack.success, false);
    assert.match(ack.error, /entre 7 et 30/);
    assert.equal(lastSetState(world), undefined);
  });
});

test('mode: auto goes back to the schedule, heating holds the current setpoint, off is refused', async () => {
  await withWorld({}, async (world) => {
    const bedroom = deviceNamed(world, 'Chambre parentale');
    const mode = featureOf(bedroom, 'mode');

    await world.gladys.fake.setValue(bedroom, mode, 3);
    assert.deepEqual(lastSetState(world).home.rooms, [
      { id: ROOMS.BEDROOM, therm_setpoint_mode: 'home' },
    ]);

    const salon = deviceNamed(world, 'Salon');
    await world.gladys.fake.setValue(salon, featureOf(salon, 'mode'), 1);
    const [held] = lastSetState(world).home.rooms;
    assert.equal(held.therm_setpoint_mode, 'manual');
    assert.equal(held.therm_setpoint_temperature, 20);

    const before = world.intuis.count('/syncapi/v1/setstate');
    const ack = await world.gladys.fake.setValue(salon, featureOf(salon, 'mode'), 0);
    assert.equal(ack.success, false);
    assert.match(ack.error, /hors-gel/);
    assert.equal(world.intuis.count('/syncapi/v1/setstate'), before);
  });
});

test('preset: schedule, away and frost protection of one room', async () => {
  await withWorld({}, async (world) => {
    const salon = deviceNamed(world, 'Salon');
    const preset = featureOf(salon, 'preset');
    for (const [value, mode] of [
      [1, 'hg'],
      [2, 'away'],
      [0, 'home'],
    ]) {
      await world.gladys.fake.setValue(salon, preset, value);
      assert.deepEqual(lastSetState(world).home.rooms, [
        { id: ROOMS.LIVING, therm_setpoint_mode: mode },
      ]);
    }
    const ack = await world.gladys.fake.setValue(salon, preset, 5);
    assert.equal(ack.success, false);
  });
});

test('home mode: written with setthermmode and shown at once', async () => {
  await withWorld({}, async (world) => {
    await createAll(world);
    const home = deviceNamed(world, 'Mon domicile');
    const ack = await world.gladys.fake.setValue(home, featureOf(home, 'mode'), 1);
    assert.equal(ack.success, true);
    const write = world.intuis.requests.find((request) => request.path === '/api/setthermmode');
    assert.equal(write.body.mode, 'hg');
    await settle(world.hub);
    assert.equal(world.gladys.fake.lastState(featureOf(home, 'mode').external_id), 1);
    // Every room following the home now shows frost protection.
    const salon = deviceNamed(world, 'Salon');
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'preset').external_id), 1);
  });
});

test('the states refresh on the container timer, without onPoll', async () => {
  const world = await createWorld({ timers: true, timings: { refreshMs: 30, energyMs: 60_000 } });
  try {
    await createAll(world);
    const salon = deviceNamed(world, 'Salon');
    const temperature = featureOf(salon, 'temperature').external_id;
    assert.equal(world.gladys.fake.lastState(temperature), 19.5);

    world.intuis.room(ROOMS.LIVING).therm_measured_temperature = 20.7;
    const deadline = Date.now() + 2000;
    while (world.gladys.fake.lastState(temperature) !== 20.7 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(world.gladys.fake.lastState(temperature), 20.7);
    // No poll was ever asked by Gladys.
    const polls = world.gladys.fake.wsMessages.filter((message) => message.type.includes('poll'));
    assert.deepEqual(polls, []);
  } finally {
    await world.app.stop();
  }
});

test('the core onPoll is a fallback: skipped while the timer keeps up', async () => {
  let now = NOW;
  const world = await createWorld({ now: () => now });
  try {
    await createAll(world);
    const salon = deviceNamed(world, 'Salon');
    const before = world.intuis.count('/syncapi/v1/homestatus');
    await world.gladys.fake.poll(salon);
    assert.equal(world.intuis.count('/syncapi/v1/homestatus'), before);
    // The timer stalled for a whole period: onPoll reads.
    now += 5 * 60_000;
    await world.gladys.fake.poll(salon);
    assert.equal(world.intuis.count('/syncapi/v1/homestatus'), before + 1);
  } finally {
    await world.app.stop();
  }
});

test('an unchanged value is sent again after the heartbeat', async () => {
  let now = NOW;
  const world = await createWorld({ now: () => now });
  try {
    await createAll(world);
    const temperature = featureOf(deviceNamed(world, 'Salon'), 'temperature').external_id;
    const count = () =>
      world.gladys.fake.states.filter((state) => state.device_feature_external_id === temperature)
        .length;
    const first = count();
    await world.hub.refresh({ force: true });
    assert.equal(count(), first, 'unchanged: not sent');
    // The SDK heartbeat runs on the real clock: shorten it to check the wiring.
    world.hub.timings.heartbeatMs = 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    now += 60_000;
    await world.hub.refresh({ force: true });
    assert.equal(count(), first + 1, 'sent again once older than the heartbeat');
    assert.ok(world.hub.timings.heartbeatMs <= 12 * 3600_000);
  } finally {
    await world.app.stop();
  }
});

test('the default heartbeat is at most 12 hours', async () => {
  const { DEFAULT_TIMINGS } = await import('../src/hub.js');
  assert.ok(DEFAULT_TIMINGS.heartbeatMs <= 12 * 3600_000);
  assert.equal(DEFAULT_TIMINGS.refreshMs, 5 * 60_000);
});

test('a wrong password: a clear status, no new attempt for 30 minutes', async () => {
  let now = NOW;
  const world = await createWorld({ now: () => now, config: { ...CONFIG, password: 'wrong' } });
  try {
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: STATUS.credentials,
    });
    const attempts = world.intuis.count('/oauth2/token');
    now += 10 * 60_000;
    await world.hub.refresh();
    assert.equal(world.intuis.count('/oauth2/token'), attempts);
    now += 25 * 60_000;
    await world.hub.refresh();
    assert.equal(world.intuis.count('/oauth2/token'), attempts + 1);

    // The user fixes the password: connected at once.
    await world.gladys.fake.configUpdated(CONFIG);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

    // Credentials removed, then entered again: the status follows each time.
    await world.gladys.fake.configUpdated({});
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: STATUS.notConfigured,
    });
    await world.gladys.fake.configUpdated(CONFIG);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.app.stop();
  }
});

test('rate limited: readings paused for 15 minutes', async () => {
  let now = NOW;
  const world = await createWorld({ now: () => now });
  try {
    world.intuis.failure = 'rate_limited';
    await world.hub.refresh({ force: true });
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: STATUS.rateLimited,
    });
    world.intuis.failure = null;
    const reads = world.intuis.count('/api/homesdata');
    now += 60_000; // Retry-After: 120 s
    await world.hub.refresh();
    assert.equal(world.intuis.count('/api/homesdata'), reads);
    now += 120_000;
    await world.hub.refresh();
    assert.equal(world.intuis.count('/api/homesdata'), reads + 1);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.app.stop();
  }
});

test('the cloud down: devices unreachable, back to cloud on return', async () => {
  await withWorld({}, async (world) => {
    await createAll(world);
    const salon = deviceNamed(world, 'Salon').external_id;
    world.intuis.failure = 'network';
    await world.hub.refresh({ force: true });
    assert.deepEqual(world.gladys.fake.connectionStatus, {
      connected: false,
      message: STATUS.unreachable,
    });
    const last = (id) =>
      world.gladys.fake.transports.filter((entry) => entry.device_external_id === id).at(-1);
    assert.equal(last(salon).transport, 'unreachable');
    world.intuis.failure = null;
    await world.hub.refresh({ force: true });
    assert.equal(last(salon).transport, 'cloud');
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  });
});

test('a device added later gets its states at once', async () => {
  await withWorld({ config: { ...CONFIG, energy: false } }, async (world) => {
    const salon = deviceNamed(world, 'Salon');
    const reads = world.intuis.count('/syncapi/v1/homestatus');
    await world.gladys.fake.deviceCreated(salon);
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'setpoint').external_id), 20);
    // From the last reading: no extra request.
    assert.equal(world.intuis.count('/syncapi/v1/homestatus'), reads);
    assert.ok(world.gladys.fake.widgetRefreshes.includes('rooms'));
  });
});

test('a scan publishes the devices again', async () => {
  await withWorld({}, async (world) => {
    const before = world.gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
    await world.gladys.fake.scanRequest();
    const after = world.gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
    assert.equal(after, before + 1);
  });
});

test('the connection test says what was found, in four languages', async () => {
  await withWorld({}, async (world) => {
    const ack = await world.gladys.fake.action('test_connection');
    assert.equal(ack.success, true);
    assert.equal(ack.data.message.fr, 'Connecté à intuis : 1 logement(s), 4 pièce(s).');
    assert.deepEqual(Object.keys(ack.data.message).sort(), ['de', 'en', 'es', 'fr']);

    world.intuis.password = 'changed';
    world.intuis.refreshToken = null;
    world.intuis.expireToken();
    const refused = await world.gladys.fake.action('test_connection');
    assert.deepEqual(refused.data.message, STATUS.credentials);
  });
});

test('logs: a normal cycle writes nothing at info, a failure one line, the return one line', async (t) => {
  const lines = [];
  const capture = (...args) => lines.push(args.join(' '));
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  try {
    const world = await createWorld({ now: () => NOW });
    await createAll(world);
    lines.length = 0;

    // Normal cycles and a command re-read: silent.
    await world.hub.refresh({ force: true });
    await world.hub.refresh({ force: true });
    await world.hub.refreshEnergy();
    assert.deepEqual(lines, []);

    // Three failed cycles: one warning.
    world.intuis.failure = 'network';
    for (let i = 0; i < 3; i += 1) {
      await world.hub.refresh({ force: true });
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\].*intuis cloud unavailable/);

    // The return: one info line.
    world.intuis.failure = null;
    await world.hub.refresh({ force: true });
    await world.hub.refresh({ force: true });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /\[INFO\].*answers again/);

    // A user action: one line.
    const salon = deviceNamed(world, 'Salon');
    await world.gladys.fake.setValue(salon, featureOf(salon, 'setpoint'), 20);
    await settle(world.hub);
    assert.equal(lines.length, 3);
    assert.match(lines[2], /Salon: setpoint 20 °C/);
    await world.app.stop();
  } finally {
    process.env.LOG_LEVEL = previous;
  }
});

test('logs: no secret of the configuration, even in debug and on failures', async (t) => {
  const lines = [];
  const capture = (...args) => lines.push(args.map(String).join(' '));
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  try {
    const wrong = await createWorld({ config: { ...CONFIG, password: 'Wrong-Secret-99' } });
    await wrong.app.stop();
    const world = await createWorld();
    await createAll(world);
    world.intuis.expireToken();
    await world.hub.refresh({ force: true });
    world.intuis.failure = 'server';
    await world.hub.refresh({ force: true });
    await world.app.stop();

    const all = lines.join('\n');
    assert.ok(lines.length > 5, 'debug lines were written');
    for (const secret of [
      CONFIG.password,
      'Wrong-Secret-99',
      CONFIG.username,
      'access-1',
      'refresh-1',
      'access-2',
      'refresh-2',
    ]) {
      assert.ok(!all.includes(secret), `"${secret}" found in the logs`);
    }
  } finally {
    process.env.LOG_LEVEL = previous;
  }
});

test('the session file under /data holds tokens, never the password', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const world = await createWorld();
  await world.app.stop();
  const saved = await readFile(join(world.dataDir, 'intuis-state.json'), 'utf8');
  assert.ok(saved.includes('access-1'));
  assert.ok(!saved.includes(CONFIG.password));
  assert.ok(!saved.includes(CONFIG.username));
});
