import {
  Children,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  FileSpreadsheet,
  GitCompareArrows,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { BrandMark, BrandWordmark } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { workspaceCopy } from '@/lib/i18n/workspace';
import {
  useReconciliationNavigation,
  useWorkspaceIdentity,
} from './reconciliation-navigation';
import './workspace-chrome.css';

export function WorkspaceHeader({
  onBack,
  backLabel,
  disabled = false,
  hasWork = false,
  children,
}: {
  onBack: () => void;
  backLabel: string;
  disabled?: boolean;
  hasWork?: boolean;
  children?: ReactNode;
}) {
  const navigation = useReconciliationNavigation();
  const domain = useWorkspaceIdentity();
  const reportActivity = navigation?.reportActivity;
  const work = useRef(hasWork);
  useEffect(() => {
    work.current = hasWork;
    if (domain) reportActivity?.(domain, { busy: disabled, hasWork });
  }, [domain, reportActivity, disabled, hasWork]);
  useEffect(
    () => () => {
      if (domain)
        reportActivity?.(domain, { busy: false, hasWork: work.current });
    },
    [domain, reportActivity],
  );
  return (
    <header
      className={`workspace-header${navigation ? ' workspace-header--embedded' : ''}`}
    >
      {!navigation && (
        <div className="brand workspace-header__brand">
          <BrandMark />
          <BrandWordmark />
        </div>
      )}
      <div className="workspace-header__actions">
        {!navigation && <LanguageSwitcher />}
        <Button variant="outline" disabled={disabled} onClick={onBack}>
          <ArrowLeft className="workspace-back-icon" aria-hidden="true" />
          {backLabel}
        </Button>
        {children}
      </div>
    </header>
  );
}

/** Keep source order in the accounting input while grouping its rendered cards. */
export function WorkspaceSources({
  children,
  primaryIndices = [0, 1],
  primaryReady = false,
}: {
  children: ReactNode;
  primaryIndices?: number[];
  primaryReady?: boolean;
}) {
  const { lang } = useI18n();
  const copy = workspaceCopy[lang];
  const sources = Children.toArray(children);
  const primary = primaryIndices.filter((index) => index < sources.length);
  const supporting = sources.filter((_, index) => !primary.includes(index));
  const [open, setOpen] = useState(primaryReady);
  const previousReady = useRef(primaryReady);
  useEffect(() => {
    if (primaryReady && !previousReady.current) setOpen(true);
    previousReady.current = primaryReady;
  }, [primaryReady]);
  return (
    <div className="workspace-source-groups" data-workspace-sources>
      <div className="workspace-sources workspace-primary-sources">
        {primary.map((index) => sources[index])}
      </div>
      {supporting.length > 0 && (
        <details
          className="workspace-supporting-sources"
          data-workspace-supporting
          data-workspace-required-sources
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>
            <span>{copy.supporting}</span>
            <span className="workspace-required-label">{copy.required}</span>
          </summary>
          <div className="workspace-supporting-content">
            <p>{copy.supportingHint}</p>
            <div className="workspace-sources">{supporting}</div>
          </div>
        </details>
      )}
    </div>
  );
}

export function WorkspaceAdvanced({
  children,
  summary,
}: {
  children: ReactNode;
  summary?: ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <details className="workspace-advanced" data-workspace-advanced>
      <summary>{summary ?? workspaceCopy[lang].advanced}</summary>
      <div className="workspace-advanced__content">{children}</div>
    </details>
  );
}

export function WorkspaceIntro({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children?: ReactNode;
}) {
  const { lang, dir } = useI18n();
  return (
    <section className="workspace-intro">
      <div className="workspace-intro__heading">
        <span className="workspace-intro__emblem" aria-hidden="true">
          <GitCompareArrows strokeWidth={1.5} />
        </span>
        <h1 tabIndex={-1} lang={lang} dir={dir}>
          {title}
        </h1>
        <p>{intro}</p>
      </div>
      {children && (
        <details className="workspace-intro__context">
          <summary>{workspaceCopy[lang].scopeDetails}</summary>
          <div className="workspace-intro__context-content">{children}</div>
        </details>
      )}
    </section>
  );
}

export function WorkspaceSourceHeading({ children }: { children: ReactNode }) {
  return (
    <span className="workspace-source-heading">
      <span className="workspace-source-icon">
        <FileSpreadsheet aria-hidden="true" />
      </span>
      <span>{children}</span>
    </span>
  );
}

export function WorkspaceFileInput(
  props: ComponentProps<'input'> & { 'aria-label': string },
) {
  const { lang } = useI18n();
  const formats = props.accept
    ?.split(',')
    .map((format) => format.trim().replace(/^\./, '').toUpperCase())
    .join(' / ');
  return (
    <span className="workspace-file-input">
      <span className="workspace-file-input__content" aria-hidden="true">
        <Upload />
        <span>{workspaceCopy[lang].chooseFile}</span>
        <span className="workspace-file-input__formats" dir="ltr">
          {formats}
        </span>
      </span>
      <input {...props} type="file" />
    </span>
  );
}

export function WorkspaceGroupTitle({ kind }: { kind: 'sources' | 'scope' }) {
  const { lang } = useI18n();
  const Icon = kind === 'sources' ? FileSpreadsheet : SlidersHorizontal;
  const title = workspaceCopy[lang][kind];
  return (
    <h2 className="workspace-group-title">
      <span className="workspace-group-title__icon">
        <Icon aria-hidden="true" />
      </span>
      {title}
      <span className="workspace-group-title__rule" aria-hidden="true" />
    </h2>
  );
}
