// -----------------------------------------------------------------------------
// Pure reading of the intuis answers: no I/O, so every rule is tested against
// the fixtures of test/fixtures/intuis/.
//
// Vocabulary of the API:
//   - home `therm_mode`: `schedule` (follow the weekly programme), `away`,
//     `hg` (hors-gel, frost protection);
//   - room `therm_setpoint_mode`: `home` (the programme), `manual` (a setpoint
//     held until `therm_setpoint_end_time`), `away`, `hg`, `boost`, `off`;
//   - modules: NMG the gateway, NMR the radio of a radiator, NMH the radiator
//     itself (its `radiator_state` says whether it heats).
//
// Gladys vocabulary (server/utils/constants.js, 5.2): THERMOSTAT_MODE says
// what the machine does (off, heating, auto), THERMOSTAT_PRESET which
// temperature it aims for (schedule, frost, away). A manual setpoint is the
// HEATING mode; the preset then shows what resumes when it ends.
// -----------------------------------------------------------------------------

export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, AUTO: 3 };
export const THERMOSTAT_PRESET = { SCHEDULE: 0, FROST: 1, AWAY: 2 };
export const OPERATING_STATE = { IDLE: 0, HEATING: 1 };
// Opening sensor of Gladys: 0 = open, 1 = closed (OPENING_SENSOR_STATE).
export const WINDOW_STATE = { OPEN: 0, CLOSED: 1 };

// Home mode of the API <-> Gladys preset.
const HOME_MODE_TO_PRESET = {
  schedule: THERMOSTAT_PRESET.SCHEDULE,
  away: THERMOSTAT_PRESET.AWAY,
  hg: THERMOSTAT_PRESET.FROST,
};
export const PRESET_TO_HOME_MODE = {
  [THERMOSTAT_PRESET.SCHEDULE]: 'schedule',
  [THERMOSTAT_PRESET.AWAY]: 'away',
  [THERMOSTAT_PRESET.FROST]: 'hg',
};
// Room preset written from Gladys -> room mode of the API.
export const PRESET_TO_ROOM_MODE = {
  [THERMOSTAT_PRESET.SCHEDULE]: 'home',
  [THERMOSTAT_PRESET.AWAY]: 'away',
  [THERMOSTAT_PRESET.FROST]: 'hg',
};

// Setpoint bounds of the intuis app, by half a degree.
export const SETPOINT = { MIN: 7, MAX: 30, STEP: 0.5 };

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** The thermal schedules of a home (`schedules` today, `therm_schedules` on older accounts). */
function readSchedules(home) {
  const list = Array.isArray(home.schedules)
    ? home.schedules
    : Array.isArray(home.therm_schedules)
      ? home.therm_schedules
      : [];
  return list
    .filter((schedule) => schedule && schedule.id != null && (schedule.type ?? 'therm') === 'therm')
    .map((schedule) => ({
      id: String(schedule.id),
      name: text(schedule.name) ?? String(schedule.id),
      selected: schedule.selected === true,
    }));
}

/**
 * The homes of a `homesdata` answer, reduced to what the integration uses.
 * Homes without any room (an empty or a non-heating home) are left out.
 */
export function parseHomes(homes) {
  return (Array.isArray(homes) ? homes : [])
    .filter((home) => home && text(home.id))
    .map((home) => {
      const modules = (Array.isArray(home.modules) ? home.modules : [])
        .filter((module) => module && text(module.id))
        .map((module) => ({
          id: module.id,
          type: module.type,
          name: text(module.name),
          roomId: module.room_id != null ? String(module.room_id) : null,
          bridge: text(module.bridge),
        }));
      const rooms = (Array.isArray(home.rooms) ? home.rooms : [])
        .filter((room) => room && room.id != null)
        .map((room) => ({
          id: String(room.id),
          name: text(room.name) ?? String(room.id),
          type: text(room.type),
          moduleIds: Array.isArray(room.module_ids) ? room.module_ids.map(String) : [],
        }));
      return {
        id: home.id,
        name: text(home.name) ?? home.id,
        timezone: text(home.timezone),
        thermMode: text(home.therm_mode),
        thermModeEndtime: finite(home.therm_mode_endtime),
        schedules: readSchedules(home),
        rooms,
        modules,
      };
    })
    .filter((home) => home.rooms.length > 0);
}

/** Gladys preset of the home mode, or null for a mode Gladys has no word for. */
export function homePreset(home) {
  return HOME_MODE_TO_PRESET[home.thermMode] ?? null;
}

/** The selected thermal schedule of a home, or null. */
export function activeSchedule(home) {
  return home.schedules.find((schedule) => schedule.selected) ?? null;
}

/** NMH modules (radiators) of a room, from the static and the live module lists. */
function roomRadiators(home, room, statusModules) {
  const ids = new Set(room.moduleIds);
  for (const module of home.modules) {
    if (module.roomId === room.id) {
      ids.add(module.id);
    }
  }
  return statusModules.filter(
    (module) =>
      ids.has(module.id) && (module.type === 'NMH' || module.radiator_state !== undefined),
  );
}

/**
 * Whether the room heats right now: the radiators' `radiator_state` first,
 * the room's `heating_power_request` (Netatmo's field) otherwise. Null when
 * the account reports neither: nothing is guessed from the temperatures.
 */
