// Theme presets. Four families grounded in color psychology, each with a
// dark and a light variant. Every variant defines the full token set from
// main.css :root — applying a theme is pure token swapping.
//
// The palettes keep the structure the default theme established: a 3-step
// background elevation ladder (page → card → nested card), an accent
// triplet (base / bright / deep), and a 3-step text ramp. All text/bg
// pairs are tuned to WCAG AA contrast (checked in test/themes.test.js).

export const FAMILIES = [
  { id: 'ember', name: 'Ember', blurb: 'Warmth with focus — the original' },
  { id: 'focus', name: 'Deep Focus', blurb: 'Blues that support sustained attention' },
  { id: 'calm', name: 'Calm', blurb: 'Restorative greens, easy on the eyes' },
  { id: 'energy', name: 'Energy', blurb: 'Warm tones that lift alertness' },
];

export const THEMES = [
  {
    id: 'ember', family: 'ember', name: 'Midnight Ember', dark: true,
    tokens: {
      bg: '#1b2026', bgElev: '#242b33', bgElev2: '#2e3742',
      text: '#e8eaed', textDim: '#97a3b0', textFaint: '#64707d',
      accent: '#a63446', accentBright: '#c4576a', accentDeep: '#7c2434',
      accentSoft: 'rgba(166, 52, 70, 0.18)',
      good: '#3ecf8e', warn: '#f39c12', danger: '#ff6b5e',
      border: 'rgba(255, 255, 255, 0.07)', treeLine: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.35)', accentShadow: 'rgba(166, 52, 70, 0.45)',
    },
  },
  {
    id: 'wine', family: 'ember', name: 'Charcoal Wine', dark: true,
    tokens: {
      bg: '#171419', bgElev: '#211d25', bgElev2: '#2c2731',
      text: '#ece8ef', textDim: '#a49cae', textFaint: '#6f6779',
      accent: '#94405f', accentBright: '#b76282', accentDeep: '#6a2a43',
      accentSoft: 'rgba(148, 64, 95, 0.20)',
      good: '#3ecf8e', warn: '#f39c12', danger: '#ff6b5e',
      border: 'rgba(255, 255, 255, 0.07)', treeLine: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.4)', accentShadow: 'rgba(148, 64, 95, 0.45)',
    },
  },
  {
    id: 'cobalt', family: 'focus', name: 'Night Cobalt', dark: true,
    tokens: {
      bg: '#101722', bgElev: '#18222f', bgElev2: '#212e3f',
      text: '#e6ecf4', textDim: '#8fa2b8', textFaint: '#5d7086',
      accent: '#3d72ad', accentBright: '#6296cd', accentDeep: '#2a527e',
      accentSoft: 'rgba(61, 114, 173, 0.20)',
      good: '#3ecf8e', warn: '#f39c12', danger: '#ff6b5e',
      border: 'rgba(255, 255, 255, 0.07)', treeLine: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.4)', accentShadow: 'rgba(61, 114, 173, 0.45)',
    },
  },
  {
    id: 'paper', family: 'focus', name: 'Paper & Ink', dark: false,
    tokens: {
      bg: '#eef0f3', bgElev: '#ffffff', bgElev2: '#f2f5f8',
      text: '#1f2933', textDim: '#52616f', textFaint: '#7c8896',
      accent: '#33557e', accentBright: '#466992', accentDeep: '#24405e',
      accentSoft: 'rgba(51, 85, 126, 0.14)',
      good: '#17835a', warn: '#a06508', danger: '#c23f33',
      border: 'rgba(16, 32, 48, 0.12)', treeLine: 'rgba(16, 32, 48, 0.20)',
      shadow: '0 8px 24px rgba(30, 40, 60, 0.12)', accentShadow: 'rgba(51, 85, 126, 0.35)',
    },
  },
  {
    id: 'forest', family: 'calm', name: 'Still Forest', dark: true,
    tokens: {
      bg: '#151b17', bgElev: '#1d2620', bgElev2: '#27332b',
      text: '#e7ece8', textDim: '#95a89a', textFaint: '#617568',
      accent: '#4e8465', accentBright: '#6faa89', accentDeep: '#375f49',
      accentSoft: 'rgba(78, 132, 101, 0.20)',
      good: '#3ecf8e', warn: '#f39c12', danger: '#ff6b5e',
      border: 'rgba(255, 255, 255, 0.07)', treeLine: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.4)', accentShadow: 'rgba(78, 132, 101, 0.45)',
    },
  },
  {
    id: 'eucalyptus', family: 'calm', name: 'Eucalyptus', dark: false,
    tokens: {
      bg: '#edf2ee', bgElev: '#ffffff', bgElev2: '#f2f7f3',
      text: '#233029', textDim: '#54675c', textFaint: '#7e8f84',
      accent: '#3d7a5c', accentBright: '#548f70', accentDeep: '#2b5741',
      accentSoft: 'rgba(61, 122, 92, 0.14)',
      good: '#17835a', warn: '#a06508', danger: '#c23f33',
      border: 'rgba(25, 50, 38, 0.12)', treeLine: 'rgba(25, 50, 38, 0.20)',
      shadow: '0 8px 24px rgba(30, 55, 42, 0.12)', accentShadow: 'rgba(61, 122, 92, 0.35)',
    },
  },
  {
    id: 'coral', family: 'energy', name: 'Coral Drive', dark: true,
    tokens: {
      bg: '#1c1613', bgElev: '#27201b', bgElev2: '#332a23',
      text: '#efe9e3', textDim: '#ab9d8f', textFaint: '#786c5f',
      accent: '#c25a38', accentBright: '#e07e5b', accentDeep: '#8d3f25',
      accentSoft: 'rgba(194, 90, 56, 0.20)',
      good: '#3ecf8e', warn: '#f0b429', danger: '#ff6b5e',
      border: 'rgba(255, 255, 255, 0.07)', treeLine: 'rgba(255, 255, 255, 0.16)',
      shadow: '0 8px 24px rgba(0, 0, 0, 0.4)', accentShadow: 'rgba(194, 90, 56, 0.45)',
    },
  },
  {
    id: 'sunrise', family: 'energy', name: 'Sunrise', dark: false,
    tokens: {
      bg: '#f6f0e6', bgElev: '#fffdf8', bgElev2: '#f7f1e7',
      text: '#33291d', textDim: '#6b5d49', textFaint: '#93866f',
      accent: '#b35317', accentBright: '#cd6e33', accentDeep: '#833c0f',
      accentSoft: 'rgba(179, 83, 23, 0.14)',
      good: '#17835a', warn: '#a06508', danger: '#c23f33',
      border: 'rgba(80, 60, 30, 0.14)', treeLine: 'rgba(80, 60, 30, 0.22)',
      shadow: '0 8px 24px rgba(90, 65, 30, 0.12)', accentShadow: 'rgba(179, 83, 23, 0.35)',
    },
  },
];

export const DEFAULT_THEME = 'ember';

// token key → CSS custom property
const VAR_OF = {
  bg: '--bg', bgElev: '--bg-elev', bgElev2: '--bg-elev-2',
  text: '--text', textDim: '--text-dim', textFaint: '--text-faint',
  accent: '--accent', accentBright: '--accent-bright', accentDeep: '--accent-deep',
  accentSoft: '--accent-soft',
  good: '--good', warn: '--warn', danger: '--danger',
  border: '--border', treeLine: '--tree-line',
  shadow: '--shadow', accentShadow: '--accent-shadow',
};

export function getTheme(id) {
  return THEMES.find(t => t.id === id) || THEMES.find(t => t.id === DEFAULT_THEME);
}

export function applyTheme(id) {
  const theme = getTheme(id);
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(VAR_OF)) {
    root.style.setProperty(cssVar, theme.tokens[key]);
  }
  // native form controls / scrollbars follow the scheme
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  // Android status bar / iOS PWA chrome matches the page
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.bg);
  return theme;
}
