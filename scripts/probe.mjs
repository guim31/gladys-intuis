#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of the real intuis cloud, with the integration's own client.
//
//   node scripts/probe.mjs
//     A made-up account: the sign-in must be refused as "credentials" (not a
//     network or an API error), which proves the endpoint, the app identifiers
//     and the error handling against the real service.
//
//   INTUIS_USERNAME=... INTUIS_PASSWORD=... node scripts/probe.mjs
//     A real account: reads the homes, their status, the settings and the
//     energy of one room. READ ONLY: no setpoint, no mode is ever written.
//
// What is printed: HTTP methods, paths, statuses, counts and the NAMES of the
// fields found. Never an identifier, a name, a token, an e-mail or a password.
// Nothing is written to disk.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { IntuisClient } from '../src/intuis/client.js';
import { SCALES, parseHomes, parseMeasures, parseRoomStates } from '../src/intuis/model.js';

const username =
  process.env.INTUIS_USERNAME || `probe-${randomBytes(4).toString('hex')}@example.com`;
const password = process.env.INTUIS_PASSWORD || randomBytes(12).toString('base64url');
const realAccount = Boolean(process.env.INTUIS_USERNAME && process.env.INTUIS_PASSWORD);

// Log every exchange without its content.
const traced = async (url, init) => {
  const { host, pathname } = new URL(url);
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    console.log(
      `  ${init?.method ?? 'GET'} ${host}${pathname} -> ${response.status} (${Date.now() - started} ms)`,
    );
    return response;
  } catch (err) {
    console.log(`  ${init?.method ?? 'GET'} ${host}${pathname} -> ${err.cause?.code ?? err.name}`);
    throw err;
  }
};

const keys = (object) =>
  Object.keys(object ?? {})
    .sort()
    .join(', ');

async function main() {
  const client = new IntuisClient({ username, password, fetch: traced });
  console.log(
    realAccount ? 'Real account, read only.' : 'Made-up account: expecting a refused sign-in.',
  );

  try {
    await client.authenticate();
  } catch (err) {
    console.log(`Sign-in: ${err.kind} (${err.code ?? err.status ?? '-'})`);
    if (!realAccount) {
      const ok = err.kind === 'credentials';
      console.log(
        ok ? 'OK: intuis refused the made-up account as expected.' : 'UNEXPECTED: see above.',
      );
      process.exitCode = ok ? 0 : 1;
      return;
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `Signed in on ${new URL(client.baseUrl).host} with app identifiers #${client.client.id.slice(-3)}`,
  );
  if (!realAccount) {
    console.log('UNEXPECTED: a made-up account was accepted.');
    process.exitCode = 1;
    return;
  }

  const rawHomes = await client.homesData();
  const homes = parseHomes(rawHomes);
  console.log(`homesdata: ${rawHomes.length} home(s), ${homes.length} with rooms`);
  console.log(`  home fields: ${keys(rawHomes[0])}`);
  console.log(`  room fields: ${keys(rawHomes[0]?.rooms?.[0])}`);
  console.log(
    `  module types: ${[...new Set((rawHomes[0]?.modules ?? []).map((m) => m.type))].join(', ')}`,
  );
  for (const home of homes) {
    console.log(`  home mode: ${home.thermMode}; therm schedules: ${home.schedules.length}`);
    const status = await client.homeStatus(home.id);
    console.log(
      `homestatus: ${status.rooms?.length ?? 0} room(s), ${status.modules?.length ?? 0} module(s)`,
    );
    console.log(`  room fields: ${keys(status.rooms?.[0])}`);
    const nmh = (status.modules ?? []).find((module) => module.type === 'NMH');
    console.log(`  radiator (NMH) fields: ${keys(nmh)}`);
    const states = parseRoomStates(home, status);
    for (const state of states.values()) {
      console.log(
        `  room: mode=${state.roomMode} heating=${state.heating} window=${state.openWindow} ` +
          `presence=${state.presence} reachable=${state.reachable}`,
      );
    }
    const configs = await client.homeConfigs(home.id).catch((err) => ({ error: err.message }));
    console.log(`getconfigs: module fields ${keys(configs.modules?.[0])}`);

    const end = Math.floor(Date.now() / 1000);
    for (const room of home.rooms.slice(0, 2)) {
      for (const [scale, span] of [
        [SCALES.THIRTY_MINUTES, 86400],
        [SCALES.DAY, 7 * 86400],
      ]) {
        try {
          const body = await client.roomMeasure({
            homeId: home.id,
            roomId: room.id,
            scale: scale.key,
            begin: end - span,
            end,
          });
          const measures = parseMeasures(body, scale);
          const first = body[0];
          console.log(
            `getroommeasure ${scale.key}: ${measures.length} interval(s); ` +
              `beg_time mod 1800 = ${first ? first.beg_time % 1800 : '-'}, step ${first?.step_time ?? '-'}, ` +
              `columns ${first?.value?.[0]?.map((v) => (v === null ? 'null' : 'n')).join('/') ?? '-'}`,
          );
        } catch (err) {
          console.log(`getroommeasure ${scale.key}: ${err.kind} (${err.code ?? err.status})`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.log(`Probe failed: ${err.kind ?? err.name} (${err.code ?? err.status ?? '-'})`);
  process.exitCode = 1;
});