function heatingState(radiators, statusRoom) {
  const states = radiators
    .map((module) => text(module.radiator_state)?.toLowerCase())
    .filter(Boolean);
  if (states.length > 0) {
    return states.includes('heating') ? OPERATING_STATE.HEATING : OPERATING_STATE.IDLE;
  }
  const request = finite(statusRoom.heating_power_request);
  if (request !== null) {
    return request > 0 ? OPERATING_STATE.HEATING : OPERATING_STATE.IDLE;
  }
  return null;
}

/**
 * The live state of every room of a home, from its `homestatus` answer.
 * @returns {Map<string, object>} by room id; rooms missing from the answer are absent
 */
export function parseRoomStates(home, status) {
  const statusRooms = Array.isArray(status?.rooms) ? status.rooms : [];
  const statusModules = Array.isArray(status?.modules) ? status.modules : [];
  const homeModePreset = homePreset(home);
  const states = new Map();

  for (const room of home.rooms) {
    const live = statusRooms.find((candidate) => String(candidate?.id) === room.id);
    if (!live) {
      continue;
    }
    const roomMode = text(live.therm_setpoint_mode)?.toLowerCase() ?? null;
    const radiators = roomRadiators(home, room, statusModules);
    const reachable = radiators
      .map((module) => module.reachable)
      .filter((r) => typeof r === 'boolean');

    let mode = THERMOSTAT_MODE.AUTO;
    let preset = homeModePreset ?? THERMOSTAT_PRESET.SCHEDULE;
    if (roomMode === 'manual' || roomMode === 'boost' || roomMode === 'max') {
      // A held setpoint; the preset shows what resumes when it ends.
      mode = THERMOSTAT_MODE.HEATING;
    } else if (roomMode === 'off') {
      mode = THERMOSTAT_MODE.OFF;
    } else if (roomMode === 'away') {
      preset = THERMOSTAT_PRESET.AWAY;
    } else if (roomMode === 'hg') {
      preset = THERMOSTAT_PRESET.FROST;
    }

    const endTime = finite(live.therm_setpoint_end_time);
    states.set(room.id, {
      roomMode,
      mode,
      preset,
      temperature: finite(live.therm_measured_temperature),
      setpoint: finite(live.therm_setpoint_temperature),
      // Only meaningful while a setpoint is held.
      endTime: mode === THERMOSTAT_MODE.HEATING && endTime > 0 ? endTime : null,
      heating: heatingState(radiators, live),
      openWindow: typeof live.open_window === 'boolean' ? live.open_window : null,
      presence: typeof live.presence === 'boolean' ? live.presence : null,
      // Unreachable when every radiator of the room says so.
      reachable: reachable.length > 0 ? reachable.some(Boolean) : null,
    });
  }
  return states;
}

/** Default duration of a manual setpoint (minutes) set in the app, or null. */
export function defaultManualMinutes(configs) {
  for (const module of Array.isArray(configs?.modules) ? configs.modules : []) {
    const minutes = finite(module?.therm_setpoint_default_duration);
    if (minutes !== null && minutes > 0) {
      return minutes;
    }
  }
  return null;
}

// --- Energy --------------------------------------------------------------------

export const SCALES = {
  THIRTY_MINUTES: { key: '30min', seconds: 1800 },
  DAY: { key: '1day', seconds: 86400 },
};

/**
 * Energy (Wh) of one row of a measure answer. The columns follow the asked
 * types: the total, then one column per tariff period (only the period in
 * force is filled, two when a day spans peak and off-peak hours). The periods
 * are added up; the total only counts when no period is filled, so a row
 * carrying both is never counted twice.
 */
export function rowWattHours(row) {
  if (!Array.isArray(row)) {
    return null;
  }
  const periods = row
    .slice(1)
    .map(finite)
    .filter((value) => value !== null);
  if (periods.length > 0) {
    return periods.reduce((sum, value) => sum + value, 0);
  }
  return finite(row[0]);
}

/**
 * The intervals of a `getroommeasure` answer: `[{ start, wh }]`, `start` in
 * seconds, floored to the scale. Netatmo stamps a row in the middle of its
 * interval unless asked otherwise; flooring to the slot works either way.
 */
export function parseMeasures(body, scale) {
  const intervals = new Map();
  for (const block of Array.isArray(body) ? body : []) {
    const begin = finite(block?.beg_time);
    if (begin === null || !Array.isArray(block.value)) {
      continue;
    }
    const step = finite(block.step_time) ?? scale.seconds;
    block.value.forEach((row, index) => {
      const wh = rowWattHours(row);
      if (wh === null || wh < 0) {
        return;
      }
      const at = begin + index * step;
      const start = scale.seconds === 1800 ? Math.floor(at / 1800) * 1800 : at;
      intervals.set(start, (intervals.get(start) ?? 0) + wh);
    });
  }
  return [...intervals.entries()].sort(([a], [b]) => a - b).map(([start, wh]) => ({ start, wh }));
}

/** `YYYY-MM-DD` of an instant (seconds) in a time zone. */
export function localDate(seconds, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(seconds * 1000));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
