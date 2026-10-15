// -----------------------------------------------------------------------------
// The `rooms` dashboard widget: content within the core budget, the rows,
// the home mode buttons and their action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { formatTemperature, roomRow } from '../src/widgets.js';
import { createWorld, deviceNamed } from './helpers/world.js';

const NOW = Date.UTC(2026, 0, 10, 8, 0, 0);

test('the content: the home, every room, three mode buttons, within the budget', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await world.gladys.fake.widgetGet('rooms', { language });
      assert.equal(ack.success, true);
      const { content } = ack.data;
      assert.deepEqual(validateWidgetContent(content), [], language);
      const types = content.components.map((component) => component.type);
      assert.deepEqual(types, ['text', 'status', 'button', 'button', 'button']);
    }
    const { content } = (await world.gladys.fake.widgetGet('rooms', { language: 'fr' })).data;
    assert.equal(content.components[0].text, 'Mon domicile · Planning · Semaine type');
    const rows = content.components[1].items;
    assert.deepEqual(
      rows.map((row) => [row.label, row.value]),
      [
        ['Salon', '19,5 → 20 °C'],
        ['Chambre parentale', '18,1 → 21 °C · manuel · fenêtre ouverte'],
        ['Salle de bain', '21,2 → 7 °C · hors-gel'],
        ['Bureau', '17 → 16 °C · absence · hors ligne'],
      ],
    );
    // The active mode is marked by its icon, not by the style (dark mode).
    const buttons = content.components.slice(2);
    assert.deepEqual(
      buttons.map((button) => [button.label, button.icon, button.style]),
      [
        ['Planning', 'check-circle', undefined],
        ['Absence', 'log-out', undefined],
        ['Hors-gel', 'shield', undefined],
      ],
    );
  } finally {
    await world.app.stop();
  }
});

test('a button sets the home mode and the widget shows it', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    const ack = await world.gladys.fake.widgetAction('rooms', 'home_away');
    assert.equal(ack.success, true);
    assert.equal(ack.data.message, 'Mode de la maison : Absence.');
    const write = world.intuis.requests.find((request) => request.path === '/api/setthermmode');
    assert.equal(write.body.mode, 'away');
    const { content } = (await world.gladys.fake.widgetGet('rooms', { language: 'en' })).data;
    const away = content.components.find((component) => component.label === 'Away');
    assert.equal(away.icon, 'check-circle');
    // Rooms following the home now read "away".
    assert.match(content.components[1].items[0].value, /away/);
  } finally {
    await world.app.stop();
  }
});

test('the home setting accepts the home device or one of its rooms', async () => {
  const world = await createWorld({ now: () => NOW });
  try {
    const room = deviceNamed(world, 'Bureau').external_id;
    const ack = await world.gladys.fake.widgetGet('rooms', {
      settings: { home: room },
      language: 'en',
    });
    assert.match(ack.data.content.components[0].text, /^Mon domicile/);
  } finally {
    await world.app.stop();
  }
});

test('not configured, or cloud unreachable: one sentence', async () => {
  const empty = await createWorld({ config: {} });
  try {
    const { content } = (await empty.gladys.fake.widgetGet('rooms', { language: 'de' })).data;
    assert.deepEqual(validateWidgetContent(content), []);
    assert.match(content.components[0].text, /intuis-Connect-Konto/);
  } finally {
    await empty.app.stop();
  }

  const down = await createWorld({ cloudOptions: {} });
  try {
    down.intuis.failure = 'network';
    down.hub.homes = [];
    const { content } = (await down.gladys.fake.widgetGet('rooms', { language: 'es' })).data;
    assert.match(content.components[0].text, /nube de intuis no responde/);
  } finally {
    await down.app.stop();
  }
});

test('rows stay within 40 characters', () => {
  const row = roomRow(
    { name: 'Une pièce au nom vraiment très très long pour un widget' },
    { temperature: 19.25, setpoint: 20.5, mode: 1, preset: 0, openWindow: true, reachable: true },
    'fr',
  );
  assert.ok(row.label.length <= 40);
  assert.ok(row.value.length <= 40, row.value);
  assert.equal(formatTemperature(19.25, 'en'), '19.3');
  assert.equal(formatTemperature(19.25, 'fr'), '19,3');
  assert.equal(formatTemperature(null, 'fr'), '–');
});
