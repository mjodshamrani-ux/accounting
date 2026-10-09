import { reconciliationDirectoryCopy } from '@/lib/i18n/reconciliation-directory';
import { ReconciliationDirectory } from '@/components/reconciliation-directory';
import {PayrollWorkspace} from '@/components/payroll-workspace';
import {payrollCopy} from '@/lib/i18n/payroll';
import {AssetWorkspace} from '@/components/fixed-assets-workspace';
import {assetCopy} from '@/lib/i18n/fixed-assets';
import { StockWorkspace } from '@/components/inventory-register-workspace';
import { stockCopy } from '@/lib/i18n/inventory-register';
import { GatewayWorkspace } from '@/components/payment-gateway-workspace';
import { gatewayCopy } from '@/lib/i18n/payment-gateway';
import { IntercompanyWorkspace } from '@/components/intercompany-workspace';
import { intercompanyCopy } from '@/lib/i18n/intercompany';
import { FinancialWorkspace } from '@/components/tb-financial-workspace';
import { BankWorkspace } from '@/components/bank-workspace';
import { AllocationWorkspace } from '@/components/allocation-workspace';
import { createAllocationWorkflowHandoff, type AllocationWorkflowHandoff } from '@/lib/reconciliation/allocation-workflow-handoff';
import { allocationWorkflowHandoffCopy } from '@/lib/i18n/allocation-workflow-handoff';
import { GlTbWorkspace } from '@/components/gl-tb-workspace';
import { ArWorkspace } from '@/components/ar-workspace';
import { headerLabels } from '@/lib/reconciliation/header-view';
import { ClearingWorkspace } from '@/components/clearing-workspace';
import type { restoreSession } from '@/lib/reconciliation/session';
import { VisualReader } from '@/components/visual-reader';
import { visualAccountingMapping, VISUAL_SOURCE_INVALID, } from '@/lib/reconciliation/visual-accounting-source';
import { BrandMark, BrandWordmark, DisplayHeading } from '@/components/brand';
import {
  LandingIntro,
  LandingDetails,
  LandingBenefits,
} from '@/components/landing';
import { SourceUpload } from '@/components/source-upload';
import { MultilineSourceReview } from '@/components/multiline-source-review';
import { SourceStructureReview } from '@/components/source-structure-review';
import { InvoiceOverlapReview } from '@/components/invoice-overlap-review';
import { SupplierInvoiceOverlapReview, type SupplierMainReviewInput } from '@/lib/reconciliation/supplier-overlap-review';
import { SectionDerivedReview } from '@/components/section-derived-review';
import { APP_VERSION } from '@/lib/brand';
import { TransactionReview } from '@/components/transaction-review';
import { PdfReview } from '@/components/pdf-review';
import type { AuditEvent } from '@/lib/reconciliation/types';
import { AccountingAssistant } from '@/components/accounting-assistant';
import { LanguageSwitcher } from '@/components/language-switcher';
import { BackArrow, ForwardArrow } from '@/components/direction';
import { useI18n } from '@/lib/i18n/context';
import type { Messages } from '@/lib/i18n/messages';
import {
  engineText,
  errorText,
  fail,
  uiText,
  type UiText,
} from '@/lib/i18n/text';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ShieldCheck,
  FileSpreadsheet,
  FlaskConical,
  LockKeyhole,
  Check,
  Download,
  LoaderCircle,
  RotateCcw,
  Search,
  CircleHelp,
  X,
  FileCheck2,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import { workerTask, prepareWorker } from '@/lib/reconciliation/client';
