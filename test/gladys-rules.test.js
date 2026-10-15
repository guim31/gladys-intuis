// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (one home, four rooms: two radiators in one, a pilot-wire towel
// rail without state, an unreachable radiator; energy at 30 minutes, daily,
// or none) — in every feature-name language, energy tracking on and off.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'French names (default)', config: CONFIG },
  { label: 'English names', config: { ...CONFIG, language: 'en' } },
  { label: 'German names', config: { ...CONFIG, language: 'de' } },
  { label: 'Spanish names', config: { ...CONFIG, language: 'es' } },
  { label: 'energy tracking off', config: { ...CONFIG, energy: false } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app } = await createWorld({ config: scenario.config });
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 5, 'one home device and four rooms');

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            const allowed = table.units_by_category[feature.category];
            if (allowed) {
              assert.ok(
                allowed.includes(feature.unit),
                `${at}: ${feature.unit} not a unit of ${feature.category}`,
              );
            }
          }
          if (feature.step !== undefined) {
            assert.ok(feature.step > 0, `${at}: step must be > 0`);
          }
          // Enum features: integer options within the bounds, unique, labelled.
          if (feature.supported_options !== undefined) {
            const values = feature.supported_options.map((option) => option.value);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            for (const option of feature.supported_options) {
              assert.ok(
                Number.isInteger(option.value),
                `${at}: option ${option.value} not an integer`,
              );
              assert.ok(
                option.value >= feature.min && option.value <= feature.max,
                `${at}: option ${option.value} outside min/max`,
              );
              assert.ok(option.label?.length > 0, `${at}: option without label`);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
    } finally {
      await app.stop();
    }
  });
}

test('every published state is accepted by the fake Gladys (no 400)', async () => {
  const world = await createWorld();
  try {
    for (const device of world.gladys.fake.discoveredDevices) {
      await world.gladys.fake.deviceCreated(device);
    }
    const refused = world.gladys.fake.requests.filter((request) => request.status >= 400);
    assert.deepEqual(refused, []);
    assert.ok(world.gladys.fake.states.length > 20);
  } finally {
    await world.app.stop();
  }
});
