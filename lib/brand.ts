export const BRAND_NAME = 'تراصف';
export const BRAND_DISPLAY_NAME = 'تَـراصُـف';
export const BRAND_LATIN_NAME = 'TARASUF';
// The interface version is independent of saved accounting-engine evidence.
export const APP_VERSION = '0.4.3';

export const BRAND_COLORS = {
  navy: '#0A1B2E',
  blue: '#2D8CFF',
  purple: '#7C3AED',
} as const;

export const DISPLAY_HEADINGS = {
  heroLine1: { text: 'بين السجلات،' },
  heroLine2: { text: 'نجد الوضوح.' },
  upload: { text: 'ملفّان. صورة أوضح.' },
  confirm: { text: 'راجع الملخص، ثم قارن.' },
  review: { text: 'الفروق أمامك. القرار لك.' },
  export: { text: 'ورقة عمل تحكي التفاصيل.' },
  process: { text: 'وضوح، خطوة بخطوة.' },
  privacy: { text: 'ملفّاتك تبقى لديك.' },
  cta: { text: 'لكلّ فرق، بداية فهم.' },
} as const;

export type DisplayHeadingId = keyof typeof DISPLAY_HEADINGS;
