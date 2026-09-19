export const BRAND_NAME = 'تراصف';
export const BRAND_DISPLAY_NAME = 'تَـراصُـف';
export const BRAND_LATIN_NAME = 'TARASUF';
// The interface version is independent of saved accounting-engine evidence.
export const APP_VERSION = '0.4.8';

export const BRAND_COLORS = {
  navy: '#0A1B2E',
  blue: '#2D8CFF',
  purple: '#7C3AED',
} as const;

export const DISPLAY_HEADINGS = {
  heroLine1: { text: 'بين السجلات' },
  heroLine2: { text: 'نجد الوضوح' },
  upload: { text: 'ابدأ بملفي التسوية' },
  confirm: { text: 'راجع البيانات قبل المقارنة' },
  review: { text: 'راجع الفروق بين السجلين' },
  export: { text: 'ورقة العمل جاهزة للمراجعة' },
  process: { text: 'من الملفات إلى ورقة العمل' },
  privacy: { text: 'ملفاتك تبقى على جهازك' },
  cta: { text: 'ابدأ تسوية جديدة' },
} as const;

export type DisplayHeadingId = keyof typeof DISPLAY_HEADINGS;
