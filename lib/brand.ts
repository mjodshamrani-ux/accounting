export const BRAND_NAME = 'تراصف';
export const BRAND_DISPLAY_NAME = 'تَـراصُـف';
export const BRAND_LATIN_NAME = 'TARASUF';
// The interface version is independent of saved accounting-engine evidence.
export const APP_VERSION = '0.4.0';

export const BRAND_COLORS = {
  navy: '#0A1B2E',
  blue: '#2D8CFF',
  purple: '#7C3AED',
} as const;

export const DISPLAY_HEADINGS = {
  heroLine1: {
    text: 'بـيـن السـجـلّات،',
    label: 'بين السجلات،',
    width: 6082,
    height: 1286,
  },
  heroLine2: {
    text: 'نـجـد الـوضـوح.',
    label: 'نجد الوضوح.',
    width: 5573,
    height: 1115,
  },
  upload: {
    text: 'مـلـفّـان. صـورة أوضـح.',
    label: 'ملفان. صورة أوضح.',
    width: 8521.7444,
    height: 1365,
  },
  confirm: {
    text: 'راجـع المـلـخـص، ثـم قـارن.',
    label: 'راجع الملخص، ثم قارن.',
    width: 9933,
    height: 1246,
  },
  review: {
    text: 'الفـروق أمـامـك. الـقـرار لـك.',
    label: 'الفروق أمامك. القرار لك.',
    width: 10687,
    height: 1245,
  },
  export: {
    text: 'ورقـة عـمـل تـحـكـي التـفـاصـيـل.',
    label: 'ورقة عمل تحكي التفاصيل.',
    width: 12070,
    height: 1391,
  },
  process: {
    text: 'وضـوح، خـطـوة بـخـطـوة.',
    label: 'وضوح، خطوة بخطوة.',
    width: 8547,
    height: 1115,
  },
  privacy: {
    text: 'مـلـفّـاتـك تـبـقـى لـديـك.',
    label: 'ملفاتك تبقى لديك.',
    width: 9167.7444,
    height: 1297,
  },
  cta: {
    text: 'لـكـلّ فـرق، بـدايـة فـهـم.',
    label: 'لكل فرق، بداية فهم.',
    width: 9159,
    height: 1318,
  },
} as const;

export type DisplayHeadingId = keyof typeof DISPLAY_HEADINGS;
