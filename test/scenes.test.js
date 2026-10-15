// -----------------------------------------------------------------------------
// The `set_room_setpoint` scene action: a temperature for a while.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemperature } from '../src/scenes.js';
import { ROOMS } from './helpers/fakeIntuis.js';
import { createWorld, deviceNamed } from './helpers/world.js';

const NOW = Date.UTC(2026, 0, 10, 8, 0, 0);

test('the temperature is read with a comma or a dot', () => {
  assert.equal(parseTemperature('19,5'), 19.5);
  assert.equal(parseTemperature(' 21.5 °C'), 21.5);
  assert.equal(parseTemperature(20), 20);
  assert.ok(Number.isNaN(parseTemperature('chaud')));
});

test('holds the temperature for the chosen duration, and says until when', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    const room = deviceNamed(world, 'Salle de bain').external_id;
    const ack = await world.gladys.fake.sceneAction('set_room_setpoint', {
      room,
      temperature: '22,5',
      duration: '60',
    });
    assert.equal(ack.success, true);
    assert.deepEqual(ack.data.outputs, { until: '2026-01-10T09:00:00.000Z' });
    const write = world.intuis.requests.filter((r) => r.path === '/syncapi/v1/setstate').at(-1);
    assert.deepEqual(write.body.home.rooms, [
      {
        id: ROOMS.BATHROOM,
        therm_setpoint_mode: 'manual',
        therm_setpoint_temperature: 22.5,
        therm_setpoint_end_time: NOW / 1000 + 3600,
      },
    ]);
  } finally {
    await world.app.stop();
  }
});

test('without a duration, the one of the configuration (here, the app)', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    const room = deviceNamed(world, 'Salon').external_id;
    const ack = await world.gladys.fake.sceneAction('set_room_setpoint', {
      room,
      temperature: '19',
    });
    assert.equal(ack.data.outputs.until, '2026-01-10T10:00:00.000Z');
  } finally {
    await world.app.stop();
  }
});

test('a wrong temperature or a home instead of a room fails that action only', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    const room = deviceNamed(world, 'Salon').external_id;
    const hot = await world.gladys.fake.sceneAction('set_room_setpoint', {
      room,
      temperature: '45',
    });
    assert.equal(hot.success, false);
    const home = deviceNamed(world, 'Mon domicile').external_id;
    const notARoom = await world.gladys.fake.sceneAction('set_room_setpoint', {
      room: home,
      temperature: '20',
    });
    assert.equal(notARoom.success, false);
    assert.equal(world.intuis.count('/syncapi/v1/setstate'), 0);
  } finally {
    await world.app.stop();
  }
});
