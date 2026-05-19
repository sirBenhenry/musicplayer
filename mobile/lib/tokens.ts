export const light = {
  bg: '#f4ede2',
  bgElev: '#faf4ea',
  surface: '#fffdf8',
  surfaceHover: '#f8f1e5',
  fg: '#1f1a14',
  fgStrong: '#14110d',
  fgMuted: '#6e655a',
  fgSoft: '#9e9489',
  fgFaint: '#c3b9ac',
  border: '#e6dccb',
  borderSoft: '#efe6d5',
  borderStrong: '#d4c8b3',
  accent: '#b8553a',
  accentHover: '#a64a31',
  accentSoft: '#d4886d',
  accentTint: '#f0d6c7',
  accentBg: '#f6e4d7',
  onAccent: '#fff8f2',
} as const;

export const dark = {
  bg: '#181512',
  bgElev: '#1f1b17',
  surface: '#25201b',
  surfaceHover: '#2c2620',
  fg: '#ede5d8',
  fgStrong: '#f8f1e4',
  fgMuted: '#a39685',
  fgSoft: '#756a5d',
  fgFaint: '#4a4239',
  border: '#2e2822',
  borderSoft: '#261f1a',
  borderStrong: '#3d352c',
  accent: '#d97757',
  accentHover: '#e1876b',
  accentSoft: '#b6593c',
  accentTint: '#3d281f',
  accentBg: '#2e1f17',
  onAccent: '#1a0f08',
} as const;

export const sageLightOverride = {
  accent: '#5e7155',
  accentHover: '#4e6346',
  accentSoft: '#88997d',
  accentTint: '#d5dcce',
  accentBg: '#e3e8d9',
  onAccent: '#f7faf2',
} as const;

export const sageDarkOverride = {
  accent: '#9fb18f',
  accentHover: '#afc09e',
  accentSoft: '#748567',
  accentTint: '#2d3528',
  accentBg: '#232a1f',
  onAccent: '#0f1208',
} as const;

export type Theme = typeof light;

export const radius = {
  cover: 10,
  card: 14,
  petal: 18,
  pill: 100,
  sheet: 20,
} as const;

export const font = {
  ui: 'Geist',
  display: 'InstrumentSerif',
  mono: 'GeistMono',
} as const;

export function getTheme(isDark: boolean, isSage: boolean): Theme {
  const base = isDark ? dark : light;
  const override = isSage ? (isDark ? sageDarkOverride : sageLightOverride) : {};
  return { ...base, ...override };
}
