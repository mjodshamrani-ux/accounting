import type { restoreSession } from '@/lib/reconciliation/session';
import { VisualReader } from '@/components/visual-reader';
import { BrandMark, BrandWordmark, DisplayHeading } from '@/components/brand';
import {
  LandingIntro,
  LandingDetails,
  LandingBenefits,
} from '@/components/landing';
import { SourceUpload } from '@/components/source-upload';
import { APP_VERSION } from '@/lib/brand';
import { TransactionReview } from '@/components/transaction-review';
import { PdfReview } from '@/components/pdf-review';
import type { AuditEvent } from '@/lib/reconciliation/types';
import { AccountingAssistant } from '@/components/accounting-assistant';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ShieldCheck,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
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
import { ImportAssistant } from '@/components/import-assistant';
import { ImportDiagnosticError } from '@/lib/reconciliation/import-diagnostics';
import type { ImportDiagnosis } from '@/lib/reconciliation/import-diagnostics';
import { defaultMapping, MAX_FILE_BYTES } from '@/lib/reconciliation/types';
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
const sideNames = ['كشف المورد', 'تقرير الحسابات الدائنة'];
const scopeLabels: Record<ScopeSuggestionField, string> = {
  supplier: 'المورد',
  entity: 'الجهة القانونية',
  account: 'الحساب',
  currency: 'العملة',
  cutoff: 'تاريخ المقارنة',
};
const dateLabels = {
  ymd: 'سنة / شهر / يوم',
  dmy: 'يوم / شهر / سنة',
  mdy: 'شهر / يوم / سنة',
};
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
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (s: string) => void;
}) {
  return (
    <Field label={label}>
      <Select
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
export default function App() {
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
  const scopeEdited = useRef<
    Partial<Record<ScopeSuggestionField | 'decimals', boolean>>
  >({});
  const [formatChoices, setFormatChoices] = useState(freshFormatChoices);
  const directionEdited = useRef<[boolean, boolean]>([false, false]);
  const [pdfDrafts, setPdfDrafts] = useState<[boolean, boolean]>([
    false,
    false,
  ]);
  const directionProofs = useMemo(
    () =>
      files.map((file, i) =>
        file
          ? inferStatementDirection(file, mappings[i], scope.decimals)
          : undefined,
      ),
    [files, mappings, scope.decimals],
  );
  useEffect(() => {
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
          !directionEdited.current[i] &&
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
  }, [directionProofs]);
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
  useEffect(() => {
    setScope((previous) => {
      const next = { ...previous };
      for (const field of Object.keys(scopeLabels) as ScopeSuggestionField[]) {
        if (!scopeEdited.current[field])
          next[field] = scopeSuggestions.values[field] ?? initialScope[field];
      }
      // Rows after the cut-off are excluded, so defaulting to the latest date in
      // the sources excludes nothing and still lets the accountant narrow it.
      if (!scopeEdited.current.cutoff && !next.cutoff && !balanceMode)
        next.cutoff = latestDate;
      const changed = (Object.keys(scopeLabels) as ScopeSuggestionField[]).some(
        (field) => previous[field] !== next[field],
      );
      return changed
        ? { ...next, confirmed: false, coverageConfirmed: false }
        : previous;
    });
  }, [scopeSuggestions, latestDate, balanceMode]);
  useEffect(() => {
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
  }, [formatSuggestions, formatChoices, scope.currency]);
  const precisionMissing =
    !!scope.currency &&
    currencyPrecision(scope.currency) === undefined &&
    !scopeEdited.current.decimals;
  useEffect(() => {
    const precision = currencyPrecision(scope.currency);
    if (precision === undefined || scopeEdited.current.decimals) return;
    setScope((previous) =>
      previous.decimals === precision
        ? previous
        : {
            ...previous,
            decimals: precision,
            confirmed: false,
            coverageConfirmed: false,
          },
    );
  }, [scope.currency]);
  const scopeAutofillPending = (
    Object.keys(scopeLabels) as ScopeSuggestionField[]
  ).some((field) => {
    if (scopeEdited.current[field]) return false;
    let expected = scopeSuggestions.values[field] ?? initialScope[field];
    if (field === 'cutoff' && !expected && !balanceMode) expected = latestDate;
    return scope[field] !== expected;
  });
  const preparationPending =
    scopeAutofillPending ||
    directionProofs.some(
      (proof, i) =>
        proof &&
        !directionEdited.current[i] &&
        proof.multiplier !== mappings[i].multiplier,
    ) ||
    (!scopeEdited.current.decimals &&
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
      !directionEdited.current[i],
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
  const unresolvedScope = (
    Object.keys(scopeLabels) as ScopeSuggestionField[]
  ).filter(
    (field) =>
      scopeSuggestions.fields[field].status === 'conflict' &&
      !scopeEdited.current[field],
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
  const blocked = !files.every(Boolean)
    ? 'أضف الملفين أولًا.'
    : pdfDrafts.some(Boolean)
      ? 'احفظ تعديل أعمدة PDF أو تراجع عنه قبل المقارنة.'
      : mappings.some((m) => m.sheet < 0)
        ? 'اختر ورقة Excel التي تحتوي الحركات من بطاقة الملف.'
        : columnsMissing
          ? 'حدد عمود التاريخ وعمود المبلغ في بطاقة الملف أعلاه.'
          : !scope.cutoff
            ? 'حدد تاريخ المقارنة من «خيارات متقدمة» في بطاقة النطاق.'
            : !scope.currency
              ? 'حدد عملة الملفين من «خيارات متقدمة» في بطاقة النطاق.'
              : precisionMissing
                ? 'حدد المنازل العشرية للعملة من «خيارات متقدمة» في نطاق المقارنة.'
                : unresolvedScope.length
                  ? 'اختر القيمة الصحيحة للحقول المتعارضة من «خيارات متقدمة».'
                  : invalidFormats
                    ? 'تعذر التحقق من صيغة التواريخ أو المبالغ. صحح قراءة الأعمدة أو الصفوف المشار إليها قبل المقارنة.'
                    : unresolvedDirection
                      ? 'لم تكفِ الأرصدة لتحديد اتجاه المدين والدائن. اختر الاتجاه في بطاقة الملف.'
                      : unresolvedFormats
                        ? 'بعض التواريخ أو المبالغ تحتمل أكثر من قراءة. اختر الصيغة الصحيحة في بطاقة الملف.'
                        : pdfReviewPending
                          ? 'راجع البيانات المستخرجة من PDF ثم أكد المراجعة في بطاقة الملف.'
                          : balanceMode &&
                              (!scope.coverageConfirmed ||
                                !scope.supplier.trim() ||
                                !scope.entity.trim() ||
                                !scope.account.trim())
                            ? 'لتسوية الأرصدة، أضف أسماء الأطراف وأكد أن التقريرين يغطيان الفترة نفسها.'
                            : preparationPending
                              ? 'جارٍ تحديث إعدادات القراءة…'
                              : '';
  const [step, setStep] = useState(0);
  const workflowHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const showLanding = step === 0 && !files.some(Boolean);
  const previousLanding = useRef(showLanding);
  const privacyHeading = useRef<HTMLHeadingElement>(null);
  const privacyReturnFocus = useRef<HTMLElement | null>(null);
  // Open the panel when the confirmation step still needs a value, then leave it
  // to the accountant: it must not snap shut as the last field is filled.
  useEffect(() => {
    if (step === 1 && !preparationPending && (scopeNeedsInput || scopeConflict))
      setScopeOpen(true);
  }, [step, scopeNeedsInput, scopeConflict, preparationPending]);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [visualCandidate, setVisualCandidate] = useState<File | null>(null);
  const [visualRevision, setVisualRevision] = useState(0);
  const [importDiagnosis, setImportDiagnosis] =
    useState<ImportDiagnosis | null>(null);
  const [notice, setNotice] = useState('');
  const [validated, setValidated] = useState<
    [SourceResult, SourceResult] | null
  >(null);
  const [result, setResult] = useState<Comparison | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
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
      .catch(() => setError('تعذر تحميل المحرك المحلي. أعد المحاولة.'));
    return () => job.current?.controller.abort();
  }, []);
  useEffect(() => {
    if (!files.some(Boolean)) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
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
    setImportDiagnosis(null);
    setAuditEvents([]);
    setResult(null);
    setValidated(null);
    setDecisions([]);
    setRejected([]);
    setReview({ checked: false, name: '', notes: '' });
    setError('');
    setSelected('');
    setPage(0);
  }
  function updateScope(p: Partial<Scope>) {
    for (const field of Object.keys(scopeLabels) as ScopeSuggestionField[])
      if (field in p) scopeEdited.current[field] = true;
    if ('currency' in p) {
      scopeEdited.current.decimals = false;
      setFormatChoices(freshFormatChoices());
    }
    if ('decimals' in p) {
      scopeEdited.current.decimals = true;
      setFormatChoices(freshFormatChoices());
    }
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
      directionEdited.current[i] = false;
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
      directionEdited.current[i] = true;
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
    label: string,
    fn: (signal: AbortSignal, alive: () => boolean) => Promise<void>,
  ) {
    job.current?.controller.abort();
    const id = ++seq.current,
      controller = new AbortController();
    job.current = { id, controller };
    setBusy(label);
    setImportDiagnosis(null);
    setError('');
    setNotice('');
    const alive = () => job.current?.id === id && !controller.signal.aborted;
    try {
      await fn(controller.signal, alive);
    } catch (e) {
      if (alive()) {
        setImportDiagnosis(
          e instanceof ImportDiagnosticError ? e.diagnosis : null,
        );
        setError(e instanceof Error ? e.message : 'تعذر إكمال العملية');
      }
    } finally {
      if (job.current?.id === id) {
        setBusy('');
        job.current = null;
      }
    }
  }
  function cancel() {
    job.current?.controller.abort();
    job.current = null;
    setBusy('');
    setNotice('أُلغيت العملية.');
  }
  function loadDemo() {
    if (busy) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    invalidate();
    setDemo(true);
    directionEdited.current = [true, true];
    scopeEdited.current = {
      supplier: true,
      entity: true,
      account: true,
      currency: true,
      cutoff: true,
    };
    setFormatChoices(freshFormatChoices());
    setBalanceMode(false);
    setFiles(structuredClone(demoFiles));
    setMappings(structuredClone(demoMappings));
    setScope({ ...demoScope });
    setStep(1);
    setNotice(
      'هذا مثال للتجربة. راجع اتجاه المبالغ وإعدادات المقارنة قبل البدء.',
    );
  }
  async function loadFile(file: File | undefined, i: number) {
    if (!file || busy || !engineReady) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    await task('قراءة الملف على جهازك', async (signal, alive) => {
      if (file.size > MAX_FILE_BYTES)
        throw new Error('حجم الملف أكبر من 8 MB. اختر ملفًا أصغر.');
      const buffer = await file.arrayBuffer();
      if (!alive()) return;
      let parsed: SourceFile;
      try {
        parsed = await workerTask<SourceFile>(
          'read',
          { name: file.name, buffer, autoPdfColumns: true },
          signal,
        );
      } catch (failure) {
        if (alive() && failure instanceof ImportDiagnosticError)
          setVisualCandidate(file);
        throw failure;
      }
      if (!alive()) return;
      const selection = selectImportMapping(
        parsed,
        i === 0 ? 'supplier' : 'ledger',
      );
      directionEdited.current[i] = false;
      setPdfDrafts(
        (previous) =>
          previous.map((v, j) => (j === i ? false : v)) as [boolean, boolean],
      );
      invalidate();
      setDemo(false);
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
            j === i ? { ...selection.mapping, pdfReviewed: false } : m,
          ) as [Mapping, Mapping],
      );
      setScope((s) => ({ ...s, confirmed: false, coverageConfirmed: false }));
      setNotice(selection.notice);
    });
  }
  async function configurePdf(i: number, cuts: number[]) {
    const file = files[i];
    if (!file?.pdf || !file.original || busy) return;
    await task('إعادة قراءة أعمدة PDF على جهازك', async (signal, alive) => {
      const parsed = await workerTask<SourceFile>(
        'read',
        { name: file.name, buffer: file.original, pdfCuts: cuts },
        signal,
      );
      if (!alive()) return;
      invalidate();
      directionEdited.current[i] = false;
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
    });
  }
  async function reconcile(
    nextDecisions = decisions,
    nextRejected = rejected,
    event?: Omit<AuditEvent, 'time'>,
  ) {
    await task('فحص البيانات ومطابقة الحركات', async (signal, alive) => {
      // Enforce every preparation prerequisite at the executable entry point,
      // including PDF drafts and an unchosen split-column sign convention.
      if (blocked) throw new Error(blocked);
      if (!files[0] || !files[1])
        throw new Error('أضف كشف المورد وتقرير الحسابات قبل المقارنة.');
      if (preparationPending)
        throw new Error(
          'يجري تحديث إعدادات القراءة. انتظر اكتمالها ثم أعد المحاولة.',
        );
      if (precisionMissing)
        throw new Error(
          'هذه العملة غير مدرجة. حدد عدد منازلها العشرية قبل المقارنة.',
        );
      if (unresolvedFormats)
        throw new Error(
          'اختر الصيغة الصحيحة للتواريخ أو المبالغ التي تحتمل أكثر من قراءة.',
        );
      if (unresolvedScope.length)
        throw new Error(
          'تختلف بعض بيانات المقارنة بين الملفين. اختر القيم الصحيحة أولًا.',
        );
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
      const computed = await workerTask<{
        a: SourceResult;
        b: SourceResult;
        result: Comparison | null;
      }>('reconcile', payload, signal);
      if (!alive()) return;
      setValidated([computed.a, computed.b]);
      if (!computed.result) {
        setStep(1);
        throw new Error('توجد صفوف تحتاج تصحيحًا. راجع تفاصيل القراءة أدناه.');
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
      setReview((v) => ({ ...v, checked: false }));
      setStep(2);
      setSelected('');
      setPage(0);
    });
  }
  async function storeSession() {
    if (!files[0] || !files[1] || !result) return;
    await task('تجهيز ملف الجلسة', async (signal, alive) => {
      const buffer = await workerTask<ArrayBuffer>(
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
      setNotice(
        'ملف الجلسة يتضمن المصادر والملاحظات دون تشفير. احفظه في مكان خاص على جهازك.',
      );
    });
  }
  async function loadSession(file?: File) {
    if (!file || busy || files.some(Boolean)) return;
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    await task('التحقق من الجلسة وإعادة حسابها', async (signal, alive) => {
      if (file.size > 30 * 1024 * 1024)
        throw new Error('حجم ملف الجلسة أكبر من 30 MB. اختر ملف جلسة أصغر.');
      const saved = await workerTask<
        Awaited<ReturnType<typeof restoreSession>>
      >('restore-session', { buffer: await file.arrayBuffer() }, signal);
      if (!alive()) return;
      invalidate();
      directionEdited.current = [true, true];
      setPdfDrafts([false, false]);
      setFiles(saved.files);
      setMappings(saved.mappings);
      scopeEdited.current = {
        supplier: true,
        entity: true,
        account: true,
        currency: true,
        cutoff: true,
        decimals: true,
      };
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
      setReview(saved.review);
      setDemo(false);
      setStep(2);
      setNotice(
        'استعدنا الجلسة وأعدنا حساب النتائج من مصادرها. راجع النتيجة قبل تأكيدها.',
      );
    });
  }
  async function download() {
    if (!result) return;
    await task('إعداد ورقة العمل على جهازك', async (signal, alive) => {
      const buffer = await workerTask<ArrayBuffer>(
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
      setNotice(
        'ورقة العمل جاهزة. احفظها على جهازك وتأكد من ظهورها في التنزيلات.',
      );
    });
  }
  const skippedRows = result
    ? result.supplier.errors.length + result.ledger.errors.length
    : 0;
  // Every diagnostic stays in the export. On screen, drop the balance notes when
  // balances were never requested: repeating them three times was noise.
  const onScreenDiagnostics = (result?.diagnostics ?? []).filter(
    (d) =>
      !d.transactionIds.length &&
      d.code !== 'SKIPPED_ROWS' &&
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
  }, [result, tab, query, matchedBySupplier]);
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
            if (files.some(Boolean) || busy)
              throw new Error('Cannot replace an active session');
            loadDemo();
            return { status: 'synthetic-demo-opened' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [files, busy]);
  function reset() {
    setError('');
    setImportDiagnosis(null);
    setVisualCandidate(null);
    setVisualRevision((v) => v + 1);
    setResetOpen(false);
    cancel();
    invalidate();
    setFiles([null, null]);
    directionEdited.current = [false, false];
    setPdfDrafts([false, false]);
    setMappings([defaultMapping(), defaultMapping()]);
    scopeEdited.current = {};
    setFormatChoices(freshFormatChoices());
    setBalanceMode(false);
    setScope(initialScope);
    setDemo(false);
    setStep(0);
    setNotice('');
  }
  return (
    <div className={`app-shell ${showLanding ? 'has-landing' : 'in-session'}`}>
      <a className="skip-link" href="#reconciliation">
        الانتقال إلى مساحة العمل
      </a>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogTitle>بدء تسوية جديدة</AlertDialogTitle>
          <AlertDialogDescription>
            سيُمسح عمل الجلسة الحالية من المتصفح. نزّل ورقة العمل قبل البدء إذا
            أردت الاحتفاظ بالنتائج. الملفات التي سبق تنزيلها ستبقى على جهازك.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>متابعة الجلسة</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>
              مسح الجلسة والبدء من جديد
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <header className="topbar">
        <a
          className="brand"
          href={showLanding ? '#top' : '#reconciliation'}
          aria-label="تراصف — مساحة تسوية الموردين"
        >
          <BrandMark />
          <BrandWordmark />
        </a>
        {showLanding && (
          <nav className="site-nav" aria-label="التنقل الرئيسي">
            <a href="#how-it-works">كيف تعمل</a>
            <a href="#privacy">الخصوصية</a>
          </nav>
        )}
        <div className="topbar-actions">
          <button
            className="local-pill"
            aria-expanded={privacy}
            aria-controls={privacy ? 'privacy-info' : undefined}
            onClick={togglePrivacy}
          >
            <ShieldCheck size={16} /> <span>المعالجة على جهازك</span>
          </button>
          {showLanding && (
            <a className="nav-start" href="#reconciliation">
              ابدأ الآن <ArrowLeft size={15} />
            </a>
          )}
        </div>
      </header>
      <main>
        {showLanding && (
          <>
            <LandingIntro />
            <LandingBenefits />
          </>
        )}
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
                  حدود الخصوصية
                </h2>
                <Button
                  aria-label="إغلاق الخصوصية"
                  variant="ghost"
                  onClick={() => setPrivacy(false)}
                >
                  <X />
                </Button>
              </div>
              <p className="muted">
                تتم قراءة ملفاتك ومقارنة حركاتها وتصدير النتائج داخل متصفحك. لا
                نرسل الملفات أو أسماءها أو بياناتها إلى خادم معالجة، ولا نستخدم
                أدوات تتبع داخل التطبيق. قد تسجل شركة الاستضافة زيارة الموقع وفق
                سياستها. حماية جهازك وإضافات متصفحك خارج نطاق التطبيق.
              </p>
              <p className="muted">
                لا نحفظ معاملاتك تلقائيًا بين الجلسات. يمكنك حفظ قوالب للأعمدة
                وإعدادات القراءة دون بيانات مالية. بعد تحميل أدوات العمل، يمكنك
                إكمال الخطوات المحمّلة دون اتصال. تحتاج إلى الإنترنت لفتح الموقع
                من جديد.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    localStorage.removeItem('mizan.mapping.0.v1');
                    localStorage.removeItem('mizan.mapping.1.v1');
                    setNotice('مُسحت قوالب الأعمدة من هذا المتصفح.');
                  } catch {
                    setError(
                      'تعذر الوصول إلى القوالب المحفوظة. تحقق من سماح المتصفح بالتخزين المحلي.',
                    );
                  }
                }}
              >
                مسح القوالب المحفوظة
              </Button>
            </section>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> مساحة العمل / تسوية الموردين
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
              <p>
                {step === 0
                  ? 'أضف كشف المورد وتقرير حساباتك لمقارنة الحركات ومراجعة الفروق.'
                  : step === 1
                    ? 'راجع البيانات المستخرجة من الملفين وأكمل ما يحتاج تأكيدك.'
                    : step === 2
                      ? 'راجع الحركات ومصادرها وتأكد من سبب كل مطابقة.'
                      : 'نزّل ملف Excel يجمع النتائج ومصادرها وملاحظات المراجعة.'}
              </p>
            </div>
            <div className="stack">
              <span className="version-badge">
                نسخة تجريبية <bdi>{APP_VERSION}</bdi>
              </span>
              {files.some(Boolean) && (
                <Button
                  variant="ghost"
                  onClick={() => setResetOpen(true)}
                  disabled={!!busy}
                >
                  <RotateCcw size={15} />
                  تسوية جديدة
                </Button>
              )}
            </div>
          </div>
          <nav className="steps" aria-label="خطوات التسوية">
            <ol>
              {[
                'إضافة الملفات',
                'تأكيد البيانات',
                'مراجعة الفروق',
                'ورقة العمل',
              ].map((label, index) => (
                <li
                  key={label}
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
                        ? ' — مكتملة'
                        : index === step
                          ? ' — المرحلة الحالية'
                          : ' — لاحقًا'}
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
                style={{ display: 'inline', marginLeft: 8 }}
              />
              أنت تستخدم مثالًا للتجربة، وليس بيانات شركة أو معاملات حقيقية.
            </div>
          )}
          {!engineReady && !!error && (
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                void prepareWorker()
                  .then(() => setEngineReady(true))
                  .catch(() =>
                    setError(
                      'تعذر تشغيل أداة المقارنة. حدّث المتصفح ثم أعد المحاولة.',
                    ),
                  );
              }}
            >
              إعادة تشغيل المحرك
            </Button>
          )}
          {!engineReady && !error && (
            <div className="notice loading" role="status">
              <LoaderCircle className="spin" size={17} />
              جارٍ تجهيز أداة المقارنة…
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <div>
                <p>{error}</p>
                {importDiagnosis && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    توقفت القراءة عند الصفحة {importDiagnosis.page} من{' '}
                    {importDiagnosis.totalPages}:{' '}
                    {importDiagnosis.contentKind === 'mixed'
                      ? 'تحتوي الصفحة نصوصًا وصورًا.'
                      : importDiagnosis.contentKind === 'image-only'
                        ? 'تحتوي الصفحة صورًا ولا يظهر فيها نص يمكن قراءته مباشرة.'
                        : importDiagnosis.contentKind === 'native-text'
                          ? 'تحتوي الصفحة نصًا يمكن قراءته.'
                          : 'لم نجد نصًا يمكن قراءته، ولا نستطيع التأكد من محتوى الصفحة.'}{' '}
                    توقفت قراءة الملف حتى لا تدخل بيانات ناقصة في المقارنة. جرّب
                    نسخة Excel أو PDF نصية. مساعد الصور أدناه يتيح تجربة
                    القراءة، لكن مخرجاته مسودة لا تدخل في التسوية.
                  </p>
                )}
              </div>
            </div>
          )}
          {notice && (
            <div className="notice success" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="notice loading" role="status">
              <LoaderCircle className="spin" size={20} />
              {busy}
              <Button variant="ghost" onClick={cancel}>
                إلغاء
              </Button>
            </div>
          )}
          {step === 0 && (
            <>
              <section className="surface upload-surface">
                <div className="section-heading">
                  <div>
                    <h2>أضف ملفي التسوية</h2>
                    <p>مورد واحد · جهة واحدة · عملة واحدة</p>
                  </div>
                  <FileSpreadsheet size={23} />
                </div>
                <div className="file-grid">
                  {sideNames.map((label, side) => (
                    <SourceUpload
                      key={label}
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
                    <bdi>XLSX</bdi> · <bdi>CSV</bdi> · <bdi>PDF</bdi> نصي بلا صور
                  </span>
                  <span>
                    حتى <bdi>8 MB</bdi> للملف · <bdi>20</bdi> صفحة لـ
                    <bdi>PDF</bdi>
                  </span>
                  <span>
                    إذا كان الملف صورة، جرّب مساعد الصور أدناه. نتائجه مسودة غير
                    متحققة.
                  </span>
                </p>
                <div className="surface-footer">
                  <span>
                    <LockKeyhole size={16} />
                    لا تُرسل الملفات إلى خادم.
                  </span>
                  <Button
                    disabled={!files.every(Boolean) || !!busy}
                    onClick={() => setStep(1)}
                  >
                    تأكيد البيانات
                    <ArrowLeft size={17} />
                  </Button>
                </div>
              </section>
              <VisualReader
                key={`${visualRevision}:${visualCandidate ? `${visualCandidate.name}:${visualCandidate.lastModified}` : 'visual'}`}
                candidate={visualCandidate}
              />
              <div className="demo-strip">
                <div>
                  <FlaskConical size={23} />
                  <div>
                    <strong>جرّب بمثال جاهز</strong>
                    <p>
                      تعرّف على الخطوات باستخدام فواتير ومدفوعات وفروق جاهزة
                      للمراجعة.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={loadDemo}
                  disabled={!!busy || !engineReady}
                >
                  جرّب المثال
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
                    <h2>نطاق المقارنة</h2>
                    <p className="summary-line">
                      حتى{' '}
                      {scope.cutoff ? (
                        <strong>
                          <bdi dir="ltr">{scope.cutoff}</bdi>
                        </strong>
                      ) : (
                        <span className="gap">حدد التاريخ</span>
                      )}{' '}
                      ·{' '}
                      {scope.currency ? (
                        <strong>
                          <bdi dir="ltr">{scope.currency}</bdi>
                        </strong>
                      ) : (
                        <span className="gap">حدد العملة</span>
                      )}{' '}
                      · فرق الأيام المسموح {scope.dateWindow}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setScopeOpen(!scopeOpen)}
                    aria-expanded={scopeOpen}
                    aria-label="تعديل نطاق المقارنة"
                  >
                    <Pencil size={14} />
                    {scopeOpen ? 'إغلاق' : 'خيارات متقدمة'}
                  </Button>
                </div>
                {scopeNeedsInput && !scopeOpen && (
                  <p className="hint">
                    {!scope.cutoff && !scope.currency
                      ? 'لم نتمكن من تحديد تاريخ المقارنة والعملة. أضفهما من «خيارات متقدمة».'
                      : !scope.cutoff
                        ? 'لم نتمكن من تحديد تاريخ المقارنة. أضفه من «خيارات متقدمة».'
                        : !scope.currency
                          ? 'لم نتمكن من تحديد العملة. اخترها من «خيارات متقدمة».'
                          : 'حدد المنازل العشرية للعملة من «خيارات متقدمة» حتى تُقرأ المبالغ بدقة.'}
                  </p>
                )}
                {scopeConflict && !scopeOpen && (
                  <p className="hint warn" role="status">
                    قيمتان مختلفتان لـ
                    {unresolvedScope
                      .map((field) => scopeLabels[field])
                      .join('، ')}{' '}
                    بين الملفين. اختر القيمة الصحيحة من «خيارات متقدمة».
                  </p>
                )}
                {scopeOpen && (
                  <div className="panel stack">
                    <div className="form-grid">
                      <Field
                        label="المقارنة حتى تاريخ"
                        hint={
                          scopeSuggestions.fields.cutoff.status === 'suggested'
                            ? `مأخوذ من ${sideNames[scopeSuggestions.fields.cutoff.evidence[0].side === 'supplier' ? 0 : 1]}، صف ${scopeSuggestions.fields.cutoff.evidence[0].row}.`
                            : scope.cutoff && scope.cutoff === latestDate
                              ? 'استخدمنا آخر تاريخ في الملفين. الحركات بعد التاريخ المحدد لا تدخل في المقارنة.'
                              : 'الحركات بعد التاريخ المحدد لا تدخل في المقارنة.'
                        }
                      >
                        <Input
                          type="date"
                          aria-label="تاريخ المقارنة"
                          value={scope.cutoff}
                          onChange={(e) =>
                            updateScope({ cutoff: e.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="عملة الملفين"
                        hint={
                          scopeSuggestions.fields.currency.status ===
                          'suggested'
                            ? 'قرأنا العملة من عنوان واضح أو من عمود العملة.'
                            : 'أدخل رمزها بثلاثة أحرف، مثل SAR.'
                        }
                      >
                        <Input
                          aria-label="العملة"
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
                        label="المنازل العشرية للعملة"
                        value={precisionMissing ? '' : String(scope.decimals)}
                        onChange={(v) => {
                          if (v) updateScope({ decimals: Number(v) });
                        }}
                        options={[
                          ...(precisionMissing
                            ? ([['', 'اختر المنازل العشرية للعملة']] as [
                                string,
                                string,
                              ][])
                            : []),
                          ['0', 'دون منازل عشرية'],
                          ['2', 'منزلتان — مثل SAR'],
                          ['3', 'ثلاث منازل — مثل KWD'],
                        ]}
                      />
                      <Choice
                        label="فرق الأيام المسموح للمطابقة"
                        value={String(scope.dateWindow)}
                        onChange={(v) => updateScope({ dateWindow: Number(v) })}
                        options={Array.from(
                          { length: 8 },
                          (_, i) => [String(i), `${i} يوم`] as [string, string],
                        )}
                      />
                    </div>
                    <Tick
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
                      أريد تسوية الأرصدة أيضًا
                    </Tick>
                    {(balanceMode ||
                      unresolvedScope.some((field) =>
                        ['supplier', 'entity', 'account'].includes(field),
                      )) && (
                      <div className="form-grid">
                        <Field label="اسم المورد">
                          <Input
                            aria-label="المورد"
                            value={scope.supplier}
                            onChange={(e) =>
                              updateScope({ supplier: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="الجهة القانونية">
                          <Input
                            aria-label="الجهة القانونية"
                            value={scope.entity}
                            onChange={(e) =>
                              updateScope({ entity: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="الحساب أو الفروع المشمولة">
                          <Input
                            aria-label="نطاق الحساب"
                            value={scope.account}
                            onChange={(e) =>
                              updateScope({ account: e.target.value })
                            }
                          />
                        </Field>
                      </div>
                    )}
                    {(Object.keys(scopeLabels) as ScopeSuggestionField[]).some(
                      (field) => scopeSuggestions.fields[field].evidence.length,
                    ) && (
                      <details>
                        <summary>مصادر القيم المقترحة</summary>
                        <div className="stack" style={{ marginTop: 12 }}>
                          {(
                            Object.keys(scopeLabels) as ScopeSuggestionField[]
                          ).map(
                            (field) =>
                              scopeSuggestions.fields[field].evidence.length >
                                0 && (
                                <div key={field}>
                                  <strong>
                                    {scopeLabels[field]}
                                    {scopeSuggestions.fields[field].status ===
                                    'conflict'
                                      ? ' — تعارض'
                                      : ''}
                                  </strong>
                                  {scopeSuggestions.fields[field].evidence.map(
                                    (item, i) => (
                                      <p className="muted" key={i}>
                                        <bdi>{item.value}</bdi> —{' '}
                                        {
                                          sideNames[
                                            item.side === 'supplier' ? 0 : 1
                                          ]
                                        }
                                        ، <bdi>{item.sheet}</bdi>، صف {item.row}
                                      </p>
                                    ),
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
                        directionEdited.current[i] || !!directionProofs[i]
                      }
                      onPdfDraftChange={(pending) =>
                        setPdfDrafts((previous) =>
                          previous[i] === pending
                            ? previous
                            : (previous.map((v, j) =>
                                j === i ? pending : v,
                              ) as [boolean, boolean]),
                        )
                      }
                    />
                  ),
              )}
              <section className="surface pad stack">
                {pdfReviewPending && (
                  <p className="hint warn">
                    راجع البيانات المستخرجة من PDF ثم أكد المراجعة في بطاقة
                    الملف أعلاه.
                  </p>
                )}
                {balanceMode && (
                  <Tick
                    checked={scope.coverageConfirmed}
                    onChange={(v) => updateScope({ coverageConfirmed: v })}
                  >
                    راجعت تغطية التقريرين للفترة نفسها وتحققت من الأرصدة التي
                    أدخلتها. هذا التأكيد مطلوب عند تسوية الأرصدة فقط.
                  </Tick>
                )}
                <div className="actions">
                  <Button onClick={() => void reconcile()} disabled={!!blocked}>
                    تحقق وقارن
                    <ArrowLeft size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      invalidate();
                      setStep(0);
                    }}
                  >
                    العودة للملفات
                  </Button>
                </div>
                <p className="hint">
                  {blocked ||
                    'ببدء المقارنة، تؤكد أن الملفين يخصان المورد والجهة والحساب والعملة نفسها، وأن اتجاه المبالغ المعروض صحيح.'}
                </p>
              </section>
            </fieldset>
          )}
          {step === 0 && !files.some(Boolean) && (
            <section className="surface pad">
              <label>
                استئناف جلسة محفوظة على جهازك{' '}
                <input
                  type="file"
                  aria-label="استئناف جلسة محلية"
                  accept=".json"
                  disabled={!!busy || !engineReady}
                  onChange={(e) => {
                    void loadSession(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <p className="muted">
                نقرأ ملف الجلسة على جهازك ونعيد المقارنة من مصادره قبل استعادة
                العمل.
              </p>
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
                  حفظ الجلسة للمتابعة لاحقًا
                </Button>
                <span className="muted">
                  يتضمن ملف الجلسة بياناتك دون تشفير. احفظه في مكان خاص على
                  جهازك.
                </span>
              </div>
              <div className="metric-grid">
                <Metric
                  label="مطابقات آلية"
                  value={String(
                    result.matches.filter((m) => m.kind === 'auto').length,
                  )}
                  hint="حالات طابقها المحرك تلقائيًا"
                />
                <Metric
                  label="تأكيدات يدوية"
                  value={String(
                    result.matches.filter((m) => m.kind === 'manual').length,
                  )}
                  hint="مطابقات أكدها المراجع"
                />
                <Metric
                  label="حالات غير مطابقة"
                  value={String(result.caseCounts.unmatchedCases)}
                  hint={`عدد الحركات من الملفين: ${result.caseCounts.unmatchedSourceRows}`}
                />
                {result.scope.coverageConfirmed || result.bridge ? (
                  <Metric
                    label="فرق الأرصدة"
                    value={
                      result.bridge
                        ? money(result.bridge.delta, scope.decimals)
                        : '—'
                    }
                    hint={result.bridge ? scope.currency : 'لم نتحقق من الأرصدة'}
                  />
                ) : (
                  // With balances not requested, the number that matters is how
                  // much of the source never made it into the comparison.
                  <Metric
                    label="صفوف لم تُقرأ"
                    value={String(skippedRows)}
                    hint={
                      skippedRows
                        ? 'المقارنة غير مكتملة حتى تُراجع هذه الصفوف'
                        : 'لا توجد أخطاء قراءة متبقية والصفوف المستبعدة موثقة'
                    }
                  />
                )}
              </div>
              {skippedRows > 0 && (
                <div className="notice error" role="status">
                  {result.diagnostics
                    .filter((d) => d.code === 'SKIPPED_ROWS')
                    .map((d, i) => (
                      <p key={i}>{d.message}</p>
                    ))}
                  <p>
                    من «تعديل الإعدادات»، صحح بيانات المصدر أو استبعد الصف مع
                    توضيح السبب. تفاصيل أخطاء القراءة موجودة في ورقة Diagnostics
                    عند التصدير.
                  </p>
                </div>
              )}
              {result.scope.coverageConfirmed && !result.balanceComparable && (
                <div className="notice">
                  هذه مقارنة للحركات فقط. لم نتحقق من الأرصدة وتغطية الفترة
                  المشتركة، لذلك لا تمثل النتيجة تسوية أرصدة مكتملة.
                </div>
              )}
              {!!onScreenDiagnostics.length && (
                <div className="notice" role="status">
                  {onScreenDiagnostics.map((d, i) => (
                    <p key={i}>{d.message}</p>
                  ))}
                </div>
              )}
              <AccountingAssistant
                result={result}
                selectedId={selected || undefined}
              />
              {step === 2 && (
                <>
                  <section className="surface">
                    <div className="section-heading">
                      <div>
                        <h2>مساحة المراجعة</h2>
                        <p>
                          «دون مقابل» تعني أننا لم نجد الحركة في الملف الآخر. قد
                          تكون موجودة في النظام لكنها غير مشمولة في التقرير.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => {
                          invalidate();
                          setStep(1);
                        }}
                      >
                        تعديل الإعدادات
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
                          <TabsList aria-label="تصفية النتائج">
                            <TabsTrigger value="exceptions">
                              دون مقابل
                            </TabsTrigger>
                            <TabsTrigger value="matches">المطابقات</TabsTrigger>
                            <TabsTrigger value="ambiguities">
                              يحتاج مراجعة ({result.caseCounts.needsReviewCases}
                              )
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <div className="actions">
                          <Search size={16} />
                          <Input
                            style={{ width: 190 }}
                            aria-label="البحث في النتائج"
                            placeholder="مرجع أو وصف أو صف"
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
                            {[
                              'المصدر / الصف',
                              'التاريخ',
                              'المرجع',
                              'المبلغ',
                              'الحالة',
                              'المراجعة',
                            ].map((h) => (
                              <TableHead key={h}>{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.slice(page * 30, (page + 1) * 30).map((t) => {
                            const activeCase = result.cases.find((c) =>
                              c.sourceTrace.some(
                                (trace) => trace.sourceRowId === t.id,
                              ),
                            )!;
                            const match =
                              t.side === 'supplier'
                                ? matchedBySupplier.get(t.id)
                                : undefined;
                            return (
                              <TableRow key={t.id}>
                                <TableCell>
                                  {t.side === 'supplier' ? 'المورد' : 'الدفتر'}{' '}
                                  · {t.row}
                                </TableCell>
                                <TableCell className="mono">{t.date}</TableCell>
                                <TableCell>
                                  <bdi>{t.reference || 'بلا مرجع'}</bdi>
                                  <div className="muted">
                                    {t.description.slice(0, 55)}
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
                                    {activeCase.ledgerMembers.length} حركات
                                    مرتبطة بالحالة
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span
                                    className={`status ${match ? 'good' : 'warn'}`}
                                  >
                                    {match
                                      ? match.kind === 'auto'
                                        ? 'مطابقة آلية'
                                        : 'تأكيد يدوي'
                                      : activeCase.classification ===
                                          'AMOUNT_VARIANCE'
                                        ? 'فرق مبلغ'
                                        : activeCase.classification ===
                                            'PAYMENT_CANDIDATE'
                                          ? 'مجموعة مقترحة للمطابقة'
                                          : activeCase.status === 'Rejected'
                                            ? 'اقتراح مرفوض'
                                            : activeCase.status ===
                                                'Needs Review'
                                              ? 'يحتاج مراجعة'
                                              : 'غير مطابق'}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!!busy}
                                    onClick={() => setSelected(t.id)}
                                  >
                                    تفاصيل الحالة
                                  </Button>
                                  {auditEvents.some(
                                    (e) =>
                                      e.action === 'review' &&
                                      e.ids.includes(t.id),
                                  ) && (
                                    <small>تمت مراجعته وما زال غير مطابق</small>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {!rows.length && (
                      <div className="empty">لا توجد حركات في هذه القائمة.</div>
                    )}
                    <div className="surface-footer">
                      <span>
                        عدد الحالات {rows.length} · الصفحة {page + 1} من{' '}
                        {Math.max(1, Math.ceil(rows.length / 30))}
                      </span>
                      <Pagination style={{ width: 'auto', margin: 0 }}>
                        <PaginationContent>
                          <PaginationItem>
                            <Button
                              variant="ghost"
                              aria-label="الصفحة السابقة"
                              disabled={page === 0}
                              onClick={() => setPage((p) => p - 1)}
                            >
                              <ArrowRight size={16} />
                            </Button>
                          </PaginationItem>
                          <PaginationItem>
                            <Button
                              variant="ghost"
                              aria-label="الصفحة التالية"
                              disabled={(page + 1) * 30 >= rows.length}
                              onClick={() => setPage((p) => p + 1)}
                            >
                              <ArrowLeft size={16} />
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
                      onUnlink={(a, b, note) =>
                        void reconcile(
                          decisions.filter((d) => d.supplierId !== a),
                          [...rejected, `${a}|${b}`],
                          { action: 'unlink', ids: [a, b], note },
                        )
                      }
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
                        setNotice(
                          'سجلنا مراجعتك للحالة. بقيت المطابقات والفروق كما هي.',
                        );
                      }}
                    />
                  )}
                  <div
                    className="actions"
                    style={{ justifyContent: 'flex-end', marginTop: 20 }}
                  >
                    <Button disabled={!!busy} onClick={() => setStep(3)}>
                      إعداد ورقة العمل
                      <ArrowLeft size={16} />
                    </Button>
                  </div>
                </>
              )}
              {step === 3 && (
                <div className="stack">
                  {result.scope.coverageConfirmed || result.bridge ? (
                    <section className="surface pad stack">
                      <div className="section-heading" style={{ padding: 0 }}>
                        <h2>الأرصدة وحالة التسوية</h2>
                        <FileCheck2 size={23} />
                      </div>
                      <div className="balance-lines">
                        <div>
                          <span>رصيد المورد</span>
                          <bdi>
                            {result.supplier.closing === null
                              ? 'غير متاح'
                              : money(result.supplier.closing, scope.decimals)}
                          </bdi>
                        </div>
                        <div>
                          <span>رصيد الدفتر</span>
                          <bdi>
                            {result.ledger.closing === null
                              ? 'غير متاح'
                              : money(result.ledger.closing, scope.decimals)}
                          </bdi>
                        </div>
                        <div>
                          <span>التحقق من الأرصدة</span>
                          <span>
                            {result.bridge
                              ? result.balanceComparable
                                ? 'الأرصدة متسقة حسابيًا وتغطية الفترة مؤكدة'
                                : 'الأرصدة متسقة حسابيًا وتغطية الفترة تحتاج تأكيدك'
                              : 'لم نتمكن من إثبات اتساق الأرصدة'}
                          </span>
                        </div>
                        {result.bridge && (
                          <>
                            <hr className="divider" />
                            <div>
                              <span>فرق افتتاحي لم يُثبت سببه</span>
                              <bdi>
                                {money(
                                  result.bridge.openingAdjustment,
                                  scope.decimals,
                                )}
                              </bdi>
                            </div>
                            <div>
                              <span>صافي أثر حركات التسوية</span>
                              <bdi>
                                {money(
                                  result.bridge.itemAdjustment,
                                  scope.decimals,
                                )}
                              </bdi>
                            </div>
                            <div>
                              <span>الرصيد المعدل حسابيًا</span>
                              <bdi>
                                {money(result.bridge.adjusted, scope.decimals)}
                              </bdi>
                            </div>
                            <div>
                              <span>الفرق المتبقي حسابيًا</span>
                              <bdi>
                                {money(result.bridge.residual, scope.decimals)}
                              </bdi>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="notice">
                        وصول الفرق المتبقي إلى صفر لا يثبت أسباب الفروق أو صحة
                        المستندات. عدد الحركات التي ما زالت دون مقابل:{' '}
                        {result.supplierOnly.length + result.ledgerOnly.length}{' '}
                        وهي موثقة في ورقة العمل. هذا العرض يوضح أثر الحركات على
                        الأرصدة ولا يقترح قيودًا للترحيل.
                      </div>
                    </section>
                  ) : (
                    <p className="hint">
                      ورقة العمل تشمل مقارنة الحركات والحالات التي تحتاج متابعة.
                      لم تختر تسوية الأرصدة في هذه الجلسة.
                    </p>
                  )}
                  <section className="surface pad stack">
                    <h2>ملاحظات المراجعة وتنزيل الملف</h2>
                    <Field label="اسم المراجع (اختياري للمسودة)">
                      <Input
                        aria-label="اسم المراجع"
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
                    <Field label="ملاحظاتك وما يحتاج متابعة">
                      <Textarea
                        aria-label="ملاحظات المراجعة"
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
                          setError('أدخل اسم المراجع قبل تأكيد المراجعة.');
                          return;
                        }
                        setReview((r) => ({ ...r, checked: v }));
                      }}
                    >
                      راجعت ورقة العمل والحالات المتبقية. أسجل هنا تأكيدي الشخصي
                      للمراجعة، ولا يعني ذلك اعتمادًا من الموقع.
                    </Tick>
                    <p className="muted">
                      يشمل ملف Excel النتائج والمصادر وقرارات المراجعة والحالات
                      المفتوحة والصفوف المستبعدة، مع قواعد المطابقة وإصدار
                      المحرك. يمكنك تنزيل مسودة قبل تأكيد المراجعة.
                    </p>
                    <div className="actions">
                      <Button onClick={() => void download()} disabled={!!busy}>
                        <Download size={17} />
                        {review.checked
                          ? 'تنزيل ورقة العمل'
                          : 'تنزيل مسودة Excel'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setStep(2)}
                        disabled={!!busy}
                      >
                        العودة للمراجعة
                      </Button>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="footnote">
            النتائج تساعدك على المراجعة ولا تمثل اعتمادًا محاسبيًا. احفظ الجلسة أو
            نزّل ورقة العمل قبل الإغلاق إذا أردت الاحتفاظ بها.
            <br />
            <button
              onClick={togglePrivacy}
              aria-expanded={privacy}
              style={{ textDecoration: 'underline', marginTop: 8 }}
            >
              <CircleHelp
                size={13}
                style={{ display: 'inline', marginLeft: 5 }}
              />
              الخصوصية وحدود النسخة
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
          aria-label="تراصف"
        >
          <BrandMark />
          <BrandWordmark />
        </a>
        <p>وضوح يساعدك في المراجعة</p>
        {showLanding ? (
          <a className="footer-privacy-link" href="#privacy-details">
            حدود الخصوصية
          </a>
        ) : (
          <button className="footer-privacy-link" onClick={togglePrivacy}>
            حدود الخصوصية
          </button>
        )}
      </footer>
    </div>
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
  onNotice: (s: string) => void;
  onError: (s: string) => void;
  onPdfApply: (cuts: number[]) => void;
  onPdfDraftChange: (pending: boolean) => void;
  formats?: FormatSuggestions;
  formatChoices: FormatChoices;
  onFormatChange: (field: 'dateFormat' | 'numberFormat', value: string) => void;
  balanceMode: boolean;
  directionConfirmed: boolean;
}) {
  const sheet = file.sheets[mapping.sheet];
  const header = sheet?.rows[mapping.header] ?? [];
  const columns: [string, string][] = [
    ['-1', 'غير محدد'],
    ...header.map(
      (h, i) =>
        [String(i), `${i + 1} · ${h || 'بلا عنوان'}`] as [string, string],
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
  if (!sheet) {
    return (
      <section className="surface pad stack">
        <div className="summary-head">
          <div>
            <h2>{sideNames[side]}</h2>
            <p className="summary-line">
              <bdi>{file.name}</bdi>
            </p>
          </div>
        </div>
        <p className="hint warn" role="status">
          {initialSelection.notice}
        </p>
        <Choice
          label="الورقة التي تحتوي الحركات"
          value="-1"
          options={[
            ['-1', 'اختر ورقة العمل'],
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
    index >= 0 ? header[index] || `عمود ${index + 1}` : 'غير محدد';
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
          <h2>{sideNames[side]}</h2>
          <p className="summary-line">
            <bdi>{file.name}</bdi>
            {file.sheets.length > 1 && (
              <>
                {' · '}
                <bdi>{sheet.name}</bdi>
              </>
            )}
            {' · '}
            {named('التاريخ', mapping.date)}
            {' · '}
            {mapping.mode === 'signed' ? (
              <>{named('المبلغ', mapping.amount)}</>
            ) : (
              <>
                {named('مدين', mapping.debit)} / {named('دائن', mapping.credit)}
              </>
            )}
            {mapping.reference >= 0 && (
              <>
                {' · '}
                {named('المرجع', mapping.reference)}
              </>
            )}
          </p>
          {(mapping.mode === 'signed' || directionConfirmed) && (
            <p className="hint">
              {mapping.mode === 'signed'
                ? mapping.multiplier === 1
                  ? 'المبلغ الموجب يزيد المستحق للمورد.'
                  : 'المبلغ السالب يزيد المستحق للمورد.'
                : mapping.multiplier === 1
                  ? 'المدين يزيد المستحق للمورد والدائن يخفضه.'
                  : 'الدائن يزيد المستحق للمورد والمدين يخفضه.'}{' '}
              <button
                type="button"
                className="inline-link"
                onClick={() =>
                  onChange({ multiplier: (mapping.multiplier * -1) as 1 | -1 })
                }
              >
                عكس اتجاه المبالغ
              </button>
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`تعديل ${sideNames[side]}`}
        >
          <Pencil size={14} />
          {open ? 'إغلاق' : 'خيارات متقدمة'}
        </Button>
      </div>
      {mapping.mode === 'split' && !mapping.directionEvidence && (
        <Choice
          label="أي عمود يزيد المبلغ المستحق للمورد؟"
          value={directionConfirmed ? String(mapping.multiplier) : ''}
          options={[
            ['', 'اختر الاتجاه في هذا التقرير'],
            ['1', 'المدين يزيد المستحق'],
            ['-1', 'الدائن يزيد المستحق'],
          ]}
          onChange={(value) => {
            if (value) onChange({ multiplier: Number(value) as 1 | -1 });
          }}
        />
      )}
      {mapping.reference < 0 && (
        <p className="hint">
          لم نحدد عمود المرجع، لذلك لن تُعتمد مطابقات آلية. إذا كان موجودًا، اختره
          من «خيارات متقدمة».
        </p>
      )}
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
        <p className="hint" role="status">
          {initialSelection.notice}
        </p>
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
            {formatChoices[field] ? 'الصيغة التي اخترتها. ' : ''}
            {formats![field].reason}
          </p>
          <Choice
            label={
              field === 'dateFormat'
                ? `صيغة التاريخ في ${sideNames[side]}`
                : `صيغة المبالغ في ${sideNames[side]}`
            }
            value={formatChoices[field] ? mapping[field] : ''}
            onChange={(value) => onFormatChange(field, value)}
            options={[
              ['', 'اختر التفسير الصحيح'],
              ...formats![field].candidates.map(
                (value) =>
                  [
                    value,
                    field === 'dateFormat'
                      ? dateLabels[value as Mapping['dateFormat']]
                      : numberLabels[value as Mapping['numberFormat']],
                  ] as [string, string],
              ),
            ]}
          />
        </div>
      ))}
      {!!validation?.errors.length && (
        <div className="panel stack">
          <p className="hint warn" role="status">
            تعذرت قراءة {validation.errors.length} من الصفوف ولم تدخل في
            المقارنة. صحح بياناتها أو استبعدها مع توضيح السبب.
          </p>
          {validation.errors.slice(0, 8).map((e) => (
            <p className="muted" key={`${e.row}-${e.message}`}>
              صف {e.row}: {e.message}
            </p>
          ))}
          {validation.errors.length > 8 && (
            <p className="muted">
              تفاصيل بقية الصفوف تظهر في ورقة Diagnostics عند تنزيل ملف Excel.
            </p>
          )}
        </div>
      )}
      {missingColumns && !open && (
        <div className="panel stack">
          <p className="hint warn">
            نحتاج مساعدتك في تحديد بعض الأعمدة. اختر الأعمدة الناقصة أدناه، وافتح
            «خيارات متقدمة» إذا أردت تعديل بقية الإعدادات.
          </p>
          <div className="form-grid">
            {mapping.date < 0 && col('date', 'عمود التاريخ')}
            {mapping.mode === 'signed' ? (
              mapping.amount < 0 && col('amount', 'عمود المبلغ')
            ) : (
              <>
                {mapping.debit < 0 && col('debit', 'عمود المدين')}
                {mapping.credit < 0 && col('credit', 'عمود الدائن')}
              </>
            )}
          </div>
        </div>
      )}
      {open && (
        <div className="panel stack">
          {mapping.directionEvidence && (
            <p className="hint">{mapping.directionEvidence.reason}</p>
          )}
          {missingColumns && (
            <p className="hint warn">
              حدد عمود التاريخ وعمود المبلغ (أو المدين والدائن) لتتم القراءة.
            </p>
          )}
          <div className="form-grid">
            {file.sheets.length > 1 && (
              <Choice
                label="ورقة العمل"
                value={String(mapping.sheet)}
                options={file.sheets.map((s, i) => [String(i), s.name])}
                onChange={(v) => onChange(inferMapping(file, Number(v)))}
              />
            )}
            <Field label="رقم صف العناوين">
              <Input
                type="number"
                min={1}
                max={sheet.rows.length}
                aria-label={`صف العناوين ${side}`}
                value={mapping.header + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= sheet.rows.length)
                    onChange(inferMapping(file, mapping.sheet, n - 1));
                }}
              />
            </Field>
            <Choice
              label="طريقة عرض المبالغ"
              value={mapping.mode}
              options={[
                ['signed', 'عمود مبلغ موجب أو سالب'],
                ['split', 'عمود مدين وعمود دائن'],
              ]}
              onChange={(v) => onChange({ mode: v as Mapping['mode'] })}
            />
            {col('date', 'عمود التاريخ')}
            {col('reference', 'عمود المرجع')}
            {mapping.mode === 'signed' ? (
              col('amount', 'عمود المبلغ')
            ) : (
              <>
                {col('debit', 'عمود المدين')}
                {col('credit', 'عمود الدائن')}
              </>
            )}
            {col('description', 'عمود الوصف (اختياري)')}
            {col('currencyColumn', 'عمود العملة (إن وجد)')}
          </div>
          <details>
            <summary>معاينة بداية الجدول</summary>
            <div className="preview">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصف</TableHead>
                    {header.map((h, i) => (
                      <TableHead key={i}>
                        {i + 1} · {h || 'بلا عنوان'}
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
            <summary>إعدادات القراءة ونوع التقرير</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Choice
                label="نوع التقرير"
                value={mapping.reportType}
                options={[
                  ['transactions', 'حركات خلال فترة'],
                  ['open-items', 'بنود مفتوحة حتى تاريخ المقارنة'],
                ]}
                onChange={(v) =>
                  onChange({ reportType: v as Mapping['reportType'] })
                }
              />
              <Choice
                label="اتجاه المبالغ"
                value={String(mapping.multiplier)}
                options={
                  mapping.mode === 'signed'
                    ? [
                        ['1', 'المبلغ الموجب يزيد المستحق للمورد'],
                        ['-1', 'المبلغ السالب يزيد المستحق للمورد'],
                      ]
                    : [
                        ['1', 'المدين يزيد المستحق للمورد والدائن يخفضه'],
                        ['-1', 'الدائن يزيد المستحق للمورد والمدين يخفضه'],
                      ]
                }
                onChange={(v) => onChange({ multiplier: Number(v) as 1 | -1 })}
              />
              <Choice
                label="صيغة الأرقام في المصدر"
                value={mapping.numberFormat}
                options={[
                  ['dot', '1,234.56 — النقطة عشرية'],
                  ['comma', '1.234,56 — الفاصلة عشرية'],
                ]}
                onChange={(v) => onFormatChange('numberFormat', v)}
              />
              <Choice
                label="صيغة التاريخ النصي"
                value={mapping.dateFormat}
                options={[
                  ['ymd', 'سنة / شهر / يوم'],
                  ['dmy', 'يوم / شهر / سنة'],
                  ['mdy', 'شهر / يوم / سنة'],
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
                    onNotice('حُفظت إعدادات الأعمدة على جهازك دون بيانات مالية.');
                  } catch {
                    onError('تعذر حفظ القالب في هذا المتصفح.');
                  }
                }}
              >
                حفظ كقالب
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const t = getTemplate(side);
                  if (
                    !t ||
                    t.sheet === undefined ||
                    t.header === undefined ||
                    !file.sheets[t.sheet] ||
                    t.header >= file.sheets[t.sheet].rows.length
                  ) {
                    onError('لا يوجد قالب صالح لهذا الملف.');
                    return;
                  }
                  onChange(t);
                  onNotice(
                    'استعدنا مواضع الأعمدة فقط. يُفحص اتجاه المبالغ وصيغتها من الملف الحالي.',
                  );
                }}
              >
                استعادة القالب
              </Button>
            </div>
          </details>
          <details open={importIssues.length > 0}>
            <summary>
              استبعاد صف مع توضيح السبب
              {importIssues.length > 0
                ? ` — ${importIssues.length} ملاحظة قراءة`
                : ''}
            </summary>
            <div className="stack" style={{ marginTop: 12 }}>
              {importIssues.slice(0, 5).map((issue, index) => (
                <p
                  className="muted"
                  key={`${issue.row}:${issue.column ?? 0}:${index}`}
                >
                  صف {issue.row}
                  {issue.column ? `، عمود ${issue.column}` : ''}:{' '}
                  {issue.messages.join('؛ ')}
                </p>
              ))}
              {validation && (
                <p className="muted">
                  الحركات المقروءة: {validation.transactions.length} · الصفوف
                  المستبعدة: {validation.excluded.length} · الصفوف التي لم تُقرأ:{' '}
                  {validation.errors.length}
                </p>
              )}
              <div className="form-grid">
                <Field label="رقم الصف">
                  <Input
                    type="number"
                    min={mapping.header + 2}
                    max={sheet.rows.length}
                    aria-label={`صف الاستبعاد ${side}`}
                    value={excludeRow}
                    onChange={(e) => setExcludeRow(e.target.value)}
                  />
                </Field>
                <Field label="سبب الاستبعاد">
                  <Input
                    aria-label={`سبب الاستبعاد ${side}`}
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
                    onError('حدد صف بيانات صحيحًا وسبب استبعاده.');
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
                استبعاد الصف
              </Button>
              {Object.entries(mapping.excluded).map(([row, reason]) => (
                <div className="actions" key={row}>
                  <span className="muted">
                    صف {row}: {reason}
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
                    إعادة إدراج
                  </Button>
                </div>
              ))}
            </div>
          </details>
          {balanceMode && (
            <div className="stack">
              <strong>الأرصدة وتغطية الفترة</strong>
              <div className="form-grid">
                {mapping.reportType === 'transactions' && (
                  <>
                    <Field label="بداية فترة الحركات">
                      <Input
                        type="date"
                        aria-label={`بداية الفترة ${side}`}
                        value={mapping.periodStart}
                        onChange={(e) =>
                          onChange({ periodStart: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="الرصيد الافتتاحي (موجب إذا كان مستحقًا للمورد)">
                      <Input
                        dir="ltr"
                        aria-label={`الرصيد الافتتاحي ${side}`}
                        value={mapping.opening}
                        onChange={(e) => onChange({ opening: e.target.value })}
                      />
                    </Field>
                  </>
                )}
                <Field label="الرصيد الختامي في تاريخ المقارنة">
                  <Input
                    dir="ltr"
                    aria-label={`الرصيد الختامي ${side}`}
                    value={mapping.closing}
                    onChange={(e) => onChange({ closing: e.target.value })}
                  />
                </Field>
              </div>
              <p className="hint">
                أنت أدخلت هذه الأرصدة يدويًا. اتساقها حسابيًا لا يثبت أن الملف يشمل
                كل الحركات.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
