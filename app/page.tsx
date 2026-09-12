import type { restoreSession } from '@/lib/reconciliation/session';
import { TransactionReview } from '@/components/transaction-review';
import { PdfReview } from '@/components/pdf-review';
import type { AuditEvent } from '@/lib/reconciliation/types';
import { AccountingAssistant } from '@/components/accounting-assistant';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Scale,
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
import {
  defaultMapping,
  ENGINE_VERSION,
  MAX_FILE_BYTES,
} from '@/lib/reconciliation/types';
import type {
  SourceFile,
  Mapping,
  Scope,
  Comparison,
  SourceResult,
  Decision,
  Transaction,
} from '@/lib/reconciliation/types';
import { inferMapping, money } from '@/lib/reconciliation/core';
import {
  getMappedImportIssues,
  selectImportMapping,
} from '@/lib/reconciliation/import-selection';
import { demoFiles, demoMappings, demoScope } from '@/lib/reconciliation/demo';
const initialScope: Scope = {
  supplier: '',
  entity: '',
  account: '',
  currency: 'SAR',
  decimals: 2,
  cutoff: '',
  dateWindow: 2,
  confirmed: false,
  coverageConfirmed: false,
};
const sideNames = ['كشف المورد', 'تقرير الحسابات الدائنة'];
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
function localTemplate(mapping: Mapping) {
  return {
    ...mapping,
    opening: '',
    closing: '',
    periodStart: '',
    excluded: {},
    pdfReviewed: false,
  };
}
function getTemplate(side: number): Mapping | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(`mizan.mapping.${side}.v1`) ?? 'null',
    );
    if (!value) return null;
    const d = defaultMapping();
    for (const k of [
      'sheet',
      'header',
      'date',
      'reference',
      'description',
      'amount',
      'debit',
      'credit',
      'currencyColumn',
    ] as const) {
      if (!Number.isInteger(value[k]) || value[k] < -1 || value[k] > 100)
        return null;
      d[k] = value[k];
    }
    if (
      !['signed', 'split'].includes(value.mode) ||
      ![1, -1].includes(value.multiplier) ||
      !['dot', 'comma'].includes(value.numberFormat) ||
      !['ymd', 'dmy', 'mdy'].includes(value.dateFormat) ||
      !['transactions', 'open-items'].includes(value.reportType)
    )
      return null;
    return {
      ...d,
      mode: value.mode,
      multiplier: value.multiplier,
      numberFormat: value.numberFormat,
      dateFormat: value.dateFormat,
      reportType: value.reportType,
    };
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
  const [step, setStep] = useState(0);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
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
    const heading = document.querySelector('h1');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [step]);
  function invalidate() {
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
    invalidate();
    setScope((s) => ({ ...s, confirmed: false, coverageConfirmed: false }));
    setMappings(
      (ms) =>
        ms.map((m, j) =>
          j === i
            ? {
                ...m,
                ...p,
                ...('pdfReviewed' in p ? {} : { pdfReviewed: false }),
              }
            : m,
        ) as [Mapping, Mapping],
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
    setError('');
    setNotice('');
    const alive = () => job.current?.id === id && !controller.signal.aborted;
    try {
      await fn(controller.signal, alive);
    } catch (e) {
      if (alive())
        setError(e instanceof Error ? e.message : 'تعذر إكمال العملية');
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
    setNotice('أُلغيت العملية. لم تُرسل بيانات.');
  }
  function loadDemo() {
    if (busy) return;
    invalidate();
    setDemo(true);
    setFiles(structuredClone(demoFiles));
    setMappings(structuredClone(demoMappings));
    setScope({ ...demoScope });
    setStep(1);
    setNotice('هذه بيانات اصطناعية. أكد اتجاه المبالغ والنطاق قبل المقارنة.');
  }
  async function loadFile(file: File | undefined, i: number) {
    if (!file || busy || !engineReady) return;
    await task('قراءة الملف على جهازك', async (signal, alive) => {
      if (file.size > MAX_FILE_BYTES) throw new Error('الحد 8 MB لكل ملف');
      const buffer = await file.arrayBuffer();
      if (!alive()) return;
      const parsed = await workerTask<SourceFile>(
        'read',
        { name: file.name, buffer },
        signal,
      );
      if (!alive()) return;
      const selection = selectImportMapping(
        parsed,
        i === 0 ? 'supplier' : 'ledger',
      );
      invalidate();
      setDemo(false);
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
    await task('إعادة قراءة أعمدة PDF محليًا', async (signal, alive) => {
      const parsed = await workerTask<SourceFile>(
        'read',
        { name: file.name, buffer: file.original, pdfCuts: cuts },
        signal,
      );
      if (!alive()) return;
      invalidate();
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
    await task('التحقق والمطابقة محليًا', async (signal, alive) => {
      if (!files[0] || !files[1]) throw new Error('اختر الملفين');
      const payload = {
        files,
        mappings,
        scope,
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
      setResult(r);
      setAuditEvents((events) => [
        ...events,
        {
          time: new Date().toISOString(),
          ...(event ?? {
            action: 'compare' as const,
            ids: [],
            note: 'إعادة الحساب من المدخلات المؤكدة',
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
    await task('حفظ جلسة محلية', async (signal, alive) => {
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
      a.download = `mizan-${scope.cutoff}.mizan.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(
        'ملف الجلسة يتضمن المصادر والملاحظات دون تشفير. احفظه في مكان خاص على جهازك.',
      );
    });
  }
  async function loadSession(file?: File) {
    if (!file || busy || files.some(Boolean)) return;
    await task('التحقق من الجلسة وإعادة حسابها', async (signal, alive) => {
      if (file.size > 30 * 1024 * 1024)
        throw new Error('حجم الجلسة يتجاوز 30 MB');
      const saved = await workerTask<
        Awaited<ReturnType<typeof restoreSession>>
      >('restore-session', { buffer: await file.arrayBuffer() }, signal);
      if (!alive()) return;
      invalidate();
      setFiles(saved.files);
      setMappings(saved.mappings);
      setScope(saved.scope);
      setDecisions(saved.decisions);
      setRejected(saved.rejected);
      setResult(saved.result);
      setAuditEvents(saved.events);
      setReview(saved.review);
      setDemo(false);
      setStep(2);
      setNotice(
        'استعيدت الجلسة وأعيد حسابها من المصادر. راجع النتيجة قبل تأكيد المراجعة.',
      );
    });
  }
  async function download() {
    if (!result) return;
    await task('إنشاء ورقة العمل محليًا', async (signal, alive) => {
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
      a.download = `mizan-workpaper-${scope.cutoff}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(
        'أُنشئت ورقة العمل. اختر مكان حفظها وتحقق من وصول الملف إلى التنزيلات.',
      );
    });
  }
  const matchedBySupplier = useMemo(
    () => new Map(result?.matches.map((m) => [m.supplierId, m]) ?? []),
    [result],
  );
  const ledgerById = useMemo(
    () => new Map(result?.ledger.transactions.map((t) => [t.id, t]) ?? []),
    [result],
  );
  const rows = useMemo(() => {
    if (!result) return [];
    let tx =
      tab === 'matches'
        ? result.supplier.transactions.filter((t) =>
            matchedBySupplier.has(t.id),
          )
        : tab === 'ambiguities'
          ? [
              ...result.supplier.transactions,
              ...result.ledger.transactions,
            ].filter((t) => result.ambiguousIds.includes(t.id))
          : [...result.supplierOnly, ...result.ledgerOnly];
    if (query.trim()) {
      const q = query.toLowerCase();
      tx = tx.filter((t) =>
        `${t.reference} ${t.description} ${t.row}`.toLowerCase().includes(q),
      );
    }
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
    setResetOpen(false);
    cancel();
    invalidate();
    setFiles([null, null]);
    setMappings([defaultMapping(), defaultMapping()]);
    setScope(initialScope);
    setDemo(false);
    setStep(0);
    setNotice('');
  }
  return (
    <div className="app-shell">
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogTitle>بدء عملية جديدة؟</AlertDialogTitle>
          <AlertDialogDescription>
            سيُحذف عمل هذه الجلسة من الموقع. صدّر ورقة العمل أولًا إذا أردت الاحتفاظ
            بالنتائج؛ الملفات التي نزّلتها ستبقى على جهازك.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>متابعة الجلسة</AlertDialogCancel>
            <AlertDialogAction onClick={reset}>
              حذف الجلسة والبدء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <header className="topbar">
        <a className="brand" href="./">
          <span className="brand-mark">
            <Scale size={25} />
          </span>
          <strong>ميزان</strong>
          <span className="brand-caption">مساحة تسوية الموردين</span>
        </a>
        <button className="local-pill" onClick={() => setPrivacy(!privacy)}>
          <ShieldCheck size={16} /> المعالجة على جهازك
        </button>
      </header>
      <main className="workspace">
        {privacy && (
          <section className="surface pad stack">
            <div className="section-heading" style={{ padding: 0 }}>
              <h2>حدود الخصوصية</h2>
              <Button
                aria-label="إغلاق الخصوصية"
                variant="ghost"
                onClick={() => setPrivacy(false)}
              >
                <X />
              </Button>
            </div>
            <p className="muted">
              الملفات وأسماؤها ومعاملاتها تُقرأ وتُطابق وتُصدّر داخل المتصفح. لا
              يستخدم التطبيق تحليلات أو خدمة معالجة مالية. استضافة الموقع تقدم
              ملفات التطبيق، وقد تسجل زيارة الموقع وفق سياسة المضيف. لا نضمن سلامة
              إضافات المتصفح أو الجهاز.
            </p>
            <p className="muted">
              لا تُحفظ المعاملات بين الجلسات. القوالب التي تحفظها اختيارية وتحتوي
              أرقام الأعمدة وتفضيلات القراءة فقط. يعمل المسار المحمّل دون اتصال؛
              إعادة فتح الموقع بلا إنترنت غير مدعومة في هذه النسخة.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  localStorage.removeItem('mizan.mapping.0.v1');
                  localStorage.removeItem('mizan.mapping.1.v1');
                  setNotice('مُسحت قوالب الأعمدة المحلية.');
                } catch {
                  setError('تعذر الوصول إلى التخزين المحلي.');
                }
              }}
            >
              مسح القوالب المحلية
            </Button>
          </section>
        )}
        <div className="page-heading">
          <div>
            <div className="eyebrow">أدوات المحاسب / تسوية الموردين</div>
            <h1 tabIndex={-1}>
              {step === 0
                ? 'ملفّان. صورة أوضح.'
                : step === 1
                  ? 'نتأكد أولًا، ثم نطابق.'
                  : step === 2
                    ? 'الفروق أمامك. القرار لك.'
                    : 'ورقة عمل تحكي التفاصيل.'}
            </h1>
            <p>
              {step === 0
                ? 'قارن كشف المورد بدفترك، راجع الفروق، واحتفظ بورقة عمل واضحة.'
                : step === 1
                  ? 'أكد معنى الأعمدة والنطاق؛ لا نفترض اكتمال البيانات من شكل الملف.'
                  : step === 2
                    ? 'افحص الأدلة والمبالغ ومصادر الحركات قبل اعتماد أي ربط.'
                    : 'تصدير موثق للمصادر والقواعد والقرارات والاستثناءات المفتوحة.'}
            </p>
          </div>
          <div className="stack">
            <span className="version-badge">نسخة تجريبية {ENGINE_VERSION}</span>
            {files.some(Boolean) && (
              <Button
                variant="ghost"
                onClick={() => setResetOpen(true)}
                disabled={!!busy}
              >
                <RotateCcw size={15} />
                عملية جديدة
              </Button>
            )}
          </div>
        </div>
        <nav className="steps" aria-label="خطوات التسوية">
          {[
            'إضافة الملفات',
            'تأكيد البيانات',
            'مراجعة الفروق',
            'ورقة العمل',
          ].map((s, i) => (
            <div
              className={i === step ? 'active' : ''}
              key={s}
              aria-current={i === step ? 'step' : undefined}
            >
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {s}
            </div>
          ))}
        </nav>
        {demo && (
          <div className="notice">
            <FlaskConical
              size={17}
              style={{ display: 'inline', marginLeft: 8 }}
            />
            بيانات اصطناعية للتجربة — لا تمثل شركة أو معاملات فعلية.
          </div>
        )}
        {!engineReady && !!error && (
          <Button
            variant="outline"
            onClick={() => {
              setError('');
              void prepareWorker()
                .then(() => setEngineReady(true))
                .catch(() => setError('تعذر تشغيل المحرك؛ جرّب متصفحًا حديثًا.'));
            }}
          >
            إعادة تشغيل المحرك
          </Button>
        )}
        {!engineReady && !error && (
          <div className="notice loading" role="status">
            <LoaderCircle className="spin" size={17} />
            تحميل المحرك إلى جهازك…
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
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
            <section className="surface">
              <div className="section-heading">
                <div>
                  <h2>لنبدأ بالملفين</h2>
                  <p>مورد واحد · جهة واحدة · عملة واحدة</p>
                </div>
                <FileSpreadsheet size={23} />
              </div>
              <div className="file-grid">
                {sideNames.map((s, i) => (
                  <div
                    className="dropzone"
                    key={s}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void loadFile(e.dataTransfer.files[0], i);
                    }}
                  >
                    <span className="file-icon">
                      {files[i] ? (
                        <FileCheck2 size={30} />
                      ) : (
                        <FileSpreadsheet size={30} />
                      )}
                    </span>
                    <h3>{s}</h3>
                    <p>
                      {files[i] ? (
                        <bdi>{files[i]!.name}</bdi>
                      ) : i === 0 ? (
                        'الكشف الذي استلمته من المورد'
                      ) : (
                        'التقرير المستخرج من نظامك المحاسبي'
                      )}
                    </p>
                    <label className="file-button">
                      {files[i] ? 'استبدال الملف' : 'اختيار ملف من الجهاز'}
                      <input
                        type="file"
                        accept=".xlsx,.csv,.pdf"
                        aria-label={s}
                        disabled={!!busy || !engineReady}
                        onChange={(e) => {
                          void loadFile(e.target.files?.[0], i);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <small>
                      XLSX أو CSV أو PDF نصي بلا صور · حتى 8 MB · PDF حتى 20
                      صفحة، دون OCR للصور
                    </small>
                  </div>
                ))}
              </div>
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
            <div className="demo-strip">
              <div>
                <FlaskConical size={23} />
                <div>
                  <strong>استكشف الخطوات أولًا</strong>
                  <p>
                    مثال يحتوي فواتير ومدفوعات ومراجع مكررة وفروقًا للمراجعة.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={loadDemo}
                disabled={!!busy || !engineReady}
              >
                تجربة مثال
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
              <h2>نطاق المقارنة</h2>
              <div className="form-grid">
                <Field label="المورد / الطرف المقابل">
                  <Input
                    aria-label="المورد"
                    value={scope.supplier}
                    onChange={(e) => updateScope({ supplier: e.target.value })}
                  />
                </Field>
                <Field label="الجهة القانونية">
                  <Input
                    aria-label="الجهة القانونية"
                    value={scope.entity}
                    onChange={(e) => updateScope({ entity: e.target.value })}
                  />
                </Field>
                <Field label="الحساب / المواقع المشمولة">
                  <Input
                    aria-label="نطاق الحساب"
                    value={scope.account}
                    onChange={(e) => updateScope({ account: e.target.value })}
                  />
                </Field>
                <Field label="تاريخ القطع المشترك">
                  <Input
                    type="date"
                    aria-label="تاريخ القطع"
                    value={scope.cutoff}
                    onChange={(e) => updateScope({ cutoff: e.target.value })}
                  />
                </Field>
                <Field label="رمز العملة">
                  <Input
                    aria-label="العملة"
                    maxLength={3}
                    dir="ltr"
                    value={scope.currency}
                    onChange={(e) =>
                      updateScope({ currency: e.target.value.toUpperCase() })
                    }
                  />
                </Field>
                <Choice
                  label="دقة العملة"
                  value={String(scope.decimals)}
                  onChange={(s) => updateScope({ decimals: Number(s) })}
                  options={[
                    ['0', 'دون منازل عشرية'],
                    ['2', 'منزلتان — مثل SAR'],
                    ['3', 'ثلاث منازل — مثل KWD'],
                  ]}
                />
                <Choice
                  label="نافذة التاريخ للمطابقة الآلية"
                  value={String(scope.dateWindow)}
                  onChange={(s) => updateScope({ dateWindow: Number(s) })}
                  options={Array.from(
                    { length: 8 },
                    (_, i) => [String(i), `${i} يوم`] as [string, string],
                  )}
                />
              </div>
              <p className="muted">
                النطاق يعتمد على تأكيدك لمحتوى الملفين. لا يفترض الموقع أن
                التقرير غير المعلّم يخص موردًا واحدًا أو أنه كامل.
              </p>
            </section>
            {files.map(
              (file, i) =>
                file && (
                  <SourceConfiguration
                    key={i}
                    file={file}
                    mapping={mappings[i]}
                    side={i}
                    onChange={(p) => updateMapping(i, p)}
                    validation={validated?.[i]}
                    onNotice={setNotice}
                    onError={setError}
                    onPdfApply={(cuts) => void configurePdf(i, cuts)}
                  />
                ),
            )}
            <section className="surface pad stack">
              <Tick
                disabled={mappings.some((m) => m.sheet < 0)}
                checked={scope.confirmed}
                onChange={(v) => updateScope({ confirmed: v })}
              >
                أؤكد أن الملفين لنفس المورد والجهة والحساب والعملة وتاريخ القطع،
                وأن معنى الأعمدة واتجاه المديونية وصيغة التاريخ صحيح.
              </Tick>
              <Tick
                checked={scope.coverageConfirmed}
                onChange={(v) => updateScope({ coverageConfirmed: v })}
              >
                أؤكد اكتمال تغطية التقريرين للفترة/البنود المفتوحة والأرصدة التي
                أدخلتها. هذا التأكيد مطلوب للتحقق من الأرصدة، وليس لمقارنة
                الحركات وحدها.
              </Tick>
              <div className="notice">
                المبلغ الموجب يزيد المديونية للمورد، والسالب يخفضها. الأرصدة
                المدخلة هنا تتبع المعنى نفسه مهما كانت إشارات المصدر.
              </div>
              <div className="actions">
                <Button
                  onClick={() => void reconcile()}
                  disabled={
                    !scope.confirmed ||
                    !scope.cutoff ||
                    !!busy ||
                    mappings.some((m) => m.sheet < 0)
                  }
                >
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
              يُقرأ ملف الجلسة محليًا وتُعاد مطابقة مصادره قبل استعادته.
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
                حفظ جلسة للاستكمال
              </Button>
              <span className="muted">
                ملف محلي يتضمن بياناتك دون تشفير؛ احتفظ به في مكان خاص.
              </span>
            </div>
            <div className="metric-grid">
              <Metric
                label="مطابقات آلية"
                value={String(
                  result.matches.filter((m) => m.kind === 'auto').length,
                )}
                hint="أزواج تستوفي القاعدة"
              />
              <Metric
                label="تأكيدات يدوية"
                value={String(
                  result.matches.filter((m) => m.kind === 'manual').length,
                )}
                hint="قرارات موثقة للمراجع"
              />
              <Metric
                label="حركات دون مقابل"
                value={String(
                  result.supplierOnly.length + result.ledgerOnly.length,
                )}
                hint="في الملفين المقدمين"
              />
              <Metric
                label="فرق الأرصدة"
                value={
                  result.bridge
                    ? money(result.bridge.delta, scope.decimals)
                    : '—'
                }
                hint={result.bridge ? scope.currency : 'لا تتوافر أرصدة متحققة'}
              />
            </div>
            {!result.balanceComparable && (
              <div className="notice">
                مقارنة حركات فقط: لم يتحقق اتساق الأرصدة والتغطية على أساس مشترك.
                لا توجد تسوية أرصدة مكتملة.
              </div>
            )}
            {!!result.diagnostics.filter((d) => !d.transactionIds.length)
              .length && (
              <div className="notice" role="status">
                {result.diagnostics
                  .filter((d) => !d.transactionIds.length)
                  .map((d, i) => (
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
                        «دون مقابل» تعني غيابه عن الملف المقدم، وليس بالضرورة عن
                        النظام.
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
                            تكرار محتمل
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
                          const match =
                            t.side === 'supplier'
                              ? matchedBySupplier.get(t.id)
                              : undefined;
                          return (
                            <TableRow key={t.id}>
                              <TableCell>
                                {t.side === 'supplier' ? 'المورد' : 'الدفتر'} ·{' '}
                                {t.row}
                              </TableCell>
                              <TableCell className="mono">{t.date}</TableCell>
                              <TableCell>
                                <bdi>{t.reference || 'بلا مرجع'}</bdi>
                                <div className="muted">
                                  {t.description.slice(0, 55)}
                                </div>
                              </TableCell>
                              <TableCell className="mono">
                                {money(t.amount, scope.decimals)}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`status ${match ? 'good' : 'warn'}`}
                                >
                                  {match
                                    ? match.kind === 'auto'
                                      ? 'مطابقة آلية'
                                      : 'تأكيد يدوي'
                                    : result.ambiguousIds.includes(t.id)
                                      ? 'تكرار محتمل'
                                      : 'دون مقابل'}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!!busy}
                                  onClick={() => setSelected(t.id)}
                                >
                                  فحص
                                </Button>
                                {auditEvents.some(
                                  (e) =>
                                    e.action === 'review' &&
                                    e.ids.includes(t.id),
                                ) && (
                                  <small>
                                    استثناء راجعه المستخدم — لم يطابق
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
                    <div className="empty">لا توجد حركات في هذه القائمة.</div>
                  )}
                  <div className="surface-footer">
                    <span>
                      {rows.length} حركة · الصفحة {page + 1} من{' '}
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
                        'سُجلت مراجعة الاستثناء. لم تتغير المطابقات أو الفروق.',
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
                <section className="surface pad stack">
                  <div className="section-heading" style={{ padding: 0 }}>
                    <h2>الأرصدة وحالة التسوية</h2>
                    <FileCheck2 size={23} />
                  </div>
                  <div className="balance-lines">
                    <div>
                      <span>رصيد المورد المدخل</span>
                      <bdi>
                        {result.supplier.closing === null
                          ? 'غير متاح'
                          : money(result.supplier.closing, scope.decimals)}
                      </bdi>
                    </div>
                    <div>
                      <span>رصيد الدفتر المدخل</span>
                      <bdi>
                        {result.ledger.closing === null
                          ? 'غير متاح'
                          : money(result.ledger.closing, scope.decimals)}
                      </bdi>
                    </div>
                    <div>
                      <span>اتساق المصدرين</span>
                      <span>
                        {result.balanceComparable
                          ? 'تحقق حسابيًا وفق تأكيد التغطية'
                          : 'غير متحقق على أساس مشترك'}
                      </span>
                    </div>
                    {result.bridge && (
                      <>
                        <hr className="divider" />
                        <div>
                          <span>فرق الرصيد الافتتاحي — سبب غير مثبت</span>
                          <bdi>
                            {money(
                              result.bridge.openingAdjustment,
                              scope.decimals,
                            )}
                          </bdi>
                        </div>
                        <div>
                          <span>أثر جميع البنود دون مقابل</span>
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
                          <span>الباقي الحسابي للجسر</span>
                          <bdi>
                            {money(result.bridge.residual, scope.decimals)}
                          </bdi>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="notice">
                    حتى إذا كان الباقي صفرًا، لا يثبت ذلك أسباب الفروق أو صحة
                    المستندات.{' '}
                    {result.supplierOnly.length + result.ledgerOnly.length} حركة
                    دون مقابل ما زالت موثقة للمراجعة. لا يقترح هذا الجسر قيودًا
                    للترحيل.
                  </div>
                </section>
                <section className="surface pad stack">
                  <h2>توثيق المراجعة والتصدير</h2>
                  <Field label="اسم المراجع — اختياري للمسودة">
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
                  <Field label="ملاحظات عامة / أدلة تحتاج متابعة">
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
                    راجعت ورقة العمل والاستثناءات المتبقية. هذا إقرار محلي مني
                    وليس اعتمادًا آليًا من الموقع.
                  </Tick>
                  <p className="muted">
                    يتضمن Excel الملخص والمصادر والمطابقات والاقتراحات
                    والاستثناءات والاستبعادات والقواعد وإصدار المحرك. يمكنك تصدير
                    مسودة دون تأكيد المراجعة.
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
          المطابقة تساعدك على المراجعة؛ لا تعني اعتمادًا محاسبيًا. لا يُحفظ العمل بعد
          إغلاق الجلسة.
          <br />
          <button
            onClick={() => setPrivacy(!privacy)}
            style={{ textDecoration: 'underline', marginTop: 8 }}
          >
            <CircleHelp
              size={13}
              style={{ display: 'inline', marginLeft: 5 }}
            />
            الخصوصية وحدود النسخة
          </button>{' '}
          · {ENGINE_VERSION}
        </footer>
      </main>
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
  side,
  onChange,
  validation,
  onNotice,
  onError,
  onPdfApply,
}: {
  file: SourceFile;
  mapping: Mapping;
  side: number;
  onChange: (p: Partial<Mapping>) => void;
  validation?: SourceResult;
  onNotice: (s: string) => void;
  onError: (s: string) => void;
  onPdfApply: (cuts: number[]) => void;
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
  const [excludeRow, setExcludeRow] = useState('');
  const [excludeReason, setExcludeReason] = useState('');
  const [pdfDirty, setPdfDirty] = useState(false);
  useEffect(() => setPdfDirty(false), [file]);
  const initialSelection = useMemo(
    () => selectImportMapping(file, side === 0 ? 'supplier' : 'ledger'),
    [file, side],
  );
  const importIssues = useMemo(
    () => getMappedImportIssues(file, mapping),
    [file, mapping],
  );
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
        <h2>{sideNames[side]}</h2>
        <p>
          <bdi>{file.name}</bdi>
        </p>
        <p className="notice" role="status">
          {initialSelection.notice}
        </p>
        <Choice
          label="ورقة العمل — اختر جدول المصدر"
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
  return (
    <section className="surface">
      <div className="section-heading">
        <div>
          <h2>{sideNames[side]}</h2>
          <p>
            <bdi>{file.name}</bdi> · {sheet.rows.length} صفًا في الورقة المختارة
          </p>
        </div>
        <FileSpreadsheet />
      </div>
      {initialSelection.kind === 'workpaper' && (
        <p className="notice" role="status">
          {initialSelection.notice}
        </p>
      )}
      {file.pdf && (
        <>
          <PdfReview
            file={file}
            onApply={onPdfApply}
            onInvalidate={() => {
              setPdfDirty(true);
              onChange({ pdfReviewed: false });
            }}
          />
          <div className="pad">
            {pdfDirty && <p>طبّق حدود الأعمدة أولًا قبل تأكيد المراجعة.</p>}
            <Tick
              disabled={pdfDirty || !file.pdf.cuts.length}
              checked={mapping.pdfReviewed === true}
              onChange={(v) => onChange({ pdfReviewed: v })}
            >
              راجعت جميع صفحات PDF والصفوف المستخرجة مع الأصل، وتحققت من اكتمال
              الحركات ومواقع الأعمدة والإشارات والأرقام. إعادة القراءة تستلزم
              مراجعة جديدة.
            </Tick>
          </div>
        </>
      )}
      <div className="pad stack" style={{ paddingTop: 0 }}>
        {importIssues.length > 0 && (
          <div className="notice" role="status">
            <p>
              تم تحميل الملف. توجد {importIssues.length} ملاحظة قراءة في صفوف
              البيانات والأعمدة المختارة تحتاج مراجعة قبل المطابقة. الخلايا غير
              المستخدمة لا تمنع معالجة الجدول.
            </p>
            {importIssues.slice(0, 5).map((issue, index) => (
              <p key={`${issue.row}:${issue.column ?? 0}:${index}`}>
                صف {issue.row}
                {issue.column ? `، عمود ${issue.column}` : ''}:{' '}
                {issue.messages.join('؛ ')}
              </p>
            ))}
            {importIssues.length > 5 && (
              <p>تظهر التفاصيل المتبقية في فحص القراءة عند المطابقة.</p>
            )}
          </div>
        )}
        <div className="form-grid">
          <Choice
            label="ورقة العمل"
            value={String(mapping.sheet)}
            options={file.sheets.map((s, i) => [String(i), s.name])}
            onChange={(v) => onChange(inferMapping(file, Number(v)))}
          />
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
            label="نوع التقرير — تأكيد إلزامي ضمن النطاق"
            value={mapping.reportType}
            options={[
              ['transactions', 'حركات فترة'],
              ['open-items', 'بنود مفتوحة عند تاريخ القطع'],
            ]}
            onChange={(v) =>
              onChange({ reportType: v as Mapping['reportType'] })
            }
          />
          <Choice
            label="شكل المبالغ"
            value={mapping.mode}
            options={[
              ['signed', 'مبلغ واحد بإشارة'],
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
          {col('description', 'عمود الوصف — اختياري')}
          {col('currencyColumn', 'عمود العملة — إن وُجد')}
          <Choice
            label="اتجاه المديونية"
            value={String(mapping.multiplier)}
            options={
              mapping.mode === 'signed'
                ? [
                    ['1', 'الموجب يزيد ما ندين به للمورد'],
                    ['-1', 'السالب يزيد ما ندين به للمورد'],
                  ]
                : [
                    ['1', 'المدين يزيد المديونية، الدائن يخفضها'],
                    ['-1', 'الدائن يزيد المديونية، المدين يخفضها'],
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
            onChange={(v) =>
              onChange({ numberFormat: v as Mapping['numberFormat'] })
            }
          />
          <Choice
            label="صيغة التاريخ النصي"
            value={mapping.dateFormat}
            options={[
              ['ymd', 'سنة / شهر / يوم'],
              ['dmy', 'يوم / شهر / سنة'],
              ['mdy', 'شهر / يوم / سنة'],
            ]}
            onChange={(v) =>
              onChange({ dateFormat: v as Mapping['dateFormat'] })
            }
          />
        </div>
        <details>
          <summary>معاينة المصدر قبل المطابقة</summary>
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
          <summary>الأرصدة وتغطية الفترة — لتسوية الأرصدة</summary>
          <div className="form-grid" style={{ marginTop: 18 }}>
            {mapping.reportType === 'transactions' && (
              <>
                <Field label="بداية فترة الحركات">
                  <Input
                    type="date"
                    aria-label={`بداية الفترة ${side}`}
                    value={mapping.periodStart}
                    onChange={(e) => onChange({ periodStart: e.target.value })}
                  />
                </Field>
                <Field label="الرصيد الافتتاحي — موجب إذا كنا مدينين للمورد">
                  <Input
                    dir="ltr"
                    aria-label={`الرصيد الافتتاحي ${side}`}
                    value={mapping.opening}
                    onChange={(e) => onChange({ opening: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="الرصيد الختامي / مجموع المتبقي عند القطع">
              <Input
                dir="ltr"
                aria-label={`الرصيد الختامي ${side}`}
                value={mapping.closing}
                onChange={(e) => onChange({ closing: e.target.value })}
              />
            </Field>
          </div>
          <p className="muted" style={{ marginTop: 12 }}>
            الأرصدة مدخلة يدويًا من مصادر راجعتها؛ التطابق الحسابي لا يثبت اكتمال
            المصدر. استخدم صيغة الأرقام المحددة أعلاه.
          </p>
        </details>
        <details open={!!validation?.errors.length}>
          <summary>فحص القراءة واستبعاد صف مع توثيق</summary>
          <div className="stack" style={{ marginTop: 15 }}>
            {validation && (
              <>
                <p className="muted">
                  {validation.transactions.length} حركة مقروءة ·{' '}
                  {validation.excluded.length} صف مستبعد مع العناوين ·{' '}
                  {validation.errors.length} خطأ. اتساق الرصيد:{' '}
                  {validation.balanceValid ? 'تحقق حسابيًا' : 'غير متحقق'}.
                </p>
                {validation.errors.slice(0, 25).map((e) => (
                  <div
                    key={`${e.row}-${e.message}`}
                    className="notice error"
                    style={{ margin: 0 }}
                  >
                    صف {e.row}: {e.message}
                  </div>
                ))}
                {validation.errors.length > 25 && (
                  <p>توجد أخطاء إضافية؛ صحح المصدر قبل المتابعة.</p>
                )}
                {validation.warnings.slice(0, 10).map((w) => (
                  <p className="notice" key={w}>
                    {w}
                  </p>
                ))}
              </>
            )}
            <div className="form-grid">
              <Field label="رقم الصف المراد استبعاده">
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
              استبعاد الصف وتسجيل السبب
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
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() => {
              try {
                localStorage.setItem(
                  `mizan.mapping.${side}.v1`,
                  JSON.stringify(localTemplate(mapping)),
                );
                onNotice(
                  'حُفظت أرقام الأعمدة وتفضيلات القراءة محليًا دون محتوى مالي.',
                );
              } catch {
                onError('تعذر حفظ القالب في هذا المتصفح.');
              }
            }}
          >
            حفظ تعيين الأعمدة محليًا
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const t = getTemplate(side);
              if (
                !t ||
                !file.sheets[t.sheet] ||
                t.header >= file.sheets[t.sheet].rows.length
              ) {
                onError('لا يوجد قالب صالح لهذا الملف.');
                return;
              }
              onChange(t);
              onNotice('طُبق القالب. راجع الأعمدة وأعد تأكيد النطاق.');
            }}
          >
            استعادة القالب
          </Button>
        </div>
      </div>
    </section>
  );
}
