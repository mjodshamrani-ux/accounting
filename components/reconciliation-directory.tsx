import { Button } from '@/components/ui/button';
import { ForwardArrow } from '@/components/direction';
import { useI18n } from '@/lib/i18n/context';
import { reconciliationDirectoryCopy, type ReconciliationDomain } from '@/lib/i18n/reconciliation-directory';

export function ReconciliationDirectory({ entries, disabled, onSelect }: {
  entries: { id: ReconciliationDomain; title: string }[];
  disabled: boolean;
  onSelect: (domain: ReconciliationDomain) => void;
}) {
  const { lang, dir } = useI18n();
  const copy = reconciliationDirectoryCopy[lang];
  return (
    <section id="reconciliation-types" className="reconciliation-directory" tabIndex={-1} aria-labelledby="reconciliation-types-title" dir={dir}>
      <h2 id="reconciliation-types-title">{copy.title}</h2>
      <p className="reconciliation-directory-intro">{copy.intro}</p>
      <p className="reconciliation-directory-boundary">{copy.boundary}</p>
      {disabled && <output>{copy.waiting}</output>}
      <nav data-domain-navigation aria-label={copy.title} className="reconciliation-directory-grid">
        {entries.map(({ id, title }) => (
          <article key={id} className="reconciliation-choice">
            <Button data-domain-entry={id} variant="outline" disabled={disabled} onClick={() => onSelect(id)}>
              <span>{title}</span><ForwardArrow size={17} aria-hidden="true" />
            </Button>
            <p>{copy[id][0]}</p>
            <p className="reconciliation-choice-limit">{copy[id][1]}</p>
          </article>
        ))}
      </nav>
    </section>
  );
}
