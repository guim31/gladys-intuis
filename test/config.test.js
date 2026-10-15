import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  FALLBACK_MANUAL_MINUTES,
  isConfigured,
  manualMinutes,
  normalizeConfig,
} from '../src/config.js';

test('an empty config gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(isConfigured(normalizeConfig()), false);
});

test('values are normalized', () => {
  const config = normalizeConfig({
    username: '  me@example.com ',
    password: ' spaces kept ',
    manual_duration: 60,
    energy: 'false',
    language: 'de',
  });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' spaces kept ');
  assert.equal(config.manual_duration, '60');
  assert.equal(config.energy, false);
  assert.equal(config.language, 'de');
  assert.equal(isConfigured(config), true);
});

test('unknown values fall back to the defaults', () => {
  const config = normalizeConfig({ manual_duration: '17', language: 'it', username: 42 });
  assert.equal(config.manual_duration, 'default');
  assert.equal(config.language, 'fr');
  assert.equal(config.username, '');
});

test('the hold of a manual setpoint', () => {
  assert.equal(manualMinutes(normalizeConfig({ manual_duration: '240' }), 120), 240);
  assert.equal(manualMinutes(normalizeConfig(), 120), 120);
  assert.equal(manualMinutes(normalizeConfig(), null), FALLBACK_MANUAL_MINUTES);
  // Never longer than the 12 hours the app allows.
  assert.equal(manualMinutes(normalizeConfig(), 5000), 720);
});
