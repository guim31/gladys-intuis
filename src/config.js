// -----------------------------------------------------------------------------
// Integration configuration, filled in by the user from the `config_schema` of
// gladys-assistant-integration.json. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals with
// `undefined` or with a number sent as a string.
// -----------------------------------------------------------------------------

// The languages of the Gladys interface: feature names and the texts produced
// by the container (a `device` integration does not receive the user's).
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// How long a setpoint written from Gladys holds, in minutes. `default` follows
// the duration set in the intuis app (read from the account), like a turn of
// the radiator's own dial. 12 hours is the longest hold the app offers.
export const MANUAL_DURATIONS = ['default', '30', '60', '120', '180', '240', '360', '480', '720'];
export const MAX_MANUAL_MINUTES = 720;
// When the account does not say: the intuis app's factory setting.
export const FALLBACK_MANUAL_MINUTES = 180;

// Defaults: they MUST match the `default` values of the manifest config_schema
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  manual_duration: 'default',
  energy: true,
  language: 'fr',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  const duration = String(raw.manual_duration ?? DEFAULT_CONFIG.manual_duration);
  return {
    username: typeof raw.username === 'string' ? raw.username.trim() : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    manual_duration: MANUAL_DURATIONS.includes(duration)
      ? duration
      : DEFAULT_CONFIG.manual_duration,
    // A checkbox may arrive as a string from an older form.
    energy:
      raw.energy === undefined ? DEFAULT_CONFIG.energy : ![false, 'false'].includes(raw.energy),
    language,
  };
}

/** Both credentials are needed to sign in. */
export function isConfigured(config) {
  return config.username !== '' && config.password !== '';
}

/**
 * Minutes a setpoint written from Gladys holds: the configured duration, or
 * the account's own default (`accountMinutes`, from the intuis app).
 */
export function manualMinutes(config, accountMinutes) {
  if (config.manual_duration !== 'default') {
    return Number(config.manual_duration);
  }
  const minutes = Number(accountMinutes);
  return Number.isFinite(minutes) && minutes > 0
    ? Math.min(minutes, MAX_MANUAL_MINUTES)
    : FALLBACK_MANUAL_MINUTES;
}
