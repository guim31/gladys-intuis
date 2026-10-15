// -----------------------------------------------------------------------------
// The Gladys devices of an intuis account, built from the parsed answers
// (src/intuis/model.js). Two device types:
//
//   room  one per room of a home: measured temperature, setpoint, mode and
//         preset (thermostat category of Gladys 5.2), and, when the account
//         reports them, heating in progress, open window, presence and the
//         energy consumed;
//   home  one per home: the home mode (programme / away / frost protection)
//         and the active weekly programme.
//
// External ids are forever: `room:<homeId>-<roomId>` and `home:<homeId>`, the
// ids intuis gives (never a name), and the feature keys below. The optional
// features a room once had are remembered (`known`), so a radiator that skips
// a field for one answer does not change the device structure.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import {
  OPERATING_STATE,
  SETPOINT,
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
  WINDOW_STATE,
  activeSchedule,
  homePreset,
} from './intuis/model.js';

export const DEVICE_TYPES = { ROOM: 'room', HOME: 'home' };

// Feature keys: part of the external ids, never renamed.
export const ROOM_FEATURES = {
  TEMPERATURE: 'temperature',
  SETPOINT: 'setpoint',
  MODE: 'mode',
  PRESET: 'preset',
  HEATING: 'heating',
  WINDOW: 'window',
  PRESENCE: 'presence',
  ENERGY: 'energy', // 30-minute consumption
  ENERGY_DAILY: 'energy-daily', // daily consumption, when the account has no 30-minute data
};
export const HOME_FEATURES = { MODE: 'mode', SCHEDULE: 'schedule' };

// Optional room features, present once the account reported them.
export const OPTIONAL_ROOM_FEATURES = [
  ROOM_FEATURES.HEATING,
  ROOM_FEATURES.WINDOW,
  ROOM_FEATURES.PRESENCE,
  ROOM_FEATURES.ENERGY,
  ROOM_FEATURES.ENERGY_DAILY,
];

// Feature names, in the vocabulary of the Gladys interface (front i18n).
// Names are fixed when the device is created: the configured language applies
// to devices added after a change.
export const NAMES = {
  en: {
    temperature: 'Temperature',
    setpoint: 'Setpoint',
    mode: 'Schedule or manual',
    preset: 'Heating preset',
    heating: 'Heating',
    window: 'Open window',
    presence: 'Presence',
    energy: 'Consumption',
    'energy-daily': 'Daily consumption',
    homeMode: 'Home mode',
    schedule: 'Active schedule',
  },
  fr: {
    temperature: 'Température',
    setpoint: 'Consigne',
    mode: 'Programme ou manuel',
    preset: 'Mode de chauffe',
    heating: 'Chauffe',
    window: 'Fenêtre ouverte',
    presence: 'Présence',
    energy: 'Consommation',
    'energy-daily': 'Consommation journalière',
    homeMode: 'Mode de la maison',
    schedule: 'Programme actif',
  },
  de: {
    temperature: 'Temperatur',
    setpoint: 'Solltemperatur',
    mode: 'Zeitplan oder manuell',
    preset: 'Heizprofil',
    heating: 'Heizt',
    window: 'Offenes Fenster',
    presence: 'Anwesenheit',
    energy: 'Verbrauch',
    'energy-daily': 'Tagesverbrauch',
    homeMode: 'Hausmodus',
    schedule: 'Aktiver Zeitplan',
  },
  es: {
    temperature: 'Temperatura',
    setpoint: 'Consigna',
    mode: 'Programación o manual',
    preset: 'Modo de calefacción',
    heating: 'Calentando',
    window: 'Ventana abierta',
    presence: 'Presencia',
    energy: 'Consumo',
    'energy-daily': 'Consumo diario',
    homeMode: 'Modo de la casa',
    schedule: 'Programación activa',
  },
};

