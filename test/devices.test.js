// -----------------------------------------------------------------------------
// The devices and their states: external ids (forever), feature names, the
// opening sensor convention, optional features that never disappear.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  NAMES,
  ROOM_FEATURES,
  buildHomeDevice,
  buildRoomDevice,
  homeStates,
  roomStates,
} from '../src/devices.js';
import { WINDOW_STATE, parseHomes, parseRoomStates } from '../src/intuis/model.js';
import { FIXTURES, HOME_ID, ROOMS } from './helpers/fakeIntuis.js';
import { CONFIG, createAll, createWorld, deviceNamed, featureOf, settle } from './helpers/world.js';

const gladys = createFakeGladys({ selector: 'intuis' });
const [home] = parseHomes(FIXTURES.homesdata().body.homes);
const states = parseRoomStates(home, FIXTURES.homestatus().body.home);
const room = (id) => home.rooms.find((candidate) => candidate.id === id);

test('external ids are built from the intuis ids, never from a name (frozen)', () => {
  const device = buildRoomDevice(gladys, home, room(ROOMS.LIVING), {
    language: 'fr',
    known: [
      ROOM_FEATURES.HEATING,
      ROOM_FEATURES.WINDOW,
      ROOM_FEATURES.PRESENCE,
      ROOM_FEATURES.ENERGY,
    ],
  });
  const prefix = `ext:intuis:room:${HOME_ID}-${ROOMS.LIVING}`;
  assert.equal(device.external_id, prefix);
  assert.deepEqual(
    device.features.map((feature) => feature.external_id),
    ['temperature', 'setpoint', 'mode', 'preset', 'heating', 'window', 'presence', 'energy'].map(
      (key) => `${prefix}:${key}`,
    ),
  );
  const homeDevice = buildHomeDevice(gladys, home, { language: 'fr' });
  assert.equal(homeDevice.external_id, `ext:intuis:home:${HOME_ID}`);
  assert.deepEqual(
    homeDevice.features.map((feature) => feature.external_id),
    [`ext:intuis:home:${HOME_ID}:mode`, `ext:intuis:home:${HOME_ID}:schedule`],
  );
});

test('a renamed room keeps its external ids', () => {
  const renamed = { ...room(ROOMS.LIVING), name: 'Séjour' };
  const before = buildRoomDevice(gladys, home, room(ROOMS.LIVING), { language: 'fr' });
  const after = buildRoomDevice(gladys, home, renamed, { language: 'fr' });
  assert.equal(after.name, 'Séjour');
  assert.deepEqual(
    after.features.map((feature) => feature.external_id),
    before.features.map((feature) => feature.external_id),
  );
});

test('the setpoint is a thermostat setpoint by half a degree, 7 to 30 °C', () => {
  const device = buildRoomDevice(gladys, home, room(ROOMS.LIVING), { language: 'fr' });
  const setpoint = featureOf(device, 'setpoint');
  assert.equal(setpoint.category, 'thermostat');
  assert.equal(setpoint.type, 'target-temperature');
  assert.equal(setpoint.unit, 'celsius');
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.step], [7, 30, 0.5]);
  assert.equal(setpoint.read_only, false);
  // The mode offers the schedule and manual, never "off".
  assert.deepEqual(
    featureOf(device, 'mode').supported_options.map((option) => option.value),
    [3, 1],
  );
  assert.deepEqual(
    featureOf(device, 'preset').supported_options.map((option) => option.value),
    [0, 2, 1],
  );
  // Polled by the container, not by the core.
  assert.equal(device.should_poll, false);
  assert.equal(device.poll_frequency, undefined);
});

