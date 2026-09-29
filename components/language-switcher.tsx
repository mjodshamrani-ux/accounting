import { useI18n } from '@/lib/i18n/context';
import { LANGUAGES, LANGUAGE_NAMES, type Lang } from '@/lib/i18n/language';

const SHORT: Record<Lang, string> = { ar: 'AR', en: 'EN' };

/** Compact AR | EN control. Each button names its language in that language,
 * so a screen reader announces it in the right voice; no flags, because a
 * language is not a country. Switching re-renders in place: nothing in the
 * session is reset. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="language-switch" role="group" aria-label={t.language.group}>
      {LANGUAGES.map((code, i) => (
        <span key={code} className="language-switch__item">
          {i > 0 && (
            <span className="language-switch__divider" aria-hidden="true">
              |
            </span>
          )}
          <button
            type="button"
            lang={code}
            aria-pressed={lang === code}
            onClick={() => lang !== code && setLang(code)}
          >
            {SHORT[code]}
            <span className="sr-only"> {LANGUAGE_NAMES[code]}</span>
          </button>
        </span>
      ))}
    </div>
  );
}
