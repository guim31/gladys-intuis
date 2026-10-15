// -----------------------------------------------------------------------------
// The consumption of the rooms: which rooms get a feature, the 30-minute and
// daily intervals sent with publishEnergyConsumption (elapsed only, aligned,
// in kWh), and the pace of the readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS } from './helpers/fakeIntuis.js';
import { CONFIG, createAll, createWorld, deviceNamed, featureOf } from './helpers/world.js';

// 2026-01-10 08:10 UTC: in the middle of a 30-minute slot.
const NOW = Date.UTC(2026, 0, 10, 8, 10, 0);

const measureCalls = (world, roomId) =>
  world.intuis.requests.filter(
    (request) => request.path === '/api/getroommeasure' && request.form.get('room_id') === roomId,
  );

test('a room gets the consumption feature its radiators report', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    assert.equal(
      featureOf(deviceNamed(world, 'Salon'), 'energy').type,
      'thirty-minutes-consumption',
    );
    assert.equal(
      featureOf(deviceNamed(world, 'Chambre parentale'), 'energy-daily').type,
      'daily-consumption',
    );
    assert.equal(featureOf(deviceNamed(world, 'Chambre parentale'), 'energy'), undefined);
    // The pilot-wire towel rail reports nothing: no empty feature.
    const bathroom = deviceNamed(world, 'Salle de bain');
    assert.equal(featureOf(bathroom, 'energy'), undefined);
    assert.equal(featureOf(bathroom, 'energy-daily'), undefined);
    for (const feature of [
      featureOf(deviceNamed(world, 'Salon'), 'energy'),
      featureOf(deviceNamed(world, 'Chambre parentale'), 'energy-daily'),
    ]) {
      assert.equal(feature.category, 'energy-sensor');
      assert.equal(feature.unit, 'kilowatt-hour');
      assert.equal(feature.read_only, true);
    }
  } finally {
    await world.app.stop();
  }
});

test('30-minute slots: elapsed, aligned, in kWh, a week of history first', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    await createAll(world);
    const feature = featureOf(deviceNamed(world, 'Salon'), 'energy').external_id;
    const batches = world.gladys.fake.publishedEnergyConsumption.filter(
      (batch) => batch.device_feature_external_id === feature,
    );
    assert.equal(batches.length, 1);
    const { intervals } = batches[0];
    // A week of slots, none still running.
    assert.ok(intervals.length >= 7 * 48 - 2 && intervals.length <= 7 * 48, `${intervals.length}`);
    const last = intervals.at(-1);
    assert.equal(last.starts_at, '2026-01-10T07:30:00.000Z');
    for (const interval of intervals) {
      const start = Date.parse(interval.starts_at);
      assert.equal(start % 1_800_000, 0, `${interval.starts_at} not aligned`);
      assert.ok(start + 1_800_000 <= NOW, `${interval.starts_at} not elapsed`);
    }
    // 100 Wh at night (off-peak column), 250 Wh in the day (peak column).
    const at = (iso) => intervals.find((interval) => interval.starts_at === iso).kwh;
    assert.equal(at('2026-01-10T02:00:00.000Z'), 0.1);
    assert.equal(at('2026-01-10T07:30:00.000Z'), 0.25);
    // Stored by the fake Gladys like the core: no 400.
    assert.ok(Object.keys(world.gladys.fake.energyConsumption).includes(feature));
  } finally {
    await world.app.stop();
  }
});

test('daily totals: only the days that are over, by date', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    await createAll(world);
    const feature = featureOf(deviceNamed(world, 'Chambre parentale'), 'energy-daily').external_id;
    const [batch] = world.gladys.fake.publishedEnergyConsumption.filter(
      (entry) => entry.device_feature_external_id === feature,
    );
    const dates = batch.intervals.map((interval) => interval.date);
    assert.ok(!dates.includes('2026-01-10'), 'today is not over');
    assert.ok(dates.includes('2026-01-09'));
    assert.deepEqual(dates, [...dates].sort());
    // Peak 4200 Wh + off-peak 2100 Wh.
    assert.ok(batch.intervals.every((interval) => interval.kwh === 6.3));
  } finally {
    await world.app.stop();
  }
});

test('the energy is read once an hour, only for the rooms added with the feature', async () => {
  let now = NOW;
  const world = await createWorld({ now: () => now });
  try {
    // Probe at start: the living room answers at 30 minutes, the others are asked both scales.
    assert.equal(measureCalls(world, ROOMS.LIVING).length, 1);
    assert.equal(measureCalls(world, ROOMS.BATHROOM).length, 2);

    // Nothing added yet: nothing read.
    now += 3600_000;
    await world.hub.refreshEnergy();
    assert.equal(measureCalls(world, ROOMS.LIVING).length, 1);
    assert.equal(measureCalls(world, ROOMS.BATHROOM).length, 2, 'not probed again before a week');

    await world.gladys.fake.deviceCreated(deviceNamed(world, 'Salon'));
    assert.equal(measureCalls(world, ROOMS.LIVING).length, 2);
    now += 3600_000;
    await world.hub.refreshEnergy();
    const last = measureCalls(world, ROOMS.LIVING).at(-1);
    assert.equal(measureCalls(world, ROOMS.LIVING).length, 3);
    // After the first week, the last day only.
    const span = Number(last.form.get('date_end')) - Number(last.form.get('date_begin'));
    assert.ok(span <= 25 * 3600, `${span}`);
  } finally {
    await world.app.stop();
  }
});

test('a room added before its energy was found is fed once updated', async () => {
  const world = await createWorld({
    now: () => NOW,
    cloudOptions: { energy: {} },
  });
  try {
    await createAll(world);
    assert.equal(featureOf(deviceNamed(world, 'Salon'), 'energy'), undefined);
    // The radiators start reporting, the weekly probe finds it.
    world.intuis.energy[ROOMS.LIVING] = '30min';
    world.hub.data.rooms[deviceNamed(world, 'Salon').external_id].energy.probedAt = 0;
    await world.hub.refreshEnergy();
    const salon = deviceNamed(world, 'Salon');
    const feature = featureOf(salon, 'energy');
    assert.ok(feature, 'published with the new feature: "Update" in Discovery');
    assert.equal(world.gladys.fake.publishedEnergyConsumption.length, 0, 'not created yet');
    await world.gladys.fake.deviceUpdated(salon);
    assert.equal(world.gladys.fake.publishedEnergyConsumption.length, 1);
  } finally {
    await world.app.stop();
  }
});

test('energy tracking off: no feature, no measure request', async () => {
  const world = await createWorld({ now: () => NOW, config: { ...CONFIG, energy: false } });
  try {
    await createAll(world);
    await world.hub.refreshEnergy();
    assert.equal(world.intuis.count('/api/getroommeasure'), 0);
    assert.equal(featureOf(deviceNamed(world, 'Salon'), 'energy'), undefined);
  } finally {
    await world.app.stop();
  }
});

test('an energy failure is logged once and does not disturb the rooms', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    await createAll(world);
    world.intuis.failure = 'server';
    await world.hub.refreshEnergy();
    await world.hub.refreshEnergy();
    assert.ok(world.hub.issues.isFailing('energy'));
    world.intuis.failure = null;
    await world.hub.refreshEnergy();
    assert.equal(world.hub.issues.isFailing('energy'), false);
    assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  } finally {
    await world.app.stop();
  }
});