// Labels of the supported options (the Gladys front shows its own translation
// of the standard values; these are the fallback).
const OPTION_LABELS = {
  en: {
    auto: 'Schedule',
    heating: 'Manual',
    schedule: 'Schedule',
    away: 'Away',
    frost: 'Frost protection',
  },
  fr: {
    auto: 'Programme',
    heating: 'Manuel',
    schedule: 'Planning',
    away: 'Absence',
    frost: 'Hors-gel',
  },
  de: {
    auto: 'Zeitplan',
    heating: 'Manuell',
    schedule: 'Zeitplan',
    away: 'Abwesend',
    frost: 'Frostschutz',
  },
  es: {
    auto: 'Programación',
    heating: 'Manual',
    schedule: 'Programación',
    away: 'Ausencia',
    frost: 'Antihielo',
  },
};

const names = (language) => NAMES[language] ?? NAMES.fr;

export const roomPlatformId = (home, room) => `${home.id}-${room.id}`;
export const roomIds = (gladys, home, room) =>
  gladys.externalIds(DEVICE_TYPES.ROOM, roomPlatformId(home, room));
export const homeIds = (gladys, home) => gladys.externalIds(DEVICE_TYPES.HOME, home.id);

/** The optional features a room supports, from its current state. */
export function observedFeatures(state) {
  const found = [];
  if (state?.heating !== null && state?.heating !== undefined) {
    found.push(ROOM_FEATURES.HEATING);
  }
  if (typeof state?.openWindow === 'boolean') {
    found.push(ROOM_FEATURES.WINDOW);
  }
  if (typeof state?.presence === 'boolean') {
    found.push(ROOM_FEATURES.PRESENCE);
  }
  return found;
}

function presetOptions(language) {
  const labels = OPTION_LABELS[language] ?? OPTION_LABELS.fr;
  return [
    { value: THERMOSTAT_PRESET.SCHEDULE, label: labels.schedule, sort_order: 0 },
    { value: THERMOSTAT_PRESET.AWAY, label: labels.away, sort_order: 1 },
    { value: THERMOSTAT_PRESET.FROST, label: labels.frost, sort_order: 2 },
  ];
}

/**
 * The room device.
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {object} home parsed home
 * @param {object} room parsed room
 * @param {object} options
 * @param {string} options.language feature names
 * @param {string[]} options.known optional features the room has
 */