test('feature names follow the configured language', () => {
  for (const language of ['en', 'fr', 'de', 'es']) {
    const device = buildRoomDevice(gladys, home, room(ROOMS.LIVING), { language });
    assert.equal(featureOf(device, 'setpoint').name, NAMES[language].setpoint);
  }
  // Room and home names are the ones of the intuis app.
  assert.equal(
    buildRoomDevice(gladys, home, room(ROOMS.BEDROOM), { language: 'en' }).name,
    'Chambre parentale',
  );
  assert.equal(buildHomeDevice(gladys, home, { language: 'en' }).name, 'Mon domicile');
});

test('an open window is published as 0, a closed one as 1 (Gladys opening sensor)', () => {
  const known = [ROOM_FEATURES.WINDOW];
  const window = (id) =>
    roomStates(gladys, home, room(id), states.get(id), known).find((state) =>
      state.device_feature_external_id.endsWith(':window'),
    ).state;
  assert.equal(window(ROOMS.BEDROOM), WINDOW_STATE.OPEN);
  assert.equal(window(ROOMS.BEDROOM), 0);
  assert.equal(window(ROOMS.LIVING), WINDOW_STATE.CLOSED);
  assert.equal(window(ROOMS.LIVING), 1);
});

test('room states: nothing published for an unknown value', () => {
  const published = roomStates(gladys, home, room(ROOMS.BATHROOM), states.get(ROOMS.BATHROOM), [
    ROOM_FEATURES.HEATING,
  ]);
  assert.deepEqual(
    published.map((state) => state.device_feature_external_id.split(':').pop()),
    ['temperature', 'setpoint', 'mode', 'preset'],
  );
});

test('home states: the home mode and the name of the active schedule', () => {
  assert.deepEqual(homeStates(gladys, home), [
    { device_feature_external_id: `ext:intuis:home:${HOME_ID}:mode`, state: 0 },
    { device_feature_external_id: `ext:intuis:home:${HOME_ID}:schedule`, text: 'Semaine type' },
  ]);
});

test('a feature seen once stays, even when an answer skips its field', async () => {
  const world = await createWorld();
  try {
    const before = deviceNamed(world, 'Salon').features.map((feature) => feature.external_id);
    for (const statusRoom of world.intuis.homestatus.body.home.rooms) {
      delete statusRoom.open_window;
      delete statusRoom.presence;
    }
    for (const module of world.intuis.homestatus.body.home.modules) {
      delete module.radiator_state;
    }
    await world.hub.refresh({ force: true });
    const after = deviceNamed(world, 'Salon').features.map((feature) => feature.external_id);
    assert.deepEqual(after, before);
  } finally {
    await world.app.stop();
  }
});

test('the optional features survive a restart (kept under /data)', async () => {
  const first = await createWorld();
  await first.app.stop();
  const cloud = first.intuis;
  for (const statusRoom of cloud.homestatus.body.home.rooms) {
    delete statusRoom.open_window;
  }
  const second = await createWorld({ cloud, dataDir: first.dataDir });
  try {
    assert.ok(featureOf(deviceNamed(second, 'Salon'), 'window'));
    // The saved session is reused: no new sign-in.
    assert.equal(cloud.count('/oauth2/token'), 1);
  } finally {
    await second.app.stop();
  }
});

test('the states of every added device are published once added', async () => {
  const world = await createWorld({ config: { ...CONFIG, energy: false } });
  try {
    assert.equal(world.gladys.fake.states.length, 0, 'nothing before the user adds a device');
    await createAll(world);
    await settle(world.hub);
    const salon = deviceNamed(world, 'Salon');
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'temperature').external_id), 19.5);
    assert.equal(world.gladys.fake.lastState(featureOf(salon, 'heating').external_id), 1);
    const office = deviceNamed(world, 'Bureau');
    assert.equal(world.gladys.fake.lastState(featureOf(office, 'preset').external_id), 2);
    // The unreachable radiator shows as such on its device card.
    assert.ok(
      world.gladys.fake.transports.some(
        (entry) =>
          entry.device_external_id === office.external_id && entry.transport === 'unreachable',
      ),
    );
  } finally {
    await world.app.stop();
  }
});
