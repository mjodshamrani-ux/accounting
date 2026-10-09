import type { ComponentProps, ReactNode } from 'react';
import {
  ArrowLeft,
  FileSpreadsheet,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { BrandMark, BrandWordmark } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import { workspaceCopy } from '@/lib/i18n/workspace';
import './workspace-chrome.css';

export function WorkspaceHeader({
  onBack,
  backLabel,
  disabled = false,
  children,
}: {
  onBack: () => void;
  backLabel: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="workspace-header">
      <div className="brand workspace-header__brand">
        <BrandMark />
        <BrandWordmark />
      </div>
      <div className="workspace-header__actions">
        <LanguageSwitcher />
        <Button variant="outline" disabled={disabled} onClick={onBack}>
          <ArrowLeft className="workspace-back-icon" aria-hidden="true" />
          {backLabel}
        </Button>
        {children}
      </div>
    </header>
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
        <h1 tabIndex={-1} lang={lang} dir={dir}>
          {title}
        </h1>
        <p>{intro}</p>
      </div>
      {children && <div className="workspace-intro__context">{children}</div>}
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
      <Icon aria-hidden="true" />
      {title}
    </h2>
  );
}
