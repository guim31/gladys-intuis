// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the four documentation files, which share the
// same sections. German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { NAMES } from '../src/devices.js';
import { MESSAGES, PRESET_NAMES, STATUS } from '../src/i18n.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      // The store schema caps the catalog and widget descriptions, and widget labels.
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, max));
    }
  }
  return found;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const language = manifest.config_schema.find((field) => field.key === 'language');
  assert.equal(language.default, 'fr');
});

test('the integration name is the same in every language (a plain string)', () => {
  assert.equal(typeof manifest.name, 'string');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 40, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the catalog description holds 10 characters at least in every language', () => {
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the statuses, messages and widget texts have the four languages', () => {
  const render = (value) => (typeof value === 'function' ? value(1, 4) : value);
  const found = [
    ...Object.entries(STATUS).flatMap(([key, value]) =>
      problems(value, `STATUS.${key}`, MAX.message),
    ),
    ...Object.entries(MESSAGES).flatMap(([key, value]) =>
      problems(
        Object.fromEntries(Object.entries(value).map(([lang, text]) => [lang, render(text)])),
        `MESSAGES.${key}`,
        MAX.message,
      ),
    ),
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `TEXT.${key}`,
        ['notConfigured', 'unreachable'].includes(key) ? MAX.message : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names and preset names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
  assert.deepEqual(tableProblems(PRESET_NAMES, 'PRESET_NAMES', MAX.short), []);
});

/** The `##` and `###` headings of a documentation file. */
async function headings(lang) {
  const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
  return { text, headings: text.split('\n').filter((line) => /^#{2,3} /.test(line)) };
}

test('the four documentation files have the same sections', async () => {
  const reference = await headings('en');
  assert.ok(reference.headings.length >= 10);
  for (const lang of ['fr', 'de', 'es']) {
    const doc = await headings(lang);
    assert.deepEqual(
      doc.headings.map((line) => line.match(/^#+/)[0]),
      reference.headings.map((line) => line.match(/^#+/)[0]),
      `docs/${lang}.md does not have the sections of docs/en.md`,
    );
    assert.ok(doc.text.length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('the documentation says it was developed without the hardware', async () => {
  for (const [lang, pattern] of [
    ['en', /without the hardware/i],
    ['fr', /sans le matériel/i],
    ['de', /ohne die Hardware/i],
    ['es', /sin el hardware/i],
  ]) {
    const { text } = await headings(lang);
    assert.match(text, pattern, lang);
  }
});

test('the German documentation says "du"', async () => {
  const { text } = await headings('de');
  const polite = text.split('\n').filter((line) => POLITE_GERMAN.test(line));
  assert.deepEqual(polite, []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Room', fr: 'Pièce', de: 'Raum' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Room', fr: 'Pièce', de: '', es: 'Sala' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Konto', 'Ihre E-Mail', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[1].placeholder.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[1].placeholder has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
