import { useId, type MouseEvent } from 'react';
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
  NotebookTabs,
  Package,
  ShieldCheck,
  Split,
  Truck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import {
  reconciliationDirectoryCopy,
  type ReconciliationDomain,
} from '@/lib/i18n/reconciliation-directory';
import './reconciliation-directory.css';

let directoryAlignmentFrame: number | undefined;
let directoryAlignmentGeneration = 0;

export function navigateToReconciliationDirectory(
  event: MouseEvent<HTMLAnchorElement>,
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.currentTarget.hasAttribute('download') ||
    (event.currentTarget.target &&
      event.currentTarget.target.toLowerCase() !== '_self')
  )
    return;
  const target = document.getElementById('reconciliation-types');
  if (!target) return;
  event.preventDefault();
  const generation = ++directoryAlignmentGeneration;
  if (directoryAlignmentFrame !== undefined)
    window.cancelAnimationFrame(directoryAlignmentFrame);
  const oldURL = window.location.href;
  const changed = window.location.hash !== '#reconciliation-types';
  if (changed)
    window.history.pushState(window.history.state, '', '#reconciliation-types');
  // Native fragment focus can override an ongoing smooth scroll on this tall
  // section. Align once after focus, cancelling the previous motion.
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  if (changed)
    window.dispatchEvent(
      new HashChangeEvent('hashchange', {
        oldURL,
        newURL: window.location.href,
      }),
    );
  // Link-focus motion can reach the compositor after the synchronous alignment.
  // Give it two frames, then align once if this activation still owns focus.
  directoryAlignmentFrame = window.requestAnimationFrame(() => {
    if (generation !== directoryAlignmentGeneration) return;
    directoryAlignmentFrame = window.requestAnimationFrame(() => {
      if (generation !== directoryAlignmentGeneration) return;
      directoryAlignmentFrame = undefined;
      if (
        target.isConnected &&
        window.location.hash === '#reconciliation-types' &&
        document.activeElement === target
      )
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  });
}

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
  activeDomain = 'supplier',
}: {
  entries: { id: ReconciliationDomain; title: string }[];
  disabled: boolean;
  onSelect: (domain: ReconciliationDomain) => void;
  activeDomain?: ReconciliationDomain;
  compact?: boolean;
}) {
  const { lang, dir } = useI18n();
  const copy = reconciliationDirectoryCopy[lang];
  const uid = useId();
  const current = entries.find((entry) => entry.id === activeDomain);
  const Icon = icons[activeDomain];
  return (
    <section
      id="reconciliation-types"
      className="reconciliation-directory is-compact"
      tabIndex={-1}
      aria-labelledby={`${uid}-label`}
      data-domain-navigation
      dir={dir}
    >
      <div className="directory-picker">
        <span className="directory-session-icon" aria-hidden="true">
          <Icon size={22} strokeWidth={1.6} />
        </span>
        <div className="directory-picker-field">
          <label id={`${uid}-label`} htmlFor={`${uid}-select`}>
            {copy.title}
          </label>
          <div className="directory-select-control">
            <select
              id={`${uid}-select`}
              data-reconciliation-type-select
              aria-label={copy.title}
              value={activeDomain}
              disabled={disabled}
              onChange={(event) => {
                const selected = entries.find(
                  (entry) => entry.id === event.target.value,
                );
                if (selected && selected.id !== activeDomain && !disabled)
                  onSelect(selected.id);
              }}
            >
              {groups.map(({ id, domains }) => (
                <optgroup key={id} label={copy.groups[id][0]}>
                  {domains.map((domain) => {
                    const entry = entries.find(
                      (candidate) => candidate.id === domain,
                    );
                    return entry ? (
                      <option
                        key={domain}
                        value={domain}
                        data-domain-entry={domain}
                      >
                        {entry.title}
                      </option>
                    ) : null;
                  })}
                </optgroup>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </div>
        </div>
        <span className="directory-note">
          <ShieldCheck size={17} aria-hidden="true" />
          {copy.localNote}
        </span>
      </div>
      <div className="directory-selected-info">
        <p id={`${uid}-description`}>{copy[activeDomain][0]}</p>
        <details className="directory-selected-scope" key={activeDomain}>
          <summary>
            {copy.limits}
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div>
            <strong>{current?.title}</strong>
            <p>{copy[activeDomain][1]}</p>
            <p className="reconciliation-directory-boundary">{copy.boundary}</p>
          </div>
        </details>
      </div>
      {disabled && (
        <output className="directory-waiting">{copy.waiting}</output>
      )}
    </section>
  );
}
