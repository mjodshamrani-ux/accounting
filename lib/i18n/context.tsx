import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ar } from './locales/ar';
import { en } from './locales/en';
import type { Messages } from './messages';
import {
  applyDocumentLanguage,
  directionOf,
  storedLanguage,
  storeLanguage,
  type Lang,
} from './language';
import { localizeEngineText } from './engine';
import { renderText, type UiText } from './text';

const catalogs: Record<Lang, Messages> = { ar, en };

type I18n = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  /** Typed interface copy for the current language. */
  t: Messages;
  /** Renders a message the accounting engine produced. The engine speaks
   * Arabic; this presents the same message in the current language. */
  engineText: (text: string) => string;
  /** Renders a message held in state, in the current language. */
  say: (text: UiText) => string;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<I18n | null>(null);

/** Owns only the language. Changing it re-renders the application in place, so
 * files, mappings, results and review decisions held below are untouched. */
export function LanguageProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? storedLanguage());
  const t = catalogs[lang];
  useLayoutEffect(() => {
    applyDocumentLanguage(lang, t.document.title);
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute('content', t.document.description);
  }, [lang, t]);
  const setLang = useCallback((next: Lang) => {
    storeLanguage(next);
    setLangState(next);
  }, []);
  const engineText = useCallback(
    (text: string) => localizeEngineText(text, lang),
    [lang],
  );
  const say = useCallback(
    (text: UiText) => renderText(text, t, engineText),
    [t, engineText],
  );
  const value = useMemo(
    () => ({ lang, dir: directionOf(lang), t, engineText, say, setLang }),
    [lang, t, engineText, say, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside LanguageProvider');
  return value;
}
