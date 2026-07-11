import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, FAMILIES, DEFAULT_THEME, getTheme } from '../www/js/themes.js';

const TOKEN_KEYS = [
  'bg', 'bgElev', 'bgElev2', 'text', 'textDim', 'textFaint',
  'accent', 'accentBright', 'accentDeep', 'accentSoft',
  'good', 'warn', 'danger', 'border', 'treeLine', 'shadow', 'accentShadow',
];

test('every theme defines the full token set', () => {
  for (const t of THEMES) {
    for (const key of TOKEN_KEYS) {
      assert.ok(t.tokens[key], `${t.id} is missing token ${key}`);
    }
  }
});

test('theme ids are unique and families exist', () => {
  const ids = THEMES.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const famIds = new Set(FAMILIES.map(f => f.id));
  for (const t of THEMES) assert.ok(famIds.has(t.family), `${t.id} has unknown family ${t.family}`);
});

test('every family has at least one variant', () => {
  for (const f of FAMILIES) {
    assert.ok(THEMES.some(t => t.family === f.id), `family ${f.id} has no variants`);
  }
});

test('default theme exists and getTheme falls back to it', () => {
  assert.ok(THEMES.some(t => t.id === DEFAULT_THEME));
  assert.equal(getTheme('nope').id, DEFAULT_THEME);
  assert.equal(getTheme('forest').id, 'forest');
});

// WCAG AA-ish guardrails so a future palette tweak can't ship unreadable text
function luminance(hex) {
  const c = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('body and dimmed text stay readable on every surface', () => {
  for (const t of THEMES) {
    const k = t.tokens;
    for (const bg of [k.bg, k.bgElev, k.bgElev2]) {
      assert.ok(contrast(k.text, bg) >= 4.5, `${t.id}: text on ${bg} below AA`);
    }
    assert.ok(contrast(k.textDim, k.bgElev) >= 4.5, `${t.id}: dim text below AA`);
    assert.ok(contrast('#ffffff', k.accent) >= 3.0, `${t.id}: check mark on accent below 3:1`);
  }
});
