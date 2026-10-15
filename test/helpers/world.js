// -----------------------------------------------------------------------------
// Builds a complete test world: the SDK's fake Gladys, the fake intuis cloud,
// a temporary /data, and the integration wired on top through
// registerHandlers — the very wiring of index.js.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { PASSWORD, USERNAME, createFakeIntuis } from './fakeIntuis.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const CONFIG = { username: USERNAME, password: PASSWORD };

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (credentials by default)
 * @param {object} [options.cloud] a fake intuis cloud (createFakeIntuis)
 * @param {object} [options.cloudOptions] options of a new fake cloud
 * @param {Array} [options.gladysDevices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 * @param {object} [options.timings] hub timing overrides
 * @param {boolean} [options.timers] run the hub's own timers
 * @param {() => number} [options.now]
 */
export async function createWorld({
  config = CONFIG,
  cloud,
  cloudOptions = {},
  gladysDevices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-intuis-')),
  timings = {},
  timers = false,
  now,
} = {}) {
  const intuis = cloud ?? createFakeIntuis({ now, ...cloudOptions });
  const gladys = createFakeGladys({ config, devices: gladysDevices });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: intuis.fetch,
    timers,
    timings: { rereadDelayMs: 0, ...timings },
    now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, intuis, app, hub: app.hub, store, dataDir };
}

/** Let the timers set to 0 ms (the re-read after a command) run. */
export async function settle(hub) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  while (hub.refreshing) {
    await hub.refreshing;
  }
}

/** Create every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
  await settle(world.hub);
}

/** The discovered device whose name is `name`. */
export const deviceNamed = (world, name) =>
  world.gladys.fake.discoveredDevices.find((device) => device.name === name);

/** The feature of a device whose external id ends with `:<key>`. */
export const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
