// The wordmark is Arabic in every interface language: it is the brand's identity,
// not interface copy. Its accessible name comes from the catalogue (brand.name).
export const BRAND_DISPLAY_NAME = 'تَـراصُـف';
export const BRAND_LATIN_NAME = 'TARASUF';
// The interface version is independent of saved accounting-engine evidence.
export const APP_VERSION = '0.4.7';

export const BRAND_COLORS = {
  navy: '#0A1B2E',
  blue: '#2D8CFF',
  purple: '#7C3AED',
} as const;

// Display heading text lives in the interface catalogues (lib/i18n/locales),
// under brand.headings; these are the ids.
export const DISPLAY_HEADING_IDS = [
  'heroLine1',
  'heroLine2',
  'upload',
  'confirm',
  'review',
  'export',
  'process',
  'privacy',
  'cta',
] as const;
export type DisplayHeadingId = (typeof DISPLAY_HEADING_IDS)[number];
