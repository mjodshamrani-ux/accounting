// Interface language is a viewing preference. It never enters accounting
// state, saved sessions, templates or exported workpapers.
export const LANGUAGES = ['ar', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const DEFAULT_LANG: Lang = 'ar';
/** Each language named in itself, as a language menu conventionally shows it.
 * These do not change with the interface language. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  ar: 'العربية',
  en: 'English',
};
export const directionOf = (lang: Lang): 'rtl' | 'ltr' =>
  lang === 'ar' ? 'rtl' : 'ltr';

const STORAGE_KEY = 'tarasuf.lang';
const isLang = (value: unknown): value is Lang =>
  LANGUAGES.includes(value as Lang);

/** Storage may be unavailable (private mode, blocked site data). The interface
 * must still work, in Arabic, when it is. */
export function storedLanguage(): Lang {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLang(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}
export function storeLanguage(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* The preference simply is not remembered. */
  }
}

/** Applied before first render and on every switch, so the document never
 * shows one direction with the other language's text. */
export function applyDocumentLanguage(lang: Lang, title?: string): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = directionOf(lang);
  if (title) document.title = title;
}