export function buildRoomDevice(gladys, home, room, { language, known = [] }) {
  const ids = roomIds(gladys, home, room);
  const name = names(language);
  const labels = OPTION_LABELS[language] ?? OPTION_LABELS.fr;
  const has = new Set(known);
  const features = [
    {
      name: name.temperature,
      external_id: ids.feature(ROOM_FEATURES.TEMPERATURE),
      category: C.TEMPERATURE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: 'celsius',
      min: -20,
      max: 60,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    {
      name: name.setpoint,
      external_id: ids.feature(ROOM_FEATURES.SETPOINT),
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.TARGET_TEMPERATURE,
      unit: 'celsius',
      min: SETPOINT.MIN,
      max: SETPOINT.MAX,
      step: SETPOINT.STEP,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    },
    {
      name: name.mode,
      external_id: ids.feature(ROOM_FEATURES.MODE),
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.MODE,
      min: THERMOSTAT_MODE.OFF,
      max: THERMOSTAT_MODE.AUTO,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      // Off is shown when the app set it, never offered: hors-gel is the safe stop.
      supported_options: [
        { value: THERMOSTAT_MODE.AUTO, label: labels.auto, sort_order: 0 },
        { value: THERMOSTAT_MODE.HEATING, label: labels.heating, sort_order: 1 },
      ],
    },
    {
      name: name.preset,
      external_id: ids.feature(ROOM_FEATURES.PRESET),
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.PRESET,
      min: 0,
      max: 5,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      supported_options: presetOptions(language),
    },
  ];
  if (has.has(ROOM_FEATURES.HEATING)) {
    features.push({
      name: name.heating,
      external_id: ids.feature(ROOM_FEATURES.HEATING),
      category: C.THERMOSTAT,
      type: T.THERMOSTAT.OPERATING_STATE,
      min: OPERATING_STATE.IDLE,
      max: OPERATING_STATE.HEATING,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  if (has.has(ROOM_FEATURES.WINDOW)) {
    features.push({
      name: name.window,
      external_id: ids.feature(ROOM_FEATURES.WINDOW),
      category: C.OPENING_SENSOR,
      type: T.SENSOR.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  if (has.has(ROOM_FEATURES.PRESENCE)) {
    features.push({
      name: name.presence,
      external_id: ids.feature(ROOM_FEATURES.PRESENCE),
      category: C.PRESENCE_SENSOR,
      type: T.SENSOR.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  for (const [key, type] of [
    [ROOM_FEATURES.ENERGY, T.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION],
    [ROOM_FEATURES.ENERGY_DAILY, T.ENERGY_SENSOR.DAILY_CONSUMPTION],
  ]) {
    if (has.has(key)) {
      features.push({
        name: name[key],
        external_id: ids.feature(key),
        category: C.ENERGY_SENSOR,
        type,
        unit: 'kilowatt-hour',
        min: 0,
        max: 1000,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      });
    }
  }
  return {
    name: room.name,
    external_id: ids.device,
    // The container refreshes on its own every 5 minutes (src/poller.js): the
    // core's scheduler cannot go slower than once a minute, and cannot be
    // trusted to poll an external device at all (GladysAssistant/Gladys#3198).
    should_poll: false,
    params: [
      { name: 'HOME_ID', value: home.id },
      { name: 'ROOM_ID', value: room.id },
    ],
    features,
  };
}

/** The home device. */
export function buildHomeDevice(gladys, home, { language }) {
  const ids = homeIds(gladys, home);
  const name = names(language);
  return {
    name: home.name,
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'HOME_ID', value: home.id }],
    features: [
      {
        name: name.homeMode,
        external_id: ids.feature(HOME_FEATURES.MODE),
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.PRESET,
        min: 0,
        max: 5,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        supported_options: presetOptions(language),
      },
      {
        name: name.schedule,
        external_id: ids.feature(HOME_FEATURES.SCHEDULE),
        category: C.TEXT,
        type: T.TEXT.TEXT,
        min: 0,
        max: 0,
        read_only: true,
        has_feedback: false,
        keep_history: false,
      },
    ],
  };
}

// --- States --------------------------------------------------------------------

/** The states of a room device, from its parsed live state. */
export function roomStates(gladys, home, room, state, known = []) {
  const ids = roomIds(gladys, home, room);
  const has = new Set(known);
  const states = [];
  const push = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  push(ROOM_FEATURES.TEMPERATURE, state.temperature);
  push(ROOM_FEATURES.SETPOINT, state.setpoint);
  push(ROOM_FEATURES.MODE, state.mode);
  push(ROOM_FEATURES.PRESET, state.preset);
  if (has.has(ROOM_FEATURES.HEATING)) {
    push(ROOM_FEATURES.HEATING, state.heating);
  }
  if (has.has(ROOM_FEATURES.WINDOW) && typeof state.openWindow === 'boolean') {
    push(ROOM_FEATURES.WINDOW, state.openWindow ? WINDOW_STATE.OPEN : WINDOW_STATE.CLOSED);
  }
  if (has.has(ROOM_FEATURES.PRESENCE) && typeof state.presence === 'boolean') {
    push(ROOM_FEATURES.PRESENCE, state.presence ? 1 : 0);
  }
  return states;
}

/** The states of a home device. */
export function homeStates(gladys, home) {
  const ids = homeIds(gladys, home);
  const states = [];
  const preset = homePreset(home);
  if (preset !== null) {
    states.push({ device_feature_external_id: ids.feature(HOME_FEATURES.MODE), state: preset });
  }
  const schedule = activeSchedule(home);
  if (schedule) {
    states.push({
      device_feature_external_id: ids.feature(HOME_FEATURES.SCHEDULE),
      text: schedule.name.slice(0, 200),
    });
  }
  return states;
}
