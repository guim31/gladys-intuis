// -----------------------------------------------------------------------------
// Reading the intuis answers: homes, room states, modes, energy rows.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATING_STATE,
  SCALES,
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
  activeSchedule,
  defaultManualMinutes,
  homePreset,
  localDate,
  parseHomes,
  parseMeasures,
  parseRoomStates,
  rowWattHours,
} from '../src/intuis/model.js';
import { FIXTURES, HOME_ID, ROOMS } from './helpers/fakeIntuis.js';

const homes = () => parseHomes(FIXTURES.homesdata().body.homes);
const statusOf = (mutate = () => {}) => {
  const status = FIXTURES.homestatus().body.home;
  mutate(status);
  return status;
};

test('homes: rooms and modules kept, a home without rooms left out', () => {
  const parsed = homes();
  assert.equal(parsed.length, 1);
  const [home] = parsed;
  assert.equal(home.id, HOME_ID);
  assert.equal(home.name, 'Mon domicile');
  assert.equal(home.timezone, 'Europe/Paris');
  assert.deepEqual(
    home.rooms.map((room) => room.name),
    ['Salon', 'Chambre parentale', 'Salle de bain', 'Bureau'],
  );
  assert.deepEqual(home.rooms[0].moduleIds, ['00:00:00:00:a1:b2:c3:01', '00:00:00:00:a1:b2:c3:02']);
});

test('homes: only the heating schedules, the selected one is active', () => {
  const [home] = homes();
  assert.deepEqual(
    home.schedules.map((schedule) => schedule.name),
    ['Semaine type', 'Vacances scolaires'],
  );
  assert.equal(activeSchedule(home).name, 'Semaine type');
});

test('homes: older accounts list their schedules as therm_schedules', () => {
  const raw = FIXTURES.homesdata().body.homes[0];
  raw.therm_schedules = raw.schedules.filter((schedule) => schedule.type === 'therm');
  delete raw.schedules;
  for (const schedule of raw.therm_schedules) {
    delete schedule.type;
  }
  const [home] = parseHomes([raw]);
  assert.equal(activeSchedule(home).name, 'Semaine type');
});

test('homes: the home mode maps to the Gladys presets', () => {
  const [home] = homes();
  for (const [mode, preset] of [
    ['schedule', THERMOSTAT_PRESET.SCHEDULE],
    ['away', THERMOSTAT_PRESET.AWAY],
    ['hg', THERMOSTAT_PRESET.FROST],
    ['something-new', null],
  ]) {
    assert.equal(homePreset({ ...home, thermMode: mode }), preset, mode);
  }
});

test('homes: garbage is not a crash', () => {
  assert.deepEqual(parseHomes(undefined), []);
  assert.deepEqual(parseHomes([null, { id: '' }, { id: 'x', rooms: 'no' }]), []);
});

test('rooms: temperatures, setpoint, mode and preset of every room', () => {
  const [home] = homes();
  const states = parseRoomStates(home, statusOf());

  const living = states.get(ROOMS.LIVING);
  assert.equal(living.temperature, 19.5);
  assert.equal(living.setpoint, 20);
  assert.equal(living.mode, THERMOSTAT_MODE.AUTO);
  assert.equal(living.preset, THERMOSTAT_PRESET.SCHEDULE);
  assert.equal(living.endTime, null);

  // A setpoint held until 1767204000: manual, the schedule resumes after.
  const bedroom = states.get(ROOMS.BEDROOM);
  assert.equal(bedroom.mode, THERMOSTAT_MODE.HEATING);
  assert.equal(bedroom.preset, THERMOSTAT_PRESET.SCHEDULE);
  assert.equal(bedroom.endTime, 1767204000);

  assert.equal(states.get(ROOMS.BATHROOM).preset, THERMOSTAT_PRESET.FROST);
  assert.equal(states.get(ROOMS.BATHROOM).mode, THERMOSTAT_MODE.AUTO);
  assert.equal(states.get(ROOMS.OFFICE).preset, THERMOSTAT_PRESET.AWAY);
});

test('rooms: a home set to away shows away in every room that follows it', () => {
  const [home] = homes();
  home.thermMode = 'away';
  const states = parseRoomStates(home, statusOf());
  assert.equal(states.get(ROOMS.LIVING).preset, THERMOSTAT_PRESET.AWAY);
  // The manual room keeps its hold, and resumes to "away".
  assert.equal(states.get(ROOMS.BEDROOM).mode, THERMOSTAT_MODE.HEATING);
  assert.equal(states.get(ROOMS.BEDROOM).preset, THERMOSTAT_PRESET.AWAY);
});