import type { ProcessingProgress } from '@/lib/reconciliation/processing-progress';
import {
  readingStatus,
  sourceReadingIssues,
} from '@/lib/reconciliation/reading-issues';
import { ImportAssistant } from '@/components/import-assistant';
import { ImportDiagnosticError } from '@/lib/reconciliation/import-diagnostics';
import type { ImportDiagnosis } from '@/lib/reconciliation/import-diagnostics';
import {
  defaultMapping,
  MAX_FILE_BYTES,
  MAX_PDF_PAGES,
} from '@/lib/reconciliation/types';
import {
  mappingTemplate,
  readMappingTemplate,
  templatePatch,
  migrateMappingTemplates,
} from '@/lib/reconciliation/mapping-template';
import { formatChoice } from '@/lib/reconciliation/input-readiness';
import type {
  SourceFile,
  Mapping,
  Scope,
  Comparison,
  SourceResult,
  Decision,
} from '@/lib/reconciliation/types';
import { inferMapping, money } from '@/lib/reconciliation/core';
import { suggestFormats } from '@/lib/reconciliation/format-inference';
import { currencyPrecision } from '@/lib/reconciliation/currency-precision';
import { inferStatementDirection } from '@/lib/reconciliation/statement-direction';
import type { FormatSuggestions } from '@/lib/reconciliation/format-inference';
import {
  inferScopeSuggestions,
  latestSourceDate,
} from '@/lib/reconciliation/scope-inference';
import type { ScopeSuggestionField } from '@/lib/reconciliation/scope-inference';
import {
  getMappedImportIssues,
  selectImportMapping,
} from '@/lib/reconciliation/import-selection';
import { demoFiles, demoMappings, demoScope } from '@/lib/reconciliation/demo';
const initialScope: Scope = {
  supplier: '',
  entity: '',
  account: '',
  currency: '',
  decimals: 2,
  cutoff: '',
  dateWindow: 2,
  confirmed: false,
  coverageConfirmed: false,
};
const scopeFields: ScopeSuggestionField[] = [
  'supplier',
  'entity',
  'account',
  'currency',
  'cutoff',
];
const numberLabels = { dot: '1,234.56', comma: '1.234,56' };
type FormatChoices = { dateFormat: boolean; numberFormat: boolean };
const freshFormatChoices = (): [FormatChoices, FormatChoices] => [
  { dateFormat: false, numberFormat: false },
  { dateFormat: false, numberFormat: false },
];

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (s: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
        disabled={disabled}
        value={value}
        onValueChange={(v) => v !== null && onChange(String(v))}
        items={options.map(([value, label]) => ({ value, label }))}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
function Tick({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="checkline">
      <Checkbox
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}
function getTemplate(side: number): Partial<Mapping> | null {
  try {
    migrateMappingTemplates(localStorage);
    const value = readMappingTemplate(
      localStorage.getItem(`mizan.mapping.${side}.v1`),
    );
    return value ? templatePatch(value) : null;
  } catch {
    return null;
  }
}
function ReadingIssueList({
  entries,
}: {
  entries: {
    source: SourceResult;
    file: SourceFile;
    side: 'supplier' | 'ledger';
  }[];
}) {
  const { t, engineText } = useI18n();
  const r = t.app.readingIssues;
  const [page, setPage] = useState(0);
  const issues = useMemo(
    () =>
      entries.flatMap(({ source, file, side }) =>
        sourceReadingIssues(source, file, side),
      ),
    [
      entries
    ],
  );
  const issueBinding = JSON.stringify(issues);
  const [pageBinding, setPageBinding] = useState(issueBinding);
  if (pageBinding !== issueBinding) {
    setPageBinding(issueBinding); setPage(0);
  }
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(issues.length / 10) - 1),
  );
  const offset = current * 10;
  if (!issues.length) return null;
  return (
    <details className="panel stack">
      <summary>{r.show(issues.length)}</summary>
      <div className="preview" style={{ maxHeight: 440 }}>
        <table
          aria-label={r.table}
          style={{
            whiteSpace: 'normal',
            tableLayout: 'fixed',
            overflowWrap: 'anywhere',
          }}
        >
          <thead>
            <tr>
              <th>{r.source}</th>
              <th>{r.location}</th>
              <th>{r.reason}</th>
              <th>{r.original}</th>
            </tr>
          </thead>
          <tbody>
            {issues.slice(offset, offset + 10).map((issue, index) => (
              <tr key={`${issue.side}:${issue.row}:${offset + index}`}>
                <td>
                  {t.app.sides[issue.side === 'supplier' ? 0 : 1]}
                  <br />
                  <bdi>{issue.file}</bdi>
                  <br />
                  <bdi>{issue.sheet}</bdi>
                </td>
                <td>
                  {issue.kind === 'source'
                    ? r.sourceWide
                    : issue.kind === 'balance'
                      ? r.balance
                      : r.row(issue.row!)}
                  {issue.page !== null && (
                    <>
                      <br />
                      {r.page(issue.page)}
                    </>
                  )}
                </td>
                <td>{engineText(issue.reason)}</td>
                <td>
                  <bdi
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {issue.values.length
                      ? JSON.stringify(issue.values)
                      : r.noOriginal}
                  </bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <Button
          variant="outline"
          size="sm"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          {r.previous}
        </Button>
        <span>
          {r.range(
            offset + 1,
            Math.min(offset + 10, issues.length),
            issues.length,
          )}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={offset + 10 >= issues.length}
          onClick={() => setPage(current + 1)}
        >
          {r.next}
        </Button>
      </div>
    </details>
  );
}

export default function App() {
  const [domain, setDomain] = useState<
    |'supplier' | 'clearing' | 'ar' | 'gl-tb' | 'allocation' | 'bank' | 'tb-financial' | 'intercompany' | 'gateway' | 'stock' | 'assets' | 'payroll'>('supplier');
  const { t, dir, say } = useI18n();
  const [allocationHandoff, setAllocationHandoff] = useState<AllocationWorkflowHandoff | null>(null);
  const allocationHandoffSerial = useRef(0);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [engineReady, setEngineReady] = useState(false);
  const [files, setFiles] = useState<[SourceFile | null, SourceFile | null]>([
    null,
    null,
  ]);
  const [mappings, setMappings] = useState<[Mapping, Mapping]>([
    defaultMapping(),
    defaultMapping(),
  ]);
  const [scope, setScope] = useState<Scope>(initialScope);
  const allocationHandoffReady = useMemo(() => {
    if (!files[0] || !files[1]) return false;
    try {
      createAllocationWorkflowHandoff([files[0], files[1]], scope, 'eligibility-check');
      return true;
    } catch {
      return false;
    }
  }, [files, scope]);
  const [ scopeEdited, setScopeEdited] = useState<
    Partial<Record<ScopeSuggestionField | 'decimals', boolean>>
  >({});
  const [formatChoices, setFormatChoices] = useState(freshFormatChoices);
  const [ directionEdited, setDirectionEdited] = useState<[boolean, boolean]>([false, false,]);
  const [pdfDrafts, setPdfDrafts] = useState<[boolean, boolean]>([
    false,
    false,
  ]);
  const directionProofs = useMemo(
    () =>
      files.map((file, i) =>
        file && !file.visual
          ? inferStatementDirection(file, mappings[i], scope.decimals)
          : undefined,
      ),
    [files, mappings, scope.decimals],
  );
  const [directionInference, setDirectionInference] = useState({
    directionProofs,
    directionEdited,
  });
  if (
    directionInference.directionProofs !== directionProofs ||
    directionInference.directionEdited !== directionEdited
  ) {
    setDirectionInference({ directionProofs, directionEdited });
    setMappings((previous) => {
      let changed = false;
      const next = previous.map((mapping, i) => {
        const proof = directionProofs[i];
        if (!proof && mapping.directionEvidence) {
          changed = true;
          return { ...mapping, directionEvidence: undefined };
        }
        if (
          proof &&
          !directionEdited[i] &&
          (mapping.multiplier !== proof.multiplier ||
            JSON.stringify(mapping.directionEvidence) !== JSON.stringify(proof))
        ) {
          changed = true;
          return {
            ...mapping,
            multiplier: proof.multiplier,
            directionEvidence: proof,
          };
        }
        return mapping;
      }) as [Mapping, Mapping];
      return changed ? next : previous;
    });
  }
  const [balanceMode, setBalanceMode] = useState(false);
  const scopeSuggestions = useMemo(
    () => inferScopeSuggestions(files, mappings),
    [files, mappings],
  );
  const formatSuggestions = useMemo(
    () =>
      files.map((file, i) =>
        file ? suggestFormats(file, mappings[i], scope.decimals) : null,
      ),
    [files, mappings, scope.decimals],
  );
  const latestDate = useMemo(
    () => latestSourceDate(files, mappings),
    [files, mappings],
  );
  const [scopeInference, setScopeInference] = useState({
    scopeSuggestions,
    latestDate,
    balanceMode,
    scopeEdited,
  });
  if (
    scopeInference.scopeSuggestions !== scopeSuggestions ||
    scopeInference.latestDate !== latestDate ||
    scopeInference.balanceMode !== balanceMode ||
    scopeInference.scopeEdited !== scopeEdited
  ) {
    setScopeInference({
      scopeSuggestions,
      latestDate,
      balanceMode,
      scopeEdited,
    });
    setScope((previous) => {
      const next = { ...previous };
      for (const field of scopeFields) {
        if (!scopeEdited[field])
          next[field] = scopeSuggestions.values[field] ?? initialScope[field];
      }
      // Rows after the cut-off are excluded, so defaulting to the latest date in
      // the sources excludes nothing and still lets the accountant narrow it.
      if (!scopeEdited.cutoff && !next.cutoff && !balanceMode)
        next.cutoff = latestDate;
      const changed = scopeFields.some(
        (field) => previous[field] !== next[field],
      );
      return changed
        ? { ...next, confirmed: false, coverageConfirmed: false }
        : previous;
    });
  }
  const [formatInference, setFormatInference] = useState({
    formatSuggestions,
    formatChoices,
    currency: scope.currency,
  });
  if (
    formatInference.formatSuggestions !== formatSuggestions ||
    formatInference.formatChoices !== formatChoices ||
    formatInference.currency !== scope.currency
  ) {
    setFormatInference({
      formatSuggestions,
      formatChoices,
      currency: scope.currency,
    });
    setMappings((previous) => {
      let changed = false;
      const next = previous.map((mapping, i) => {
        const updated = { ...mapping };
        for (const field of ['dateFormat', 'numberFormat'] as const) {
          if (field === 'numberFormat' && !scope.currency) continue;
          const value = formatSuggestions[i]?.patch[field];
          if (value && !formatChoices[i][field] && value !== mapping[field]) {
            Object.assign(updated, { [field]: value });
            changed = true;
          }
        }
        return updated;
      }) as [Mapping, Mapping];
      return changed ? next : previous;
    });
  }
  const precisionMissing =
    !!scope.currency &&
    currencyPrecision(scope.currency) === undefined &&
    !scopeEdited.decimals;
    const precision = currencyPrecision(scope.currency);
    if (precision !== undefined &&
    ! scopeEdited.decimals &&
    scope.decimals !== precision) {
    setScope((previous) => ( {
            ...previous,
            decimals: precision,
            confirmed: false,
            coverageConfirmed: false,
          })
    );
  }
  const scopeAutofillPending = scopeFields.some((field) => {
    if (scopeEdited[field]) return false;
    let expected = scopeSuggestions.values[field] ?? initialScope[field];
    if (field === 'cutoff' && !expected && !balanceMode) expected = latestDate;
    return scope[field] !== expected;
  });
  const preparationPending =
    scopeAutofillPending ||
    directionProofs.some(
      (proof, i) =>
        proof &&
        !directionEdited[i] &&
        proof.multiplier !== mappings[i].multiplier,
    ) ||
    (!scopeEdited.decimals &&
      currencyPrecision(scope.currency) !== undefined &&
      currencyPrecision(scope.currency) !== scope.decimals) ||
    formatSuggestions.some(
      (suggestion, i) =>
        suggestion &&
        (['dateFormat', 'numberFormat'] as const).some(
          (field) =>
            !formatChoices[i][field] &&
            suggestion.patch[field] !== undefined &&
            suggestion.patch[field] !== mappings[i][field],
        ),
    );
  const unresolvedDirection = files.some(
    (file, i) =>
      file &&
      mappings[i].mode === 'split' &&
      !directionProofs[i] &&
      !directionEdited[i],
  );
  const unresolvedFormats = formatSuggestions.some(
    (suggestion, i) =>
      suggestion &&
      (['dateFormat', 'numberFormat'] as const).some(
        (field) =>
          suggestion[field].status === 'ambiguous' && !formatChoices[i][field],
      ),
  );
  const invalidFormats = formatSuggestions.some(
    (suggestion) =>
      suggestion &&
      [suggestion.numberFormat, suggestion.dateFormat].some(
        (assessment) => assessment.status === 'invalid',
      ),
  );
  const unresolvedScope = scopeFields.filter(
    (field) =>
      scopeSuggestions.fields[field].status === 'conflict' &&
      !scopeEdited[field],
  );

  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeNeedsInput = !scope.cutoff || !scope.currency || precisionMissing;
  const scopeConflict = unresolvedScope.length > 0;
  const pdfReviewPending = files.some(
    (file, i) => file?.pdf && mappings[i].pdfReviewed !== true,
  );
  // A disabled action must always be able to say what it is waiting for.
  const columnsMissing = mappings.some(
    (m, i) =>
      files[i] &&
      (m.date < 0 ||
        (m.mode === 'signed' ? m.amount < 0 : m.debit < 0 || m.credit < 0)),
  );
  // What is blocking, not how it reads: the message follows the language.
  const blockedBy: keyof Messages['app']['blocked'] | null = !files.every(
    Boolean,
  )
    ? 'addFiles'
    : pdfDrafts.some(Boolean)
      ? 'pdfDraft'
      : mappings.some((m) => m.sheet < 0)
        ? 'sheet'
        : columnsMissing
          ? 'columns'
          : !scope.cutoff
            ? 'cutoff'
            : !scope.currency
              ? 'currency'
              : precisionMissing
                ? 'precision'
                : unresolvedScope.length
                  ? 'conflicts'
                  : invalidFormats
                    ? 'invalidFormats'
                    : unresolvedDirection
                      ? 'direction'
                      : unresolvedFormats
                        ? 'formats'
                        : pdfReviewPending
                          ? 'pdfReview'
                          : balanceMode &&
                              (!scope.coverageConfirmed ||
                                !scope.supplier.trim() ||
                                !scope.entity.trim() ||
                                !scope.account.trim())
                            ? 'balances'
                            : preparationPending
                              ? 'preparing'
                              : null;
  const blocked = blockedBy ? t.app.blocked[blockedBy] : '';
  const [step, setStep] = useState(0);
  const workflowHeading = useRef<HTMLHeadingElement>(null);
  const domainPanels = useRef<HTMLDivElement>(null);
  const previousDomain = useRef(domain);
  const domainReturnFocus = useRef<HTMLElement | null>(null);
  const previousStep = useRef(step);
  const showLanding = step === 0 && !files.some(Boolean);
  const previousLanding = useRef(showLanding);
  const privacyHeading = useRef<HTMLHeadingElement>(null);
  const privacyReturnFocus = useRef<HTMLElement | null>(null);
  // Open the panel when the confirmation step still needs a value, then leave it
  // to the accountant: it must not snap shut as the last field is filled.
  const [scopePanelTrigger, setScopePanelTrigger] = useState({
    step,
    scopeNeedsInput,
    scopeConflict,
    preparationPending,
  });
  if (
    scopePanelTrigger.step !== step ||
    scopePanelTrigger.scopeNeedsInput !== scopeNeedsInput ||
    scopePanelTrigger.scopeConflict !== scopeConflict ||
    scopePanelTrigger.preparationPending !== preparationPending) {
    setScopePanelTrigger({
      step,
      scopeNeedsInput,
      scopeConflict,
      preparationPending,
    });
    if (step === 1 && !preparationPending && (scopeNeedsInput || scopeConflict))
      setScopeOpen(true);
  }
  const [demo, setDemo] = useState(false);
  // Messages are kept as what to say, so they follow a change of language.
  const [busy, setBusy] = useState<UiText | null>(null);
  const [processingProgress, setProcessingProgress] =
    useState<ProcessingProgress | null>(null);
  const [error, setError] = useState<UiText | null>(null);
  const [visualCandidate, setVisualCandidate] = useState<File | null>(null);
  const [visualRevision, setVisualRevision] = useState(0);
  const [importDiagnosis, setImportDiagnosis] =
    useState<ImportDiagnosis | null>(null);
  const [notice, setNotice] = useState<UiText | null>(null);
  const [validated, setValidated] = useState<
    [SourceResult, SourceResult] | null
  >(null);
  const [result, setResult] = useState<Comparison | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [mainReviewGeneration, setMainReviewGeneration] = useState(0);
  const [mainOverlapReview, setMainOverlapReview] = useState(() => new SupplierInvoiceOverlapReview());
  const [mainExtractionRevision, setMainExtractionRevision] = useState('native-overlap-reading-v1');
  const [mainOverlapOpen, setMainOverlapOpen] = useState(false);
  const mainReviewContext = useMemo(() => ({ generation: mainReviewGeneration, decisions, rejected }), [mainReviewGeneration, decisions, rejected]);
  const [review, setReview] = useState({ checked: false, name: '', notes: '' });
  const [tab, setTab] = useState('exceptions');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const job = useRef<{ id: number; controller: AbortController } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    try {
      migrateMappingTemplates(localStorage);
    } catch {
      /* Storage may be unavailable; templates remain optional. */
    }
    void prepareWorker()
      .then(() => setEngineReady(true))
      .catch(() => setError(uiText((m) => m.app.errors.engineLoad)));
    return () => job.current?.controller.abort();
  }, []);
  useEffect(() => {
    if (!files.some(Boolean)) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [files]);
  useEffect(() => {
    if (
      previousStep.current === step &&
      previousLanding.current === showLanding
    )
      return;
    previousStep.current = step;
    previousLanding.current = showLanding;
    workflowHeading.current?.scrollIntoView({ block: 'start' });
    workflowHeading.current?.focus({ preventScroll: true });
  }, [step, showLanding]);
  useEffect(() => {
    if (previousDomain.current === domain) return;
    previousDomain.current = domain;
    const origin = domainReturnFocus.current;
    const target = domain === 'supplier'
      ? origin?.isConnected && !origin.closest('[hidden]')
        ? origin
        : workflowHeading.current
      : domainPanels.current
          ?.querySelector(`[data-domain-panel="${domain}"]`)
          ?.querySelector<HTMLElement>('h1, h2');
    target?.scrollIntoView({ behavior: 'instant', block: domain === 'supplier' && target === origin ? 'center' : 'start' });
    target?.focus({ preventScroll: true });
  }, [domain]);
  useEffect(() => {
    if (privacy) {
      privacyHeading.current?.scrollIntoView({ block: 'start' });
      privacyHeading.current?.focus({ preventScroll: true });
    } else if (privacyReturnFocus.current?.isConnected) {
      privacyReturnFocus.current.focus();
      privacyReturnFocus.current = null;
    }
  }, [privacy]);
  function togglePrivacy() {
    if (!privacy && document.activeElement instanceof HTMLElement)
      privacyReturnFocus.current = document.activeElement;
    setPrivacy(!privacy);
  }
  function invalidate() {
    mainOverlapReview.invalidatePending();
    setMainOverlapReview(new SupplierInvoiceOverlapReview());
    setMainReviewGeneration(0);
    setMainExtractionRevision('native-overlap-reading-v1');
    setMainOverlapOpen(false);
    setImportDiagnosis(null);
    setAuditEvents([]);
    setResult(null);
    setValidated(null);
    setDecisions([]);
    setRejected([]);
    setReview({ checked: false, name: '', notes: '' });
    setError(null);
    setSelected('');
    setPage(0);
  }
  function mainOverlapInput(
    signal?: AbortSignal,
    nextScope = scope,
    nextDecisions = decisions,
    nextRejected = rejected,
    generation = mainReviewGeneration,
  ): SupplierMainReviewInput {
    if (!files[0] || !files[1]) fail((m) => m.app.errors.filesMissing);
    return { currentSourceFiles: [files[0], files[1]], mappings,
      scope: nextScope, revision: mainExtractionRevision, signal,
      main: { generation, decisions: nextDecisions, rejected: nextRejected } };
  }
  function applyMainOverlapResult(next: Comparison) {
    job.current?.controller.abort();
    job.current = null;
    setBusy(null);
    setProcessingProgress(null);
    setScope(next.scope);
    setValidated([next.supplier, next.ledger]);
    setResult(next);
    setReview((previous) => ({ ...previous, checked: false }));
    setStep(2);
    setSelected('');
    setPage(0);
  }
  function updateScope(p: Partial<Scope>) {
    setScopeEdited((previous) => {
      const next = { ...previous };
    for (const field of scopeFields)
      if (field in p) next[field] = true;
    if ('currency' in p) next.decimals = false;
      if ('decimals' in p) next.decimals = true;
      return next;
    });
    if ('currency' in p || 'decimals' in p)
      setFormatChoices(freshFormatChoices());
    invalidate();
    setScope((s) => ({
      ...s,
      ...p,
      ...('confirmed' in p || 'coverageConfirmed' in p
        ? {}
        : { confirmed: false, coverageConfirmed: false }),
    }));
  }
  function updateMapping(i: number, p: Partial<Mapping>) {
    const readingChanged = [
      'sheet',
      'header',
      'date',
      'reference',
      'description',
      'amount',
      'debit',
      'credit',
      'currencyColumn',
      'mode',
      'numberFormat',
      'dateFormat',
      'reportType',
      // These change which values reach the interpretation even though the file
      // and its columns do not, so a format already chosen must be asked again.
      'excluded',
      'opening',
      'closing',
    ].some((key) => Object.hasOwn(p, key));
    if (readingChanged) {
      setDirectionEdited(
        (previous) =>
          previous.map((value, index) => (index === i ? false : value)) as[
            boolean,
            boolean,],
      );
      // A choice belongs to the reading it was made under. Changing the reading
      // drops it here as well as in formatChoices, so no later path can use it.
      p = {
        ...p,
        directionEvidence: undefined,
        ...(Object.hasOwn(p, 'formatChoice')
          ? {}
          : { formatChoice: undefined }),
      };
    } else if ('multiplier' in p) {
      setDirectionEdited(
        (previous) =>
          previous.map((value, index) => (index === i ? true : value)) as[
            boolean,
            boolean,],
      );
      p = { ...p, directionEvidence: undefined };
    }
    if (readingChanged)
      setFormatChoices(
        (previous) =>
          previous.map((choice, j) =>
            j === i ? { dateFormat: false, numberFormat: false } : choice,
          ) as [FormatChoices, FormatChoices],
      );
    invalidate();
    setScope((s) => ({ ...s, confirmed: false, coverageConfirmed: false }));
    setMappings(
      (ms) =>
        ms.map((m, j) => (j === i ? { ...m, ...p } : m)) as [Mapping, Mapping],
    );
  }
  function updateFormat(
    i: number,
    field: 'dateFormat' | 'numberFormat',
    value: string,
  ) {
    if (!value) return;
    const retained = formatChoices[i];
    const file = files[i];
    const assessment = formatSuggestions[i]?.[field];
    // Record the choice with the document and reading it answers, so the worker,
    // a restored session and the export all see the same evidence this card did.
    const chosen =
      file && assessment
        ? {
            ...mappings[i].formatChoice,
            [field]: formatChoice(
              file,
              { ...mappings[i], [field]: value },
              field,
              value,
              assessment.candidates,
              scope.decimals,
            ),
          }
        : undefined;
    updateMapping(i, {
      [field]: value,
      ...(chosen ? { formatChoice: chosen } : {}),
    });
    setFormatChoices(
      (previous) =>
        previous.map((choice, j) =>
          j === i ? { ...retained, [field]: true } : choice,
        ) as [FormatChoices, FormatChoices],
    );
  }
  async function task(
    label: UiText,
    fn: (signal: AbortSignal, alive: () => boolean) => Promise<void>,
  ) {
    job.current?.controller.abort();
    mainOverlapReview.invalidatePending();
    const id = ++seq.current,
      controller = new AbortController();
    job.current = { id, controller };
    setBusy(label);
    setProcessingProgress(null);
    setImportDiagnosis(null);
    setError(null);
    setNotice(null);
    const alive = () => job.current?.id === id && !controller.signal.aborted;
    try {
      await fn(controller.signal, alive);
    } catch (e) {
      if (alive()) {
        setImportDiagnosis(
          e instanceof ImportDiagnosticError ? e.diagnosis : null,
        );
        setError(errorText(e, (m) => m.app.errors.operationFailed));
      }
    } finally {
      if (job.current?.id === id) {
        setBusy(null);
        setProcessingProgress(null);
        job.current = null;
      }
    }
  }
  function cancel() {
    job.current?.controller.abort();
    job.current = null;
    setBusy(null);
    setProcessingProgress(null);
    setNotice(uiText((m) => m.app.notices.cancelled));
  }
  function navigateDomain(next: typeof domain) {
    if (domain === 'supplier' && next !== 'supplier') {
      const origin = document.activeElement;
      domainReturnFocus.current = origin instanceof HTMLElement &&
        origin.closest('[data-domain-navigation]') ? origin : null;
    }
    job.current?.controller.abort();
    job.current = null;
    setBusy(null);
    setProcessingProgress(null);
    mainOverlapReview.invalidatePending();
    setMainOverlapOpen(false);
    setDomain(next);
  }
  function openFreshAllocation() {
    if (!allocationHandoffReady || !files[0] || !files[1]) return;
    setAllocationHandoff(createAllocationWorkflowHandoff(
      [files[0], files[1]], scope, `supplier-handoff-${++allocationHandoffSerial.current}`,
    ));
    navigateDomain('allocation');
  }
  function loadDemo() {
    if (busy) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    invalidate();
    setDemo(true);
    setDirectionEdited( [true, true]);
    setScopeEdited( {
      supplier: true,
      entity: true,
      account: true,
      currency: true,
      cutoff: true,
    });
    setFormatChoices(freshFormatChoices());
    setBalanceMode(false);
    setFiles(structuredClone(demoFiles));
    setMappings(structuredClone(demoMappings));
    setScope({ ...demoScope });
    setStep(1);
    setNotice(uiText((m) => m.app.notices.demo));
  }
  async function loadFile(file: File | undefined, i: number) {
    if (!file || busy || !engineReady) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    await task(
      uiText((m) => m.app.tasks.read),
      async (signal, alive) => {
        if (file.size > MAX_FILE_BYTES) fail((m) => m.app.errors.fileTooLarge);
        const buffer = await file.arrayBuffer();
        if (!alive()) return;
        let parsed: SourceFile;
        try {
          parsed = await workerTask<SourceFile>(
            'read',
            { name: file.name, buffer, autoPdfColumns: true },
            signal,
            (progress) => {
              if (alive()) setProcessingProgress(progress);
            },
          );
        } catch (failure) {
          if (alive() && failure instanceof ImportDiagnosticError)
            setVisualCandidate(file);
          throw failure;
        }
        if (!alive()) return;
        if (parsed.visual && parsed.visual.context.side !== (i === 0 ? 'supplier' : 'ledger'))
          throw new Error(VISUAL_SOURCE_INVALID);
        const other = files[1 - i]?.visual?.context;
        if (parsed.visual && other && ['supplier','entity','account','currency','decimals','cutoff',].some(
            (k) => parsed.visual!.context[k as keyof typeof other] !== other[k as keyof typeof other],))
          throw new Error(VISUAL_SOURCE_INVALID);
        const selection = parsed.visual ? {mapping:visualAccountingMapping(parsed),notice:''} : selectImportMapping(parsed,i===0?'supplier':'ledger');
        setDirectionEdited(
          (previous) =>
            previous.map((value, index) =>
              index ===i ? !!parsed.visual : value,
            ) as [boolean, boolean],
        );
        setPdfDrafts(
          (previous) =>
            previous.map((v, j) => (j === i ? false : v)) as [boolean, boolean],
        );
        invalidate();
        setDemo(false);
        setFormatChoices(
          (previous) =>
            previous.map((choice, j) =>
              j === i ? { dateFormat: !!parsed.visual, numberFormat: !!parsed.visual } : choice,
            ) as [FormatChoices, FormatChoices],
        );
        setFiles(
          (fs) =>
            fs.map((f, j) => (j === i ? parsed : f)) as [
              SourceFile | null,
              SourceFile | null,
            ],
        );
        setMappings(
          (ms) =>
            ms.map((m, j) =>
              j === i ? { ...selection.mapping, pdfReviewed: false } : m,
            ) as [Mapping, Mapping],
        );
        if (parsed.visual) {
          const c=parsed.visual.context;
          setScopeEdited({supplier:true,entity:true,account:true,currency:true,cutoff:true,decimals:true,});
          setBalanceMode(false);
          setScope((s)=>({...s,supplier:c.supplier,entity:c.entity,account:c.account,currency:c.currency,decimals:c.decimals,cutoff:c.cutoff,confirmed:false,coverageConfirmed:false,}));
        } else setScope((s) => ({ ...s, confirmed: false, coverageConfirmed: false, }));
        setNotice(selection.notice ? engineText(selection.notice) : null);
      },
    );
  }
  async function configurePdf(i: number, cuts: number[]) {
    const file = files[i];
    if (!file?.pdf || !file.original || busy) return;
    await task(
      uiText((m) => m.app.tasks.rereadPdf),
      async (signal, alive) => {
        const parsed = await workerTask<SourceFile>(
          'read',
          { name: file.name, buffer: file.original, pdfCuts: cuts },
          signal,
          (progress) => {
            if (alive()) setProcessingProgress(progress);
          },
        );
        if (!alive()) return;
        invalidate();
        setDirectionEdited(
          (previous) =>
            previous.map((value, index) => (index === i ? false : value)) as[
              boolean,
              boolean,],
        );
        setFormatChoices(
          (previous) =>
            previous.map((choice, j) =>
              j === i ? { dateFormat: false, numberFormat: false } : choice,
            ) as [FormatChoices, FormatChoices],
        );
        setFiles(
          (fs) =>
            fs.map((f, j) => (j === i ? parsed : f)) as [
              SourceFile | null,
              SourceFile | null,
            ],
        );
        setMappings(
          (ms) =>
            ms.map((m, j) =>
              j === i ? { ...inferMapping(parsed), pdfReviewed: false } : m,
            ) as [Mapping, Mapping],
        );
        setScope((s) => ({ ...s, confirmed: false, coverageConfirmed: false }));
      },
    );
  }
  async function reconcile(
    nextDecisions = decisions,
    nextRejected = rejected,
    event?: Omit<AuditEvent, 'time'>,
  ) {
    await task(
      uiText((m) => m.app.tasks.reconcile),
      async (signal, alive) => {
        // Enforce every preparation prerequisite at the executable entry point,
        // including PDF drafts and an unchosen split-column sign convention.
        if (blockedBy) fail((m) => m.app.blocked[blockedBy]);
        if (!files[0] || !files[1]) fail((m) => m.app.errors.filesMissing);
        if (preparationPending) fail((m) => m.app.errors.preparing);
        if (precisionMissing) fail((m) => m.app.errors.precision);
        if (unresolvedFormats) fail((m) => m.app.errors.formats);
        if (unresolvedScope.length) fail((m) => m.app.errors.conflicts);
        // Pressing compare is the confirmation itself: it is an explicit act on the
        // settings shown above, and any later edit clears it again through
        // updateScope/updateMapping. No separate attestation box repeats it.
        const confirmed: Scope = { ...scope, confirmed: true };
        const payload = {
          files,
          mappings,
          scope: confirmed,
          decisions: nextDecisions,
          rejected: nextRejected,
        };
        const contextChanged = JSON.stringify([nextDecisions, nextRejected]) !== JSON.stringify([decisions, rejected]);
        const nextGeneration = mainReviewGeneration + (contextChanged ? 1 : 0);
        mainOverlapReview.invalidatePending();
        const overlapState = mainOverlapReview.state;
        const owned = overlapState.activeReceiptIds.length > 0
          ? await mainOverlapReview.comparison(mainOverlapInput(signal, confirmed, nextDecisions, nextRejected, nextGeneration))
          : null;
        const computed = owned ? { a: owned.supplier, b: owned.ledger, result: owned } : await workerTask<{
          a: SourceResult;
          b: SourceResult;
          result: Comparison | null;
        }>('reconcile', payload, signal);
        if (!alive() || mainOverlapReview.state.generation !== overlapState.generation) return;
        setValidated([computed.a, computed.b]);
        if (!computed.result) {
          setStep(1);
          fail((m) => m.app.errors.rowsNeedCorrection);
        }
        const r = computed.result;
        if (!alive()) return;
        setScope(confirmed);
        setResult(r);
        setAuditEvents((events) => [
          ...events,
          {
            time: new Date().toISOString(),
            ...(event ?? {
              action: 'compare' as const,
              ids: [],
              note: `تأكيد الإعدادات وتشغيل المقارنة: حتى ${confirmed.cutoff}، ${confirmed.currency}، فرق الأيام المسموح ${confirmed.dateWindow}`,
            }),
          },
        ]);
        setDecisions(nextDecisions);
        setRejected(nextRejected);
        setMainReviewGeneration(nextGeneration);
        setReview((v) => ({ ...v, checked: false }));
        setStep(2);
        setSelected('');
        setPage(0);
      },
    );
  }
  async function storeSession() {
    if (!files[0] || !files[1] || !result) return;
    await task(
      uiText((m) => m.app.tasks.saveSession),
      async (signal, alive) => {
        const buffer = mainOverlapReview.state.receipts.length || mainOverlapReview.archivedReviewDraft
          ? await mainOverlapReview.saveSession(mainOverlapInput(signal), { review, events: auditEvents })
          : await workerTask<ArrayBuffer>(
          'save-session',
          {
            files,
            mappings,
            scope,
            decisions,
            rejected,
            events: auditEvents,
            review,
          },
          signal,
        );
        if (!alive()) return;
        const url = URL.createObjectURL(
          new Blob([buffer], { type: 'application/json' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = `tarasuf-${scope.cutoff}.session.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice(uiText((m) => m.app.notices.sessionSaved));
      },
    );
  }
  async function loadSession(file?: File) {
    if (!file || busy || files.some(Boolean)) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    await task(
      uiText((m) => m.app.tasks.restoreSession),
      async (signal, alive) => {
        if (file.size > 30 * 1024 * 1024)
          fail((m) => m.app.errors.sessionTooLarge);
        const saved = await workerTask<
          Awaited<ReturnType<typeof restoreSession>>
        >('restore-session', { buffer: await file.arrayBuffer() }, signal);
        if (!alive()) return;
        const restoredOverlap = new SupplierInvoiceOverlapReview();
        if (saved.overlapArchive) {
          await restoredOverlap.reimportSession({
            currentSourceFiles: saved.files, mappings: saved.mappings, scope: saved.scope,
            revision: saved.overlapArchive.revision, signal,
            main: { generation: 0, decisions: saved.decisions, rejected: saved.rejected },
          }, saved.overlapArchive.session);
          if (!alive()) return;
        }
        invalidate();
        setMainOverlapReview(restoredOverlap);
        setMainExtractionRevision(saved.overlapArchive?.revision ?? 'native-overlap-reading-v1');
        setDirectionEdited( [true, true]);
        setPdfDrafts([false, false]);
        setFiles(saved.files);
        setMappings(saved.mappings);
        setScopeEdited( {
          supplier: true,
          entity: true,
          account: true,
          currency: true,
          cutoff: true,
          decimals: true,
        });
        setFormatChoices([
          { dateFormat: true, numberFormat: true },
          { dateFormat: true, numberFormat: true },
        ]);
        setBalanceMode(saved.scope.coverageConfirmed);
        setScope(saved.scope);
        setDecisions(saved.decisions);
        setRejected(saved.rejected);
        setResult(saved.result);
        setAuditEvents(saved.events);
        setReview(saved.overlapArchive ? { ...saved.review, checked: false } : saved.review);
        setDemo(false);
        setStep(2);
        setNotice(uiText((m) => m.app.notices.sessionRestored));
      },
    );
  }
  async function download() {
    if (!result) return;
    await task(
      uiText((m) => m.app.tasks.export),
      async (signal, alive) => {
        const buffer = result.matches.some((match) => match.reviewedAggregate)
          ? await mainOverlapReview.exportWorkbook(mainOverlapInput(signal), { ...review, events: auditEvents })
          : await workerTask<ArrayBuffer>(
          'export',
          { result, files, review: { ...review, events: auditEvents } },
          signal,
        );
        if (!alive()) return;
        const url = URL.createObjectURL(
          new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = `tarasuf-workpaper-${scope.cutoff}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        setNotice(uiText((m) => m.app.notices.workpaperReady));
      },
    );
  }
  const reading = readingStatus(result ? [result.supplier, result.ledger] : []);
  const skippedRows = reading.unreadRows;
  // Every diagnostic stays in the export. On screen, drop the balance notes when
  // balances were never requested: repeating them three times was noise.
  // One source on both sides: the comparison is only a diagnostic.
  const sameSource = (result?.diagnostics ?? []).filter(
    (d) => d.code === 'SAME_SOURCE_BOTH_SIDES',
  );
  const onScreenDiagnostics = (result?.diagnostics ?? []).filter(
    (d) =>
      !d.transactionIds.length &&
      d.code !== 'SKIPPED_ROWS' &&
      d.code !== 'SAME_SOURCE_BOTH_SIDES' &&
      !['BALANCE_ARITHMETIC_VERIFIED', 'PERIOD_DETECTED'].includes(d.code) &&
      (!['BALANCE_UNVERIFIED', 'PERIOD_COVERAGE_UNCONFIRMED'].includes(
        d.code,
      ) ||
        result!.scope.coverageConfirmed),
  );
  const matchedBySupplier = useMemo(
    () => new Map(result?.matches.map((m) => [m.supplierId, m]) ?? []),
    [result],
  );
  const rows = useMemo(() => {
    if (!result) return [];
    const visibleCases = result.cases.filter((c) =>
      tab === 'matches'
        ? c.status === 'Matched'
        : tab === 'ambiguities'
          ? c.status === 'Needs Review' || c.status === 'Rejected'
          : c.status === 'Unmatched',
    );
    const q = query.trim().toLowerCase();
    const tx = visibleCases
      .filter(
        (c) =>
          !q ||
          [
            c.caseId,
            ...c.supplierMembers.flatMap((t) => [
              t.reference,
              t.documentReference,
              t.description,
              String(t.row),
            ]),
            ...c.ledgerMembers.flatMap((t) => [
              t.reference,
              t.documentReference,
              t.description,
              String(t.row),
            ]),
          ]
            .join(' ')
            .toLowerCase()
            .includes(q),
      )
      .map((c) => c.supplierMembers[0] ?? c.ledgerMembers[0]);
    return tx;
  }, [result, tab, query]);
  const startSyntheticDemo = useEffectEvent(() => {
    if (files.some(Boolean) || busy)
      throw new Error('Cannot replace an active session');
    loadDemo();
  });
  // The optional agent interface only opens the synthetic example; it never exposes user files or results.
  useEffect(() => {
    type MC = {
      registerTool: (tool: unknown, options: unknown) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: MC }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'start_synthetic_reconciliation',
          description:
            'Start the synthetic demo only when no user files are present. Returns no accounting data.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: (input: unknown) => {
            if (
              !input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              Object.keys(input).length
            )
              throw new Error('Expected empty object');
            startSyntheticDemo();
            return { status: 'synthetic-demo-opened' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  function reset() {
    setError(null);
    setImportDiagnosis(null);
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    setResetOpen(false);
    cancel();
    invalidate();
    setFiles([null, null]);
    setDirectionEdited( [false, false]);
    setPdfDrafts([false, false]);
    setMappings([defaultMapping(), defaultMapping()]);
    setScopeEdited( {});
    setFormatChoices(freshFormatChoices());
    setBalanceMode(false);
    setScope(initialScope);
    setDemo(false);
    setStep(0);
    setNotice(null);
  }
  return (
    <>
    <div ref={domainPanels} hidden={domain === 'supplier'}>
      <div data-domain-panel="payroll" hidden={domain !== 'payroll'}>
        <PayrollWorkspace active={domain === 'payroll'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="assets" hidden={domain !== 'assets'}>
        <AssetWorkspace active={domain === 'assets'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="stock" hidden={domain !== 'stock'}>
        <StockWorkspace active={domain === 'stock'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="gateway" hidden={domain !== 'gateway'}>
        <GatewayWorkspace active={domain === 'gateway'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="intercompany" hidden={domain !== 'intercompany'}>
        <IntercompanyWorkspace active={domain === 'intercompany'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="tb-financial" hidden={domain !== 'tb-financial'}>
        <FinancialWorkspace active={domain === 'tb-financial'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="bank" hidden={domain !== 'bank'}>
        <BankWorkspace active={domain === 'bank'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="allocation" hidden={domain !== 'allocation'}>
        <AllocationWorkspace key={allocationHandoff?.revision ?? 'direct-allocation'} handoff={allocationHandoff ?? undefined} active={domain === 'allocation'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="gl-tb" hidden={domain !== 'gl-tb'}>
        <GlTbWorkspace active={domain === 'gl-tb'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="ar" hidden={domain !== 'ar'}>
        <ArWorkspace active={domain === 'ar'} onBack={() => navigateDomain('supplier')} />
      </div>
      <div data-domain-panel="clearing" hidden={domain !== 'clearing'}>
        <ClearingWorkspace active={domain === 'clearing'} onBack={() => navigateDomain('supplier')} />
      </div>
    </div>
    <div hidden={domain !== 'supplier'} className={`app-shell ${showLanding ? 'has-landing' : 'in-session'}`}>
      <a className="skip-link" href="#reconciliation">
        {t.app.shell.skipLink}
      </a>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent dir={dir}>
          <AlertDialogTitle>{t.app.shell.resetTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.app.shell.resetDescription}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.app.shell.resetCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>
              {t.app.shell.resetConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <header className="topbar">
        <a
          className="brand"
          href={showLanding ? '#top' : '#reconciliation'}
          aria-label={t.app.shell.brandHome}
        >
          <BrandMark />
          <BrandWordmark />
        </a>
        {showLanding && (
          <nav className="site-nav" aria-label={t.app.shell.mainNav}>
            <a href="#how-it-works">{t.app.shell.navHow}</a>
            <a href="#privacy">{t.app.shell.navPrivacy}</a>
          </nav>
        )}
        <div className="topbar-actions">
          <LanguageSwitcher />
          <button
            className="local-pill"
            aria-expanded={privacy}
            aria-controls={privacy ? 'privacy-info' : undefined}
            onClick={togglePrivacy}
          >
            <ShieldCheck size={16} /> <span>{t.app.shell.localPill}</span>
          </button>
          {showLanding && (
            <a className="nav-start" href="#reconciliation-types">
              {t.app.shell.navStart} <ForwardArrow size={15} />
            </a>
          )}
        </div>
      </header>
      <main>
        {showLanding && <LandingIntro />}
        <ReconciliationDirectory
          disabled={!!busy || !engineReady}
          entries={[
            { id: 'supplier', title: reconciliationDirectoryCopy[dir === 'rtl' ? 'ar' : 'en'].supplierTitle },
            { id: 'clearing', title: t.clearing.entry },
            { id: 'ar', title: t.arDocuments.entry },
            { id: 'gl-tb', title: t.glTb.entry },
            { id: 'allocation', title: t.allocation.entry },
            { id: 'bank', title: t.bank.entry },
            { id: 'tb-financial', title: t.financial.trialBalanceAndFinancialPosition },
            { id: 'intercompany', title: intercompanyCopy[dir === 'rtl' ? 'ar' : 'en'].title },
            { id: 'gateway', title: gatewayCopy[dir === 'rtl' ? 'ar' : 'en'].title },
            { id: 'stock', title: stockCopy[dir === 'rtl' ? 'ar' : 'en'].title },
            { id: 'assets', title: assetCopy[dir === 'rtl' ? 'ar' : 'en'].title },
            { id: 'payroll', title: payrollCopy[dir === 'rtl' ? 'ar' : 'en'].title },
          ]}
          onSelect={(next) => {
            if (next === 'supplier') {
              workflowHeading.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
              workflowHeading.current?.focus({ preventScroll: true });
              return;
            }
            if (next === 'allocation') setAllocationHandoff(null);
            navigateDomain(next);
          }}
        />
        {showLanding && <LandingBenefits />}
        <div className="workspace" id="reconciliation">

          {privacy && (
            <section
              className="surface pad stack"
              id="privacy-info"
              aria-labelledby="privacy-detail-title"
            >
              <div className="section-heading" style={{ padding: 0 }}>
                <h2
                  ref={privacyHeading}
                  tabIndex={-1}
                  id="privacy-detail-title"
                >
                  {t.app.shell.privacyTitle}
                </h2>
                <Button
                  aria-label={t.app.shell.privacyClose}
                  variant="ghost"
                  onClick={() => setPrivacy(false)}
                >
                  <X />
                </Button>
              </div>
              <p className="muted">{t.app.shell.privacyProcessing}</p>
              <p className="muted">{t.app.shell.privacyStorage}</p>
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    localStorage.removeItem('mizan.mapping.0.v1');
                    localStorage.removeItem('mizan.mapping.1.v1');
                    setNotice(uiText((m) => m.app.notices.templatesCleared));
                  } catch {
                    setError(uiText((m) => m.app.errors.templatesUnavailable),);
                  }
                }}
              >
                {t.app.shell.clearTemplates}
              </Button>
            </section>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> {t.app.shell.eyebrow}
              </div>
              {showLanding ? (
                <h2
                  className="workflow-title"
                  ref={workflowHeading}
                  tabIndex={-1}
                >
                  <DisplayHeading id="upload" />
                </h2>
              ) : (
                <h1
                  className="workflow-title"
                  ref={workflowHeading}
                  tabIndex={-1}
                >
                  <DisplayHeading
                    id={
                      step === 0
                        ? 'upload'
                        : step === 1
                          ? 'confirm'
                          : step === 2
                            ? 'review'
                            : 'export'
                    }
                  />
                </h1>
              )}
              <p>{t.app.shell.stepIntro[Math.min(step, 3)]}</p>
            </div>
            <div className="stack">
              <span className="version-badge">
                {`${t.app.shell.beta} `}
                <bdi>{APP_VERSION}</bdi>
              </span>
              {files.some(Boolean) && (
                <Button
                  variant="ghost"
                  onClick={() => setResetOpen(true)}
                  disabled={!!busy}
                >
                  <RotateCcw size={15} />
                  {t.app.shell.newReconciliation}
                </Button>
              )}
            </div>
          </div>
          <nav className="steps" aria-label={t.app.shell.stepsNav}>
            <ol>
              {t.app.shell.steps.map((label, index) => (
                <li
                  key={index}
                  className={
                    index === step ? 'active' : index < step ? 'complete' : ''
                  }
                  aria-current={index === step ? 'step' : undefined}
                >
                  <span className="step-number" aria-hidden="true">
                    {index < step ? <Check size={16} /> : index + 1}
                  </span>
                  <span className="step-label">
                    {label}
                    <span className="sr-only">
                      {index < step
                        ? t.app.shell.stepDone
                        : index === step
                          ? t.app.shell.stepCurrent
                          : t.app.shell.stepLater}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </nav>
          {demo && (
            <div className="notice">
              <FlaskConical
                size={17}
                style={{ display: 'inline', marginInlineEnd: 8 }}
              />
              {t.app.shell.demoBanner}
            </div>
          )}
          {!engineReady && !!error && (
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                void prepareWorker()
                  .then(() => setEngineReady(true))
                  .catch(() =>
                    setError(uiText((m) => m.app.errors.engineRestart)),
                  );
              }}
            >
              {t.app.shell.restartEngine}
            </Button>
          )}
          {!engineReady && !error && (
            <output style={{ display: 'block' }} className="notice loading">
              <LoaderCircle className="spin" size={17} />
              {t.app.shell.engineLoading}
            </output>
          )}
          {error && (
            <div className="notice error" role="alert">
              <div>
                <p>{say(error)}</p>
                {importDiagnosis && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    {t.app.importStop.at(
                      importDiagnosis.page,
                      importDiagnosis.totalPages,
                    )}
                    {importDiagnosis.contentKind === 'mixed'
                      ? t.app.importStop.mixed
                      : importDiagnosis.contentKind === 'image-only'
                        ? t.app.importStop.imageOnly
                        : importDiagnosis.contentKind === 'native-text'
                          ? t.app.importStop.nativeText
                          : t.app.importStop.unknown}{' '}
                    {t.app.importStop.advice}
                  </p>
                )}
              </div>
            </div>
          )}
          {notice && (
            <output style={{ display: 'block' }} className="notice success">
              {say(notice)}
            </output>
          )}
          {busy && (
            <output style={{ display: 'block' }} className="notice loading">
              <LoaderCircle className="spin" size={20} />
              {processingProgress
                ? processingProgress.completed === 0
                  ? processingProgress.stage === 'pdf-read'
                    ? t.app.processing.preparingRead
                    : t.app.processing.preparingLayout
                  : processingProgress.stage === 'pdf-read'
                    ? t.app.processing.readingPage(
                        processingProgress.completed,
                        processingProgress.total,
                      )
                    : t.app.processing.layoutPage(
                        processingProgress.completed,
                        processingProgress.total,
                      )
                : say(busy)}
              <Button variant="ghost" onClick={cancel}>
                {t.common.cancel}
              </Button>
            </output>
          )}
          {step === 0 && (
            <>
              <section className="surface upload-surface">
                <div className="section-heading">
                  <div>
                    <h2>{t.app.upload.heading}</h2>
                    <p>{t.app.upload.constraints}</p>
                  </div>
                  <FileSpreadsheet size={23} />
                </div>
                <div className="file-grid">
                  {t.app.sides.map((label, side) => (
                    <SourceUpload
                      key={side}
                      side={side}
                      label={label}
                      filename={files[side]?.name}
                      busy={!!busy}
                      ready={engineReady}
                      onFile={(file) => {
                        void loadFile(file, side);
                      }}
                      onError={(message) => {
                        setImportDiagnosis(null);
                        setError(message);
                      }}
                    />
                  ))}
                </div>
                <p className="source-file-limits" id="source-file-limits">
                  <span>
                    <bdi>XLSX</bdi> · <bdi>CSV</bdi> ·{' '}{t.app.upload.pdfBefore}
                    <bdi>PDF</bdi>
                    {t.app.upload.pdfAfter}
                  </span>
                  <span>
                    {t.app.upload.upTo}
                    <bdi>8 MB</bdi>
                    {t.app.upload.perFile}
                    <bdi>{MAX_PDF_PAGES}</bdi>
                    {t.app.upload.pagesPer}
                    <bdi>PDF</bdi>
                  </span>
                  <span>{t.app.upload.imageHint}</span>
                </p>
                <div className="surface-footer">
                  <span>
                    <LockKeyhole size={16} />
                    {t.app.upload.noServer}
                  </span>
                  <Button
                    disabled={!files.every(Boolean) || !!busy}
                    onClick={() => setStep(1)}
                  >
                    {t.app.upload.next}
                    <ForwardArrow size={17} />
                  </Button>
                </div>
              </section>
              <MultilineSourceReview />
              <VisualReader
                key={`${visualRevision}:${visualCandidate ? `${visualCandidate.name}:${visualCandidate.lastModified}` : 'visual'}`}
                candidate={visualCandidate}
                scope={scope}
                onSource={loadFile}
                active={domain === 'supplier'}
              />
              <div className="demo-strip">
                <div>
                  <FlaskConical size={23} />
                  <div>
                    <strong>{t.app.upload.demoTitle}</strong>
                    <p>{t.app.upload.demoText}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={loadDemo}
                  disabled={!!busy || !engineReady}
                >
                  {t.app.upload.demoButton}
                </Button>
              </div>
            </>
          )}
          {step === 1 && (
            <fieldset
              disabled={!!busy}
              className="stack"
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <section className="surface pad stack">
                <div className="summary-head">
                  <div>
                    <h2>{t.app.scope.heading}</h2>
                    <p className="summary-line">
                      {t.app.scope.until}{' '}
                      {scope.cutoff ? (
                        <strong>
                          <bdi dir="ltr">{scope.cutoff}</bdi>
                        </strong>
                      ) : (
                        <span className="gap">{t.app.scope.setDate}</span>
                      )}{' '}
                      ·{' '}
                      {scope.currency ? (
                        <strong>
                          <bdi dir="ltr">{scope.currency}</bdi>
                        </strong>
                      ) : (
                        <span className="gap">{t.app.scope.setCurrency}</span>
                      )}{' '}
                      {t.app.scope.dateWindow(scope.dateWindow)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setScopeOpen(!scopeOpen)}
                    aria-expanded={scopeOpen}
                    aria-label={t.app.scope.edit}
                  >
                    <Pencil size={14} />
                    {scopeOpen ? t.app.scope.close : t.app.scope.advanced}
                  </Button>
                </div>
                {scopeNeedsInput && !scopeOpen && (
                  <p className="hint">
                    {!scope.cutoff && !scope.currency
                      ? t.app.scope.needBoth
                      : !scope.cutoff
                        ? t.app.scope.needCutoff
                        : !scope.currency
                          ? t.app.scope.needCurrency
                          : t.app.scope.needPrecision}
                  </p>
                )}
                {scopeConflict && !scopeOpen && (
                  <output style={{ display: 'block' }} className="hint warn">
                    {t.app.scope.conflict(
                      unresolvedScope.map((field) => t.app.scopeFields[field],),
                    )}
                  </output>
                )}
                {scopeOpen && (
                  <div className="panel stack">
                    {files.some((f)=>f?.visual) && ( <p className="hint">{t.visualAccounting.locked}</p>
                      )}
                    <div className="form-grid">
                      <Field
                        label={t.app.scope.cutoffField}
                        hint={
                          scopeSuggestions.fields.cutoff.status === 'suggested'
                            ? t.app.scope.cutoffFrom(
                                scopeSuggestions.fields.cutoff.evidence[0]
                                  .side === 'supplier'
                                  ? 0
                                  : 1,
                                scopeSuggestions.fields.cutoff.evidence[0].row,
                              )
                            : scope.cutoff && scope.cutoff === latestDate
                              ? t.app.scope.cutoffLatest
                              : t.app.scope.cutoffNote
                        }
                      >
                        <Input
                          disabled={files.some((f)=>f?.visual)}
                          type="date"
                          aria-label={t.app.scope.cutoffLabel}
                          value={scope.cutoff}
                          onChange={(e) =>
                            updateScope({ cutoff: e.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label={t.app.scope.currencyField}
                        hint={
                          scopeSuggestions.fields.currency.status ===
                          'suggested'
                            ? t.app.scope.currencyRead
                            : t.app.scope.currencyHint
                        }
                      >
                        <Input
                          disabled={files.some((f)=>f?.visual)}
                          aria-label={t.app.scope.currencyLabel}
                          maxLength={3}
                          dir="ltr"
                          placeholder="SAR"
                          value={scope.currency}
                          onChange={(e) =>
                            updateScope({
                              currency: e.target.value.toUpperCase(),
                            })
                          }
                        />
                      </Field>
                      <Choice
                        label={t.app.scope.decimals}
                        disabled={files.some((f)=>f?.visual)}
                        value={precisionMissing ? '' : String(scope.decimals)}
                        onChange={(v) => {
                          if (v) updateScope({ decimals: Number(v) });
                        }}
                        options={[
                          ...(precisionMissing
                            ? ([['', t.app.scope.decimalsChoose]] as [
                                string,
                                string,
                              ][])
                            : []),
                          ['0', t.app.scope.decimalsZero],
                          ['2', t.app.scope.decimalsTwo],
                          ['3', t.app.scope.decimalsThree],
                        ]}
                      />
                      <Choice
                        label={t.app.scope.dateWindowField}
                        value={String(scope.dateWindow)}
                        onChange={(v) => updateScope({ dateWindow: Number(v) })}
                        options={Array.from(
                          { length: 8 },
                          (_, i) =>
                            [String(i), t.app.scope.days(i)] as [
                              string,
                              string,
                            ],
                        )}
                      />
                    </div>
                    {!files.some((f)=>f?.visual) && ( <Tick
                      checked={balanceMode}
                      onChange={(value) => {
                        setBalanceMode(value);
                        updateScope({
                          coverageConfirmed: false,
                          confirmed: false,
                        });
                        if (!value) {
                          setMappings(
                            (previous) =>
                              previous.map((m) => ({
                                ...m,
                                opening: '',
                                closing: '',
                                periodStart: '',
                              })) as [Mapping, Mapping],
                          );
                          setFormatChoices(freshFormatChoices());
                        }
                      }}
                    >
                      {t.app.scope.balanceMode}
                    </Tick>
                      )}
                    {(balanceMode ||
                      unresolvedScope.some((field) =>
                        ['supplier', 'entity', 'account'].includes(field),
                      )) && (
                      <div className="form-grid">
                        <Field label={t.app.scope.supplierField}>
                          <Input
                          disabled={files.some((f)=>f?.visual)}
                            aria-label={t.app.scope.supplierLabel}
                            value={scope.supplier}
                            onChange={(e) =>
                              updateScope({ supplier: e.target.value })
                            }
                          />
                        </Field>
                        <Field label={t.app.scope.entityField}>
                          <Input
                          disabled={files.some((f)=>f?.visual)}
                            aria-label={t.app.scope.entityLabel}
                            value={scope.entity}
                            onChange={(e) =>
                              updateScope({ entity: e.target.value })
                            }
                          />
                        </Field>
                        <Field label={t.app.scope.accountField}>
                          <Input
                          disabled={files.some((f)=>f?.visual)}
                            aria-label={t.app.scope.accountLabel}
                            value={scope.account}
                            onChange={(e) =>
                              updateScope({ account: e.target.value })
                            }
                          />
                        </Field>
                      </div>
                    )}
                    {scopeFields.some(
                      (field) => scopeSuggestions.fields[field].evidence.length,
                    ) && (
                      <details>
                        <summary>{t.app.scope.sources}</summary>
                        <div className="stack" style={{ marginTop: 12 }}>
                          {scopeFields.map(
                            (field) =>
                              scopeSuggestions.fields[field].evidence.length >
                                0 && (
                                <div key={field}>
                                  <strong>
                                    {t.app.scopeFields[field]}
                                    {scopeSuggestions.fields[field].status ===
                                    'conflict'
                                      ? t.app.scope.conflictMark
                                      : ''}
                                  </strong>
                                  {scopeSuggestions.fields[field].evidence.map(
                                    (item, i) => (
                                      <p className="muted" key={i}>
                                        <bdi>{item.value}</bdi>
                                        {' —'}{' '}
                                        {
                                          t.app.sides[
                                            item.side === 'supplier' ? 0 : 1
                                          ]
                                        }
                                        {t.app.scope.evidenceSeparator}
                                        <bdi>{item.sheet}</bdi>
                                        {t.app.scope.evidenceRow}
                                        {item.row}
                                      </p>
                                    )
                                  )}
                                </div>
                              ),
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </section>
              {files.map(
                (file, i) =>
                  file && (
                    <SourceConfiguration
                      key={i}
                      file={file}
                      mapping={mappings[i]}
                      proposalScopeKey={JSON.stringify(scope)}
                      side={i}
                      onChange={(p) => updateMapping(i, p)}
                      validation={validated?.[i]}
                      onNotice={setNotice}
                      onError={setError}
                      onPdfApply={(cuts) => void configurePdf(i, cuts)}
                      formats={formatSuggestions[i] ?? undefined}
                      formatChoices={formatChoices[i]}
                      onFormatChange={(field, value) =>
                        updateFormat(i, field, value)
                      }
                      balanceMode={balanceMode}
                      directionConfirmed={
                        directionEdited[i] || !!directionProofs[i]
                      }
                      onPdfDraftChange={(pending) => {
                        mainOverlapReview.invalidatePending();
                        setPdfDrafts((previous) =>
                          previous[i] === pending
                            ? previous
                            : (previous.map((v, j) =>
                                j === i ? pending : v,
                              ) as [boolean, boolean]),
                        );
                      }}
                    />
                  ),
              )}
              <SourceStructureReview files={files} mappings={mappings} scope={scope} />
              <InvoiceOverlapReview files={files} mappings={mappings} scope={scope} extractionRevision={mainExtractionRevision} open={mainOverlapOpen} onOpenChange={setMainOverlapOpen} mainReview={{ coordinator: mainOverlapReview, context: mainReviewContext, onResult: applyMainOverlapResult, blockedReason: blocked || (busy ? t.app.blocked.preparing : '') }} />
              <Button type="button" variant="outline" data-testid="allocation-workflow-handoff" className="h-auto whitespace-normal text-start" disabled={!!busy || !allocationHandoffReady} aria-describedby={!allocationHandoffReady && files.every(Boolean) ? 'allocation-handoff-source-required' : undefined} onClick={openFreshAllocation}>{allocationWorkflowHandoffCopy(dir === 'rtl' ? 'ar' : 'en').open}</Button>
              {!allocationHandoffReady && files.every(Boolean) && (
                <p id="allocation-handoff-source-required" className="hint">
                  {allocationWorkflowHandoffCopy(dir === 'rtl' ? 'ar' : 'en').requiresSources}
                </p>
              )}
              <SectionDerivedReview files={files} mappings={mappings} scope={scope} />
              <section className="surface pad stack">
                {pdfReviewPending && (
                  <p className="hint warn">{t.app.compare.pdfPending}</p>
                )}
                {balanceMode && (
                  <Tick
                    checked={scope.coverageConfirmed}
                    onChange={(v) => updateScope({ coverageConfirmed: v })}
                  >
                    {t.app.compare.coverage}
                  </Tick>
                )}
                <div className="actions">
                  <Button onClick={() => void reconcile()} disabled={!!blocked}>
                    {t.app.compare.run}
                    <ForwardArrow size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      invalidate();
                      setStep(0);
                    }}
                  >
                    {t.app.compare.backToFiles}
                  </Button>
                </div>
                <p className="hint">{blocked || t.app.compare.attestation}</p>
              </section>
            </fieldset>
          )}
          {step === 0 && !files.some(Boolean) && (
            <section className="surface pad">
              <label>
                {t.app.upload.resume}{' '}
                <input
                  type="file"
                  aria-label={t.app.upload.resumeLabel}
                  accept=".json"
                  disabled={!!busy || !engineReady}
                  onChange={(e) => {
                    void loadSession(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="muted">{t.app.upload.resumeNote}</p>
            </section>
          )}
          {result && step >= 2 && (
            <>
              <div className="actions">
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void storeSession()}
                >
                  {t.app.results.saveSession}
                </Button>
                <span className="muted">{t.app.results.sessionWarning}</span>
              </div>
              <div className="metric-grid">
                <Metric
                  label={t.app.results.autoMatches}
                  value={String(
                    result.matches.filter((m) => m.kind === 'auto').length,
                  )}
                  hint={t.app.results.autoMatchesHint}
                />
                <Metric
                  label={t.app.results.manualMatches}
                  value={String(
                    result.matches.filter((m) => m.kind === 'manual').length,
                  )}
                  hint={t.app.results.manualMatchesHint}
                />
                <Metric
                  label={t.app.results.unmatchedCases}
                  value={String(result.caseCounts.unmatchedCases)}
                  hint={t.app.results.unmatchedRows(
                    result.caseCounts.unmatchedSourceRows,
                  )}
                />
                {result.scope.coverageConfirmed || result.bridge ? (
                  <Metric
                    label={t.app.results.balanceDifference}
                    value={
                      result.bridge
                        ? money(result.bridge.delta, scope.decimals)
                        : '—'
                    }
                    hint={
                      result.bridge
                        ? scope.currency
                        : t.app.results.balancesUnverified
                    }
                  />
                ) : (
                  // With balances not requested, the number that matters is how
                  // much of the source never made it into the comparison.
                  <Metric
                    label={t.app.results.skippedRows}
                    value={String(skippedRows)}
                    hint={
                      reading.partial
                        ? t.app.readingIssues.partialHint
                        : t.app.results.noSkippedRows
                    }
                  />
                )}
              </div>
              {!!sameSource.length && (
                <div className="notice error" role="alert">
                  {sameSource.map((d, i) => (
                    <p key={i}>{say(engineText(d.message))}</p>
                  ))}
                </div>
              )}
              {reading.partial && (
                <output style={{ display: 'block' }} className="notice">
                  <strong>{t.app.readingIssues.partial}</strong>
                  <p>
                    {t.app.readingIssues.counts(
                      reading.processedRows,
                      reading.unreadRows,
                    )}
                  </p>
                  {reading.balanceIssues > 0 && (
                    <p>
                      {t.app.readingIssues.balanceCount(reading.balanceIssues,)}
                    </p>
                  )}
                  {reading.sourceIssues > 0 && (
                    <p>
                      {t.app.readingIssues.sourceCount(reading.sourceIssues)}
                    </p>
                  )}
                  <p>{t.app.readingIssues.partialHint}</p>
                  {result.diagnostics
                    .filter((d) => d.code === 'SKIPPED_ROWS')
                    .map((d, i) => (
                      <p key={i}>{say(engineText(d.message))}</p>
                    ))}
                  <p>{t.app.results.skippedAdvice}</p>
                </output>
              )}
              {reading.partial && files[0] && files[1] && (
                <ReadingIssueList
                  entries={[
                    {
                      source: result.supplier,
                      file: files[0],
                      side: 'supplier',
                    },
                    { source: result.ledger, file: files[1], side: 'ledger' },
                  ]}
                />
              )}
              {result.scope.coverageConfirmed && !result.balanceComparable && (
                <div className="notice">{t.app.results.transactionsOnly}</div>
              )}
              {!!onScreenDiagnostics.length && (
                <output style={{ display: 'block' }} className="notice">
                  {onScreenDiagnostics.map((d, i) => (
                    <p key={i}>{say(engineText(d.message))}</p>
                  ))}
                </output>
              )}
              <AccountingAssistant
                result={result}
                selectedId={selected || undefined}
              />
              {step === 2 && (
                <>
                  <InvoiceOverlapReview files={files} mappings={mappings} scope={scope} extractionRevision={mainExtractionRevision} open={mainOverlapOpen} onOpenChange={setMainOverlapOpen} mainReview={{ coordinator: mainOverlapReview, context: mainReviewContext, onResult: applyMainOverlapResult, blockedReason: blocked || (busy ? t.app.blocked.preparing : '') }} />
                  <Button type="button" variant="outline" data-testid="allocation-workflow-handoff" className="h-auto whitespace-normal text-start" disabled={!!busy || !allocationHandoffReady} aria-describedby={!allocationHandoffReady && files.every(Boolean) ? 'allocation-handoff-source-required' : undefined} onClick={openFreshAllocation}>{allocationWorkflowHandoffCopy(dir === 'rtl' ? 'ar' : 'en').open}</Button>
              {!allocationHandoffReady && files.every(Boolean) && (
                <p id="allocation-handoff-source-required" className="hint">
                  {allocationWorkflowHandoffCopy(dir === 'rtl' ? 'ar' : 'en').requiresSources}
                </p>
              )}
                  <section className="surface">
                    <div className="section-heading">
                      <div>
                        <h2>{t.app.results.workspace}</h2>
                        <p>{t.app.results.workspaceIntro}</p>
                      </div>
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => {
                          invalidate();
                          setStep(1);
                        }}
                      >
                        {t.app.results.editSettings}
                      </Button>
                    </div>
                    <div className="pad" style={{ paddingTop: 0 }}>
                      <div
                        className="actions"
                        style={{ justifyContent: 'space-between' }}
                      >
                        <Tabs
                          value={tab}
                          onValueChange={(v) => {
                            setTab(String(v));
                            setPage(0);
                            setSelected('');
                          }}
                        >
                          <TabsList aria-label={t.app.results.filter}>
                            <TabsTrigger value="exceptions">
                              {t.app.results.tabUnmatched}
                            </TabsTrigger>
                            <TabsTrigger value="matches">
                              {t.app.results.tabMatched}
                            </TabsTrigger>
                            <TabsTrigger value="ambiguities">
                              {t.app.results.tabReview(
                                result.caseCounts.needsReviewCases,
                              )}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="actions">
                          <Search size={16} />
                          <Input
                            style={{ width: 190 }}
                            aria-label={t.app.results.search}
                            placeholder={t.app.results.searchPlaceholder}
                            value={query}
                            onChange={(e) => {
                              setQuery(e.target.value);
                              setPage(0);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {t.app.results.columns.map((h, i) => (
                              <TableHead key={i}>{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.slice(page * 30, (page + 1) * 30).map((tx) => {
                            const activeCase = result.cases.find((c) =>
                              c.sourceTrace.some(
                                (trace) => trace.sourceRowId === tx.id,
                              ),
                            )!;
                            const match =
                              tx.side === 'supplier'
                                ? matchedBySupplier.get(tx.id)
                                : undefined;
                            return (
                              <TableRow key={tx.id}>
                                <TableCell>
                                  {t.app.sideShort[tx.side]} · {tx.row}
                                </TableCell>
                                <TableCell className="mono">
                                  {tx.date}
                                </TableCell>
                                <TableCell>
                                  <bdi>
                                    {tx.reference || t.app.results.noReference}
                                  </bdi>
                                  <div className="muted">
                                    {tx.description.slice(0, 55)}
                                  </div>
                                </TableCell>
                                <TableCell className="mono">
                                  {money(
                                    activeCase.supplierMembers.length
                                      ? activeCase.supplierTotal
                                      : activeCase.ledgerTotal,
                                    scope.decimals,
                                  )}
                                  <div className="muted">
                                    {activeCase.supplierMembers.length}:
                                    {activeCase.ledgerMembers.length}
                                    {t.app.results.caseMembers}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`status ${match ? 'good' : 'warn'}`}
                                  >
                                    {
                                      t.app.results.status[
                                        match
                                          ? match.kind === 'auto'
                                            ? 'auto'
                                            : 'manual'
                                          : activeCase.classification ===
                                              'AMOUNT_VARIANCE'
                                            ? 'amountVariance'
                                            : activeCase.classification ===
                                                'PAYMENT_CANDIDATE'
                                              ? 'paymentCandidate'
                                              : activeCase.status === 'Rejected'
                                                ? 'rejected'
                                                : activeCase.status ===
                                                    'Needs Review'
                                                  ? 'needsReview'
                                                  : 'unmatched'
                                      ]
                                    }
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!!busy}
                                    onClick={() => setSelected(tx.id)}
                                  >
                                    {t.app.results.caseDetails}
                                  </Button>
                                  {auditEvents.some(
                                    (e) =>
                                      e.action === 'review' &&
                                      e.ids.includes(tx.id),
                                  ) && (
                                    <small>
                                      {t.app.results.reviewedStillOpen}
                                    </small>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {!rows.length && (
                      <div className="empty">{t.app.results.empty}</div>
                    )}
                    <div className="surface-footer">
                      <span>
                        {t.app.results.pageSummary(
                          rows.length,
                          page + 1,
                          Math.max(1, Math.ceil(rows.length / 30)),
                        )}
                      </span>
                      <Pagination
                        aria-label={t.app.results.pagination}
                        style={{ width: 'auto', margin: 0 }}
                      >
                        <PaginationContent>
                          <PaginationItem>
                            <Button
                              variant="ghost"
                              aria-label={t.app.results.previousPage}
                              disabled={page === 0}
                              onClick={() => setPage((p) => p - 1)}
                            >
                              <BackArrow size={16} />
                            </Button>
                          </PaginationItem>
                          <PaginationItem>
                            <Button
                              variant="ghost"
                              aria-label={t.app.results.nextPage}
                              disabled={(page + 1) * 30 >= rows.length}
                              onClick={() => setPage((p) => p + 1)}
                            >
                              <ForwardArrow size={16} />
                            </Button>
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  </section>
                  {selected && (
                    <TransactionReview
                      key={selected}
                      result={result}
                      id={selected}
                      busy={!!busy}
                      onClose={() => setSelected('')}
                      onLink={(d) =>
                        void reconcile([...decisions, d], rejected, {
                          action: 'link',
                          ids: [d.supplierId, d.ledgerId],
                          note: d.note,
                        })
                      }
                      onUnlink={(a, b, note) => {
                        const match = result.matches.find(
                          (m) => m.supplierId === a && m.ledgerId === b,
                        );
                        if (match?.reviewedAggregate) {
                          setSelected('');
                          setMainOverlapOpen(true);
                          return;
                        }
                        const ids = match
                          ? [
                              ...(match.supplierIds ?? [a]),
                              ...(match.ledgerIds ?? [b]),
                            ]
                          : [a, b];
                        void reconcile(
                          decisions.filter((d) => d.supplierId !== a),
                          [...rejected, `${a}|${b}`],
                          { action: 'unlink', ids, note },
                        );
                      }}
                      onGroupReview={() => { setSelected(''); setMainOverlapOpen(true); }}
                      onReview={(id, note) => {
                        setAuditEvents((events) => [
                          ...events,
                          {
                            time: new Date().toISOString(),
                            action: 'review',
                            ids: [id],
                            note,
                          },
                        ]);
                        setReview((r) => ({ ...r, checked: false }));
                        setNotice(uiText((m) => m.app.notices.reviewRecorded),);
                      }}
                    />
                  )}
                  <div
                    className="actions"
                    style={{ justifyContent: 'flex-end', marginTop: 20 }}
                  >
                    <Button disabled={!!busy} onClick={() => setStep(3)}>
                      {t.app.results.prepareWorkpaper}
                      <ForwardArrow size={16} />
                    </Button>
                  </div>
                </>
              )}
              {step === 3 && (
                <div className="stack">
                  {result.scope.coverageConfirmed || result.bridge ? (
                    <section className="surface pad stack">
                      <div className="section-heading" style={{ padding: 0 }}>
                        <h2>{t.app.finish.balancesHeading}</h2>
                        <FileCheck2 size={23} />
                      </div>
                      <div className="balance-lines">
                        <div>
                          <span>{t.app.finish.supplierBalance}</span>
                          <bdi>
                            {result.supplier.closing === null
                              ? t.app.finish.notAvailable
                              : money(result.supplier.closing, scope.decimals,)}
                          </bdi>
                        </div>
                        <div>
                          <span>{t.app.finish.ledgerBalance}</span>
                          <bdi>
                            {result.ledger.closing === null
                              ? t.app.finish.notAvailable
                              : money(result.ledger.closing, scope.decimals)}
                          </bdi>
                        </div>
                        <div>
                          <span>{t.app.finish.balanceCheck}</span>
                          <span>
                            {result.bridge
                              ? result.balanceComparable
                                ? t.app.finish.consistentConfirmed
                                : t.app.finish.consistentUnconfirmed
                              : t.app.finish.notProven}
                          </span>
                        </div>
                        {result.bridge && (
                          <>
                            <hr className="divider" />
                            <div>
                              <span>{t.app.finish.openingAdjustment}</span>
                              <bdi>
                                {money(
                                  result.bridge.openingAdjustment,
                                  scope.decimals,
                                )}
                              </bdi>
                            </div>
                            <div>
                              <span>{t.app.finish.itemAdjustment}</span>
                              <bdi>
                                {money(
                                  result.bridge.itemAdjustment,
                                  scope.decimals,
                                )}
                              </bdi>
                            </div>
                            <div>
                              <span>{t.app.finish.adjusted}</span>
                              <bdi>
                                {money(result.bridge.adjusted, scope.decimals,)}
                              </bdi>
                            </div>
                            <div>
                              <span>{t.app.finish.residual}</span>
                              <bdi>
                                {money(result.bridge.residual, scope.decimals,)}
                              </bdi>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="notice">
                        {t.app.finish.bridgeLead}{' '}
                        {result.supplierOnly.length + result.ledgerOnly.length}{' '}
                        {t.app.finish.bridgeTrail}
                      </div>
                    </section>
                  ) : (
                    <p className="hint">{t.app.finish.noBalances}</p>
                  )}
                  <section className="surface pad stack">
                    <h2>{t.app.finish.notesHeading}</h2>
                    <Field label={t.app.finish.reviewerField}>
                      <Input
                        aria-label={t.app.finish.reviewerLabel}
                        value={review.name}
                        onChange={(e) =>
                          setReview((r) => ({
                            ...r,
                            name: e.target.value,
                            checked: false,
                          }))
                        }
                      />
                    </Field>
                    <Field label={t.app.finish.notesField}>
                      <Textarea
                        aria-label={t.app.finish.notesLabel}
                        value={review.notes}
                        maxLength={3000}
                        onChange={(e) =>
                          setReview((r) => ({
                            ...r,
                            notes: e.target.value,
                            checked: false,
                          }))
                        }
                      />
                    </Field>
                    <Tick
                      checked={review.checked}
                      onChange={(v) => {
                        if (v && !review.name.trim()) {
                          setError(
                            uiText((m) => m.app.errors.reviewerRequired),
                          );
                          return;
                        }
                        setReview((r) => ({ ...r, checked: v }));
                      }}
                    >
                      {t.app.finish.attestation}
                    </Tick>
                    <p className="muted">{t.app.finish.contents}</p>
                    <div className="actions">
                      <Button onClick={() => void download()} disabled={!!busy}>
                        <Download size={17} />
                        {reading.partial
                          ? t.app.finish.downloadPartial
                          : review.checked
                            ? t.app.finish.download
                            : t.app.finish.downloadDraft}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setStep(2)}
                        disabled={!!busy}
                      >
                        {t.app.finish.backToReview}
                      </Button>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="footnote">
            {t.app.shell.footnote}
            <br />
            <button
              onClick={togglePrivacy}
              aria-expanded={privacy}
              style={{ textDecoration: 'underline', marginTop: 8 }}
            >
              <CircleHelp
                size={13}
                style={{ display: 'inline', marginInlineEnd: 5 }}
              />
              {t.app.shell.footnotePrivacy}
            </button>{' '}
            · {APP_VERSION}
          </footer>
        </div>
        {showLanding && <LandingDetails />}
      </main>
      <footer className="site-footer">
        <a
          className="brand footer-brand"
          href={showLanding ? '#top' : '#reconciliation'}
          aria-label={t.brand.name}
        >
          <BrandMark />
          <BrandWordmark />
        </a>
        <p>{t.app.shell.tagline}</p>
        {showLanding ? (
          <a className="footer-privacy-link" href="#privacy-details">
            {t.app.shell.footerPrivacy}
          </a>
        ) : (
          <button className="footer-privacy-link" onClick={togglePrivacy}>
            {t.app.shell.footerPrivacy}
          </button>
        )}
      </footer>
    </div></>
  );
}
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function SourceConfiguration({
  file,
  mapping,
  proposalScopeKey,
  side,
  onChange,
  validation,
  onNotice,
  onError,
  onPdfApply,
  onPdfDraftChange,
  formats,
  formatChoices,
  onFormatChange,
  balanceMode,
  directionConfirmed,
}: {
  file: SourceFile;
  mapping: Mapping;
  proposalScopeKey: string;
  side: number;
  onChange: (p: Partial<Mapping>) => void;
  validation?: SourceResult;
  onNotice: (message: UiText) => void;
  onError: (message: UiText) => void;
  onPdfApply: (cuts: number[]) => void;
  onPdfDraftChange: (pending: boolean) => void;
  formats?: FormatSuggestions;
  formatChoices: FormatChoices;
  onFormatChange: (field: 'dateFormat' | 'numberFormat', value: string) => void;
  balanceMode: boolean;
  directionConfirmed: boolean;
}) {
  const { t, say } = useI18n();
  const c = t.app.source;
  const sheet = file.sheets[mapping.sheet];
  const header = sheet ? headerLabels(sheet, mapping.header) : [];
  const columns: [string, string][] = [
    ['-1', c.unset],
    ...header.map(
      (h, i) =>
        [String(i), `${i + 1} · ${h || c.untitled}`] as [string, string],
    ),
  ];
  const [open, setOpen] = useState(false);
  const [excludeRow, setExcludeRow] = useState('');
  const [excludeReason, setExcludeReason] = useState('');
  const initialSelection = useMemo(
    () => selectImportMapping(file, side === 0 ? 'supplier' : 'ledger'),
    [file, side],
  );
  const importIssues = useMemo(
    () => getMappedImportIssues(file, mapping),
    [file, mapping],
  );
  // An ambiguity stays on screen after it is resolved, showing the recorded
  // choice, so the reading the comparison used is never hidden.
  const ambiguous = (['dateFormat', 'numberFormat'] as const).filter(
    (field) => formats?.[field].status === 'ambiguous',
  );
  // Show just the missing essentials; detailed configuration remains optional.
  const missingColumns =
    mapping.date < 0 ||
    (mapping.mode === 'signed'
      ? mapping.amount < 0
      : mapping.debit < 0 || mapping.credit < 0);

  function col(
    key:
      | 'date'
      | 'reference'
      | 'description'
      | 'amount'
      | 'debit'
      | 'credit'
      | 'currencyColumn',
    label: string,
  ) {
    return (
      <Choice
        label={label}
        value={String(mapping[key])}
        options={columns}
        onChange={(v) => onChange({ [key]: Number(v) })}
      />
    );
  }
  if (file.visual) {
    return ( <section className="surface pad stack visual-accounting-bound">
      <h2>{t.app.sides[side]}</h2>
      <p className="summary-line"><bdi>{file.name}</bdi></p>
      <strong>{t.visualAccounting.loaded}</strong>
      <p className="hint">{t.visualAccounting.locked}</p>
      <p className="hint">{t.visualAccounting.limits}</p>
      {importIssues.length > 0 && ( <output style={{ display: 'block' }} className="hint warn">
        <strong>{c.readingNotes(importIssues.length)}</strong>
        {importIssues.slice(0,5).map((issue,index)=> (<p key={index}>{c.issueAt(issue.row,issue.column)}{issue.messages.map((message)=>say(engineText(message))).join(t.common.listSeparator)}</p>))}
      </output>
        )}
      <details><summary>{t.visualAccounting.details}</summary>
        <div className="table-scroll"><table><thead><tr>{header.map((h,i)=> (<th key={i}>{h}</th>
                  ))}</tr></thead>
          <tbody>{sheet.rows.slice(1).map((row,i)=> (<tr key={i}>{row.map((cell,j)=> (<td key={j}><bdi>{cell}</bdi></td>))}</tr>
                ))}</tbody></table></div>
      </details>
    </section>
    );
  }
  if (!sheet) {
    return (
      <section className="surface pad stack">
        <div className="summary-head">
          <div>
            <h2>{t.app.sides[side]}</h2>
            <p className="summary-line">
              <bdi>{file.name}</bdi>
            </p>
          </div>
        </div>
        <output style={{ display: 'block' }} className="hint warn">
          {say(engineText(initialSelection.notice))}
        </output>
        <Choice
          label={c.sheetField}
          value="-1"
          options={[
            ['-1', c.sheetChoose],
            ...file.sheets.map(
              (s, i) => [String(i), s.name] as [string, string],
            ),
          ]}
          onChange={(v) => {
            if (Number(v) >= 0) onChange(inferMapping(file, Number(v)));
          }}
        />
      </section>
    );
  }
  // "التاريخ date" reads well; "التاريخ التاريخ" does not. When a column's own
  // heading already is the label, name it once.
  const columnName = (index: number) =>
    index >= 0 ? header[index] || c.column(index + 1) : c.unset;
  const named = (label: string, index: number) => {
    const name = columnName(index);
    return name.trim() === label ? (
      <strong>{label}</strong>
    ) : (
      <>
        {label} <strong>{name}</strong>
      </>
    );
  };
  return (
    <section className="surface pad stack">
      <div className="summary-head">
        <div>
          <h2>{t.app.sides[side]}</h2>
          <p className="summary-line">
            <bdi>{file.name}</bdi>
            {file.sheets.length > 1 && (
              <>
                {' · '}
                <bdi>{sheet.name}</bdi>
              </>
            )}
            {' · '}
            {named(c.date, mapping.date)}
            {' · '}
            {mapping.mode === 'signed' ? (
              <>{named(c.amount, mapping.amount)}</>
            ) : (
              <>
                {named(c.debit, mapping.debit)} /{' '}
                {named(c.credit, mapping.credit)}
              </>
            )}
            {mapping.reference >= 0 && (
              <>
                {' · '}
                {named(c.reference, mapping.reference)}
              </>
            )}
          </p>
          {(mapping.mode === 'signed' || directionConfirmed) && (
            <p className="hint">
              {c.sentence(
                mapping.mode === 'signed'
                  ? mapping.multiplier === 1
                    ? c.positiveIncreases
                    : c.negativeIncreases
                  : mapping.multiplier === 1
                    ? c.debitIncreases
                    : c.creditIncreases,
              )}{' '}
              <button
                type="button"
                className="inline-link"
                onClick={() =>
                  onChange({ multiplier: (mapping.multiplier * -1) as 1 | -1 })
                }
              >
                {c.flipDirection}
              </button>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={c.edit(side)}
        >
          <Pencil size={14} />
          {open ? t.app.scope.close : t.app.scope.advanced}
        </Button>
      </div>
      {mapping.mode === 'split' && !mapping.directionEvidence && (
        <Choice
          label={c.directionField}
          value={directionConfirmed ? String(mapping.multiplier) : ''}
          options={[
            ['', c.directionChoose],
            ['1', c.directionDebit],
            ['-1', c.directionCredit],
          ]}
          onChange={(value) => {
            if (value) onChange({ multiplier: Number(value) as 1 | -1 });
          }}
        />
      )}
      {mapping.reference < 0 && <p className="hint">{c.noReferenceColumn}</p>}
      {(missingColumns || mapping.reference < 0) && (
        <ImportAssistant
          key={JSON.stringify([
            proposalScopeKey,
            file.sha256,
            file.name,
            file.pdf,
            mapping,
          ])}
          file={file}
          mapping={mapping}
          onApply={onChange}
        />
      )}
      {initialSelection.kind === 'workpaper' && (
        <output style={{ display: 'block' }} className="hint">
          {say(engineText(initialSelection.notice))}
        </output>
      )}
      {file.pdf && (
        <PdfReview
          file={file}
          header={mapping.header}
          reviewed={mapping.pdfReviewed === true}
          onReviewedChange={(v) => onChange({ pdfReviewed: v })}
          onApply={onPdfApply}
          onDraftChange={onPdfDraftChange}
        />
      )}
      {ambiguous.map((field) => (
        <div className="panel stack" key={field}>
          <p className={formatChoices[field] ? 'hint' : 'hint warn'}>
            {formatChoices[field] ? c.chosenFormat : ''}
            {say(engineText(formats![field].reason))}
          </p>
          <Choice
            label={
              field === 'dateFormat'
                ? c.dateFormatIn(side)
                : c.numberFormatIn(side)
            }
            value={formatChoices[field] ? mapping[field] : ''}
            onChange={(value) => onFormatChange(field, value)}
            options={[
              ['', c.interpretationChoose],
              ...formats![field].candidates.map(
                (value) =>
                  [
                    value,
                    field === 'dateFormat'
                      ? t.app.dateFormats[value as Mapping['dateFormat']]
                      : numberLabels[value as Mapping['numberFormat']],
                  ] as [string, string],
              ),
            ]}
          />
        </div>
      ))}
      {(['dateFormat', 'numberFormat'] as const)
        .filter((field) => formats?.[field].status === 'invalid')
        .map((field) => (
          <output
            style={{ display: 'block' }} className="hint warn" key={field}>
            {say(engineText(formats![field].reason))}
          </output>
        ))}
      {!!validation?.errors.length && (
        <div className="panel stack">
          <output style={{ display: 'block' }} className="hint warn">
            {t.app.readingIssues.partial}
          </output>
          <ReadingIssueList
            entries={[
              {
                source: validation,
                file,
                side: side === 0 ? 'supplier' : 'ledger',
              },
            ]}
          />
        </div>
      )}
      {missingColumns && !open && (
        <div className="panel stack">
          <p className="hint warn">{c.missingColumns}</p>
          <div className="form-grid">
            {mapping.date < 0 && col('date', c.dateColumn)}
            {mapping.mode === 'signed' ? (
              mapping.amount < 0 && col('amount', c.amountColumn)
            ) : (
              <>
                {mapping.debit < 0 && col('debit', c.debitColumn)}
                {mapping.credit < 0 && col('credit', c.creditColumn)}
              </>
            )}
          </div>
        </div>
      )}
      {open && (
        <div className="panel stack">
          {mapping.directionEvidence && (
            <p className="hint">
              {say(engineText(mapping.directionEvidence.reason))}
            </p>
          )}
          {missingColumns && <p className="hint warn">{c.missingHint}</p>}
          <div className="form-grid">
            {file.sheets.length > 1 && (
              <Choice
                label={c.sheet}
                value={String(mapping.sheet)}
                options={file.sheets.map((s, i) => [String(i), s.name])}
                onChange={(v) => onChange(inferMapping(file, Number(v)))}
              />
            )}
            <Field label={c.headerRow}>
              <Input
                type="number"
                min={1}
                max={sheet.rows.length}
                aria-label={c.headerRowLabel(side)}
                value={mapping.header + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= sheet.rows.length)
                    onChange(inferMapping(file, mapping.sheet, n - 1));
                }}
              />
            </Field>
            <Choice
              label={c.amountMode}
              value={mapping.mode}
              options={[
                ['signed', c.signed],
                ['split', c.split],
              ]}
              onChange={(v) => onChange({ mode: v as Mapping['mode'] })}
            />
            {col('date', c.dateColumn)}
            {col('reference', c.referenceColumn)}
            {mapping.mode === 'signed' ? (
              col('amount', c.amountColumn)
            ) : (
              <>
                {col('debit', c.debitColumn)}
                {col('credit', c.creditColumn)}
              </>
            )}
            {col('description', c.descriptionColumn)}
            {col('currencyColumn', c.currencyColumn)}
          </div>
          <details>
            <summary>{c.preview}</summary>
            <div className="preview">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{c.previewRow}</TableHead>
                    {header.map((h, i) => (
                      <TableHead key={i}>
                        {i + 1} · {h || c.untitled}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sheet.rows
                    .slice(mapping.header + 1, mapping.header + 7)
                    .map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{mapping.header + i + 2}</TableCell>
                        {r.map((v, j) => (
                          <TableCell key={j}>
                            <bdi>{v.slice(0, 80)}</bdi>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </details>
          <details>
            <summary>{c.readingSettings}</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Choice
                label={c.reportType}
                value={mapping.reportType}
                options={[
                  ['transactions', c.transactions],
                  ['open-items', c.openItems],
                ]}
                onChange={(v) =>
                  onChange({ reportType: v as Mapping['reportType'] })
                }
              />
              <Choice
                label={c.direction}
                value={String(mapping.multiplier)}
                options={
                  mapping.mode === 'signed'
                    ? [
                        ['1', c.positiveIncreases],
                        ['-1', c.negativeIncreases],
                      ]
                    : [
                        ['1', c.debitIncreases],
                        ['-1', c.creditIncreases],
                      ]
                }
                onChange={(v) => onChange({ multiplier: Number(v) as 1 | -1 })}
              />
              <Choice
                label={c.numberFormat}
                value={mapping.numberFormat}
                options={[
                  ['dot', c.decimalPoint],
                  ['comma', c.decimalComma],
                ]}
                onChange={(v) => onFormatChange('numberFormat', v)}
              />
              <Choice
                label={c.dateFormat}
                value={mapping.dateFormat}
                options={[
                  ['ymd', t.app.dateFormats.ymd],
                  ['dmy', t.app.dateFormats.dmy],
                  ['mdy', t.app.dateFormats.mdy],
                ]}
                onChange={(v) => onFormatChange('dateFormat', v)}
              />
            </div>
            <div className="actions" style={{ marginTop: 14 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  try {
                    localStorage.setItem(
                      `mizan.mapping.${side}.v1`,
                      JSON.stringify(mappingTemplate(mapping)),
                    );
                    onNotice(uiText((m) => m.app.notices.templateSaved));
                  } catch {
                    onError(uiText((m) => m.app.errors.templateSave));
                  }
                }}
              >
                {c.saveTemplate}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const template = getTemplate(side);
                  if (
                    !template ||
                    template.sheet === undefined ||
                    template.header === undefined ||
                    !file.sheets[template.sheet] ||
                    template.header >= file.sheets[template.sheet].rows.length
                  ) {
                    onError(uiText((m) => m.app.errors.noTemplate));
                    return;
                  }
                  onChange(template);
                  onNotice(uiText((m) => m.app.notices.templateRestored));
                }}
              >
                {c.restoreTemplate}
              </Button>
            </div>
          </details>
          <details open={importIssues.length > 0}>
            <summary>
              {c.exclude}
              {importIssues.length > 0
                ? c.readingNotes(importIssues.length)
                : ''}
            </summary>
            <div className="stack" style={{ marginTop: 12 }}>
              {importIssues.slice(0, 5).map((issue, index) => (
                <p
                  className="muted"
                  key={`${issue.row}:${issue.column ?? 0}:${index}`}
                >
                  {c.issueAt(issue.row, issue.column)}
                  {issue.messages
                    .map((message) => say(engineText(message)))
                    .join(t.common.listSeparator)}
                </p>
              ))}
              {validation && (
                <p className="muted">
                  {c.counts(
                    validation.transactions.length,
                    validation.excluded.length,
                    validation.errors.length,
                  )}
                </p>
              )}
              <div className="form-grid">
                <Field label={c.rowNumber}>
                  <Input
                    type="number"
                    min={mapping.header + 2}
                    max={sheet.rows.length}
                    aria-label={c.rowNumberLabel(side)}
                    value={excludeRow}
                    onChange={(e) => setExcludeRow(e.target.value)}
                  />
                </Field>
                <Field label={c.reason}>
                  <Input
                    aria-label={c.reasonLabel(side)}
                    value={excludeReason}
                    onChange={(e) => setExcludeReason(e.target.value)}
                    maxLength={200}
                  />
                </Field>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const n = Number(excludeRow);
                  if (
                    !Number.isInteger(n) ||
                    n <= mapping.header + 1 ||
                    n > sheet.rows.length ||
                    !excludeReason.trim()
                  ) {
                    onError(uiText((m) => m.app.errors.excludeInvalid));
                    return;
                  }
                  onChange({
                    excluded: {
                      ...mapping.excluded,
                      [String(n)]: excludeReason.trim(),
                    },
                  });
                  setExcludeRow('');
                  setExcludeReason('');
                }}
              >
                {c.excludeRow}
              </Button>
              {Object.entries(mapping.excluded).map(([row, reason]) => (
                <div className="actions" key={row}>
                  <span className="muted">
                    {c.row(Number(row))}
                    {reason}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const e = { ...mapping.excluded };
                      delete e[row];
                      onChange({ excluded: e });
                    }}
                  >
                    {c.reinclude}
                  </Button>
                </div>
              ))}
            </div>
          </details>
          {balanceMode && (
            <div className="stack">
              <strong>{c.balances}</strong>
              <div className="form-grid">
                {mapping.reportType === 'transactions' && (
                  <>
                    <Field label={c.periodStart}>
                      <Input
                        type="date"
                        aria-label={c.periodStartLabel(side)}
                        value={mapping.periodStart}
                        onChange={(e) =>
                          onChange({ periodStart: e.target.value })
                        }
                      />
                    </Field>
                    <Field label={c.opening}>
                      <Input
                        dir="ltr"
                        aria-label={c.openingLabel(side)}
                        value={mapping.opening}
                        onChange={(e) => onChange({ opening: e.target.value })}
                      />
                    </Field>
                  </>
                )}
                <Field label={c.closing}>
                  <Input
                    dir="ltr"
                    aria-label={c.closingLabel(side)}
                    value={mapping.closing}
                    onChange={(e) => onChange({ closing: e.target.value })}
                  />
                </Field>
              </div>
              <p className="hint">{c.manualBalances}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
