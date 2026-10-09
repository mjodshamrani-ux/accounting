import { useId, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  CreditCard,
  GitCompareArrows,
  Handshake,
  Landmark,
  LayoutGrid,
  NotebookTabs,
  Package,
  ShieldCheck,
  Split,
  Truck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { ForwardArrow } from '@/components/direction';
import { useI18n } from '@/lib/i18n/context';
import {
  reconciliationDirectoryCopy,
  type ReconciliationDomain,
} from '@/lib/i18n/reconciliation-directory';
import './reconciliation-directory.css';

const groups = [
  {
    id: 'relationships',
    icon: Handshake,
    domains: ['supplier', 'ar', 'intercompany'],
  },
  {
    id: 'money',
    icon: WalletCards,
    domains: ['bank', 'clearing', 'allocation', 'gateway'],
  },
  { id: 'books', icon: BookOpen, domains: ['gl-tb', 'tb-financial'] },
  {
    id: 'operations',
    icon: Building2,
    domains: ['stock', 'assets', 'payroll'],
  },
] as const;
const icons = {
  supplier: Truck,
  ar: UsersRound,
  intercompany: Building2,
  bank: Landmark,
  clearing: ArrowLeftRight,
  allocation: Split,
  gateway: CreditCard,
  'gl-tb': NotebookTabs,
  'tb-financial': GitCompareArrows,
  stock: Package,
  assets: Building2,
  payroll: BriefcaseBusiness,
};

export function ReconciliationDirectory({
  entries,
  disabled,
  onSelect,
  compact = false,
}: {
  entries: { id: ReconciliationDomain; title: string }[];
  disabled: boolean;
  onSelect: (domain: ReconciliationDomain) => void;
  compact?: boolean;
}) {
  const { lang, dir } = useI18n();
  const copy = reconciliationDirectoryCopy[lang];
  const [expanded, setExpanded] = useState(false);
  const uid = useId();
  const open = !compact || expanded;
  return (
    <section
      id="reconciliation-types"
      className={`reconciliation-directory${compact ? ' is-compact' : ''}`}
      tabIndex={-1}
      aria-labelledby={
        compact ? `${uid}-current` : 'reconciliation-types-title'
      }
      dir={dir}
    >
      {compact && (
        <div className="directory-session-bar">
          <span className="directory-session-icon" aria-hidden="true">
            <Truck size={20} />
          </span>
          <div>
            <span className="directory-session-label">{copy.current}</span>
            <strong id={`${uid}-current`}>{copy.supplierTitle}</strong>
          </div>
          <button
            type="button"
            className="directory-switch"
            aria-expanded={expanded}
            aria-controls={`${uid}-contents`}
            onClick={() => setExpanded(!expanded)}
          >
            <LayoutGrid size={16} aria-hidden="true" />
            {expanded ? copy.close : copy.switch}
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <div id={`${uid}-contents`} hidden={!open} className="directory-contents">
        <div className="directory-heading">
          <div>
            <span className="directory-eyebrow">
              <span aria-hidden="true" />
              {copy.eyebrow}
            </span>
            <h2 id="reconciliation-types-title">{copy.title}</h2>
            <p className="reconciliation-directory-intro">{copy.intro}</p>
          </div>
          <div className="directory-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>{copy.localNote}</span>
          </div>
        </div>
        {disabled && (
          <output className="directory-waiting">{copy.waiting}</output>
        )}
        <nav
          data-domain-navigation
          aria-label={copy.title}
          className="reconciliation-directory-grid"
        >
          {groups.map(({ id: groupId, icon: GroupIcon, domains }) => (
            <section
              className={`directory-group directory-group--${groupId}`}
              key={groupId}
              aria-labelledby={`${uid}-${groupId}`}
            >
              <header className="directory-group-heading">
                <span className="directory-group-icon" aria-hidden="true">
                  <GroupIcon size={23} strokeWidth={1.6} />
                </span>
                <div>
                  <h3 id={`${uid}-${groupId}`}>{copy.groups[groupId][0]}</h3>
                  <p>{copy.groups[groupId][1]}</p>
                </div>
              </header>
              <div className="directory-group-choices">
                {domains.map((id) => {
                  const entry = entries.find(
                    (candidate) => candidate.id === id,
                  );
                  if (!entry) return null;
                  const Icon = icons[id];
                  return (
                    <article
                      key={id}
                      className={`reconciliation-choice${id === 'supplier' ? ' is-supplier' : ''}`}
                    >
                      <button
                        type="button"
                        data-domain-entry={id}
                        aria-label={entry.title}
                        aria-describedby={`${uid}-${id}-summary`}
                        disabled={disabled}
                        onClick={() => {
                          if (id === 'supplier') setExpanded(false);
                          onSelect(id);
                        }}
                      >
                        <span
                          className="directory-choice-icon"
                          aria-hidden="true"
                        >
                          <Icon size={19} strokeWidth={1.65} />
                        </span>
                        <span className="directory-choice-copy">
                          <span className="directory-choice-title">
                            {entry.title}
                          </span>
                          <span
                            id={`${uid}-${id}-summary`}
                            className="directory-choice-description"
                          >
                            {copy[id][0]}
                          </span>
                        </span>
                        <ForwardArrow
                          className="directory-choice-arrow"
                          size={18}
                          aria-hidden="true"
                        />
                      </button>
                      <details className="directory-choice-details">
                        <summary>
                          {copy.limits}
                          <ChevronDown size={12} aria-hidden="true" />
                        </summary>
                        <p className="reconciliation-choice-limit">
                          {copy[id][1]}
                        </p>
                      </details>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        <p className="reconciliation-directory-boundary">{copy.boundary}</p>
      </div>
    </section>
  );
}