test('rooms: boost is a held setpoint, off is the off mode', () => {
  const [home] = homes();
  const states = parseRoomStates(
    home,
    statusOf((status) => {
      status.rooms[0].therm_setpoint_mode = 'boost';
      status.rooms[2].therm_setpoint_mode = 'off';
    }),
  );
  assert.equal(states.get(ROOMS.LIVING).mode, THERMOSTAT_MODE.HEATING);
  assert.equal(states.get(ROOMS.BATHROOM).mode, THERMOSTAT_MODE.OFF);
});

test('rooms: heating when one radiator heats, nothing guessed without a signal', () => {
  const [home] = homes();
  const states = parseRoomStates(home, statusOf());
  // Two radiators in the living room, one heating.
  assert.equal(states.get(ROOMS.LIVING).heating, OPERATING_STATE.HEATING);
  assert.equal(states.get(ROOMS.BEDROOM).heating, OPERATING_STATE.IDLE);
  // The pilot-wire towel rail reports no state: unknown, not idle.
  assert.equal(states.get(ROOMS.BATHROOM).heating, null);

  const viaPowerRequest = parseRoomStates(
    home,
    statusOf((status) => {
      status.rooms[2].heating_power_request = 40;
    }),
  );
  assert.equal(viaPowerRequest.get(ROOMS.BATHROOM).heating, OPERATING_STATE.HEATING);
});

test('rooms: window, presence and reachability', () => {
  const [home] = homes();
  const states = parseRoomStates(home, statusOf());
  assert.equal(states.get(ROOMS.BEDROOM).openWindow, true);
  assert.equal(states.get(ROOMS.LIVING).openWindow, false);
  assert.equal(states.get(ROOMS.BATHROOM).openWindow, null);
  assert.equal(states.get(ROOMS.LIVING).presence, true);
  assert.equal(states.get(ROOMS.OFFICE).reachable, false);
  assert.equal(states.get(ROOMS.LIVING).reachable, true);
});

test('rooms: a room missing from the status is absent, not invented', () => {
  const [home] = homes();
  const states = parseRoomStates(
    home,
    statusOf((status) => {
      status.rooms = status.rooms.slice(1);
    }),
  );
  assert.equal(states.has(ROOMS.LIVING), false);
  assert.equal(parseRoomStates(home, undefined).size, 0);
});

test('the default duration of a manual setpoint comes from the app settings', () => {
  assert.equal(defaultManualMinutes({ modules: [{ therm_setpoint_default_duration: 120 }] }), 120);
  assert.equal(defaultManualMinutes({ modules: [{}] }), null);
  assert.equal(defaultManualMinutes(undefined), null);
});

test('energy rows: the tariff periods add up, the total never counts twice', () => {
  // A real daily row (Home Assistant intuis_connect docs): peak and off-peak.
  assert.equal(rowWattHours([null, null, 14245, 7694]), 21939);
  assert.equal(rowWattHours([null, 3020, null, null]), 3020);
  // Total and periods both filled: the periods win.
  assert.equal(rowWattHours([500, 300, 200, null]), 500);
  // Only the total.
  assert.equal(rowWattHours([812, null, null, null]), 812);
  assert.equal(rowWattHours([null, null, null, null]), null);
  assert.equal(rowWattHours('x'), null);
});

test('energy: 30-minute rows stamped mid-slot are floored to their slot', () => {
  const start = 1767225600; // 2026-01-01T00:00:00Z
  const body = [
    {
      beg_time: start + 900,
      step_time: 1800,
      value: [
        [null, 100, null, null],
        [null, null, 50, null],
      ],
    },
  ];
  assert.deepEqual(parseMeasures(body, SCALES.THIRTY_MINUTES), [
    { start, wh: 100 },
    { start: start + 1800, wh: 50 },
  ]);
  // Already aligned: unchanged.
  const aligned = [{ beg_time: start, step_time: 1800, value: [[null, 10, null, null]] }];
  assert.deepEqual(parseMeasures(aligned, SCALES.THIRTY_MINUTES), [{ start, wh: 10 }]);
});

test('energy: daily rows of the real answer', () => {
  const measures = parseMeasures(FIXTURES.measureDay().body, SCALES.DAY);
  assert.deepEqual(
    measures.map(({ start, wh }) => [localDate(start, 'Europe/Paris'), wh]),
    [
      ['2026-01-01', 21939],
      ['2026-01-02', 18121],
      ['2026-01-03', 3020],
    ],
  );
  assert.deepEqual(parseMeasures(undefined, SCALES.DAY), []);
  assert.deepEqual(
    parseMeasures([{ beg_time: 'x' }, { beg_time: 1, value: [[-5]] }], SCALES.DAY),
    [],
  );
});

test('local dates follow the time zone', () => {
  // 2025-12-31T23:30:00Z is already January 1st in Paris.
  assert.equal(localDate(1767223800, 'Europe/Paris'), '2026-01-01');
  assert.equal(localDate(1767223800, 'UTC'), '2025-12-31');
});
