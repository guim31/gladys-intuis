// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `rooms`.
//
// What the device boxes do not give at a glance: every room of the home in one
// card (temperature, setpoint, mode, window), and the home mode in one tap,
// like the home screen of the intuis app.
//
// Budget (8 components, 2 texts, 1 status, 4 buttons): a caption, one status
// list (10 rooms at most) and three buttons. The active home mode is marked by
// its icon (`check-circle`), never by the button style: `primary` is
// invisible in dark mode. The buttons are widget actions, not device-feature
// buttons: they work before the home device is added to Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { PRESET_NAMES, pick } from './i18n.js';
import { THERMOSTAT_MODE, THERMOSTAT_PRESET, activeSchedule, homePreset } from './intuis/model.js';

export const WIDGET_KEY = 'rooms';
const ACTIVE_ICON = 'check-circle';
const MAX_ROOMS = 10;

// Widget action keys: stored in no dashboard, but stable all the same.
export const HOME_MODE_ACTIONS = {
  home_schedule: THERMOSTAT_PRESET.SCHEDULE,
  home_away: THERMOSTAT_PRESET.AWAY,
  home_frost: THERMOSTAT_PRESET.FROST,
};
const MODE_ICONS = {
  [THERMOSTAT_PRESET.SCHEDULE]: 'calendar',
  [THERMOSTAT_PRESET.AWAY]: 'log-out',
  [THERMOSTAT_PRESET.FROST]: 'shield',
};

export const TEXT = {
  notConfigured: {
    en: 'Enter your intuis Connect account in the integration configuration.',
    fr: 'Saisissez votre compte intuis Connect dans la configuration de l’intégration.',
    de: 'Gib dein intuis-Connect-Konto in der Konfiguration der Integration ein.',
    es: 'Introduzca su cuenta intuis Connect en la configuración de la integración.',
  },
  unreachable: {
    en: 'The intuis cloud does not answer: the rooms show again as soon as it does.',
    fr: 'Le cloud intuis ne répond pas : les pièces réapparaissent dès qu’il répond.',
    de: 'Die intuis-Cloud antwortet nicht: Die Räume erscheinen wieder, sobald sie antwortet.',
    es: 'La nube de intuis no responde: las habitaciones volverán en cuanto responda.',
  },
  schedule: { en: 'Schedule', fr: 'Programme', de: 'Zeitplan', es: 'Programación' },
  manual: { en: 'manual', fr: 'manuel', de: 'manuell', es: 'manual' },
  off: { en: 'off', fr: 'arrêt', de: 'aus', es: 'apagado' },
  away: { en: 'away', fr: 'absence', de: 'abwesend', es: 'ausencia' },
  frost: { en: 'frost', fr: 'hors-gel', de: 'Frostschutz', es: 'antihielo' },
  window: { en: 'window open', fr: 'fenêtre ouverte', de: 'Fenster offen', es: 'ventana abierta' },
  offline: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' },
};

const t = (table, language) => pick(table, language);

// The core cuts a status value past 40 characters, a caption past 80.
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "19.5" or "19,5" depending on the language. */
export function formatTemperature(value, language) {
  if (typeof value !== 'number') {
    return '–';
  }
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return language === 'en' ? text : text.replace('.', ',');
}

/** What a room is doing, in a few words: "manuel", "hors-gel"... or nothing. */
function roomMode(state, language) {
  if (state.mode === THERMOSTAT_MODE.HEATING) {
    return t(TEXT.manual, language);
  }
  if (state.mode === THERMOSTAT_MODE.OFF) {
    return t(TEXT.off, language);
  }
  if (state.preset === THERMOSTAT_PRESET.AWAY) {
    return t(TEXT.away, language);
  }
  if (state.preset === THERMOSTAT_PRESET.FROST) {
    return t(TEXT.frost, language);
  }
  return null;
}

/** One status row: "19,5 → 20 °C · manuel" (measured → setpoint). */
export function roomRow(room, state, language) {
  if (!state) {
    return { label: fit(room.name, 40), value: '–', color: WIDGET_COLORS.NEUTRAL };
  }
  const parts = [
    `${formatTemperature(state.temperature, language)} → ${formatTemperature(state.setpoint, language)} °C`,
  ];
  const mode = roomMode(state, language);
  if (mode) {
    parts.push(mode);
  }
  let color = WIDGET_COLORS.NEUTRAL;
  let icon = 'thermometer';
  if (state.reachable === false) {
    parts.push(t(TEXT.offline, language));
    color = WIDGET_COLORS.DANGER;
    icon = 'wifi-off';
  } else if (state.openWindow === true) {
    parts.push(t(TEXT.window, language));
    color = WIDGET_COLORS.INFO;
    icon = 'wind';
  } else if (state.heating === 1) {
    color = WIDGET_COLORS.WARNING;
  } else if (state.mode === THERMOSTAT_MODE.HEATING) {
    color = WIDGET_COLORS.PRIMARY;
  }
  return { label: fit(room.name, 40), value: fit(parts.join(' · '), 40), icon, color };
}

/**
 * The content of the widget for one home.
 * @param {object} home parsed home
 * @param {Map<string, object>} states room states by room id
 * @param {string} language
 */
export function buildRoomsContent(home, states, language) {
  const preset = homePreset(home);
  const schedule = activeSchedule(home);
  const caption = [home.name];
  if (preset !== null) {
    caption.push(t(PRESET_NAMES, language)[preset]);
  }
  if (schedule && preset === THERMOSTAT_PRESET.SCHEDULE) {
    caption.push(schedule.name);
  }
  const components = [{ type: 'text', variant: 'caption', text: fit(caption.join(' · '), 80) }];
  const items = home.rooms
    .slice(0, MAX_ROOMS)
    .map((room) => roomRow(room, states?.get(room.id), language));
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  for (const [key, value] of Object.entries(HOME_MODE_ACTIONS)) {
    components.push({
      type: 'button',
      label: t(PRESET_NAMES, language)[value],
      icon: preset === value ? ACTIVE_ICON : MODE_ICONS[value],
      action: { key },
    });
  }
  return { ttl_seconds: 300, components };
}

/** A one-sentence content (not configured, cloud unreachable). */
export function messageContent(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}
