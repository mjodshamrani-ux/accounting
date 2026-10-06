import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { Button } from './ui/button';
import {
  createVisualAccountingRecord,
  saveVisualAccountingRecord,
  visualHeaderCandidates,
  visualCurrencyCandidates,
  VISUAL_SOURCE_SUFFIX,
} from '@/lib/reconciliation/visual-accounting-source';
import type { VisualAccountingContext } from '@/lib/reconciliation/visual-accounting-source';
import type { Scope } from '@/lib/reconciliation/types';
import type { VisualTable } from '@/lib/reconciliation/visual-table';

export type VisualSourceTransfer = (file: File, side: number) => Promise<void>;
/** The ordinary upload workflow remains untouched. This opt-in experimental
 * panel records the interpretation a human checked against the image. */
export function VisualAccountingReview({
  table,
  scope,
  disabled,
  onSource,
  onBusy,
}: {
  table: VisualTable;
  scope: Scope;
  disabled: boolean;
  onSource: VisualSourceTransfer;
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useI18n(),
    v = t.visualAccounting;
  const [fields, setFields] = useState({
    side: 'supplier',
    supplier: scope.supplier,
    entity: scope.entity,
    account: scope.account,
    currency: scope.currency,
    decimals: String(scope.decimals),
    periodStart: '',
    cutoff: scope.cutoff,
    multiplier: '',
    numberFormat: '',
    dateFormat: '',
  });
  const [headers, setHeaders] = useState(table.grid.roles.map(() => ''));
  const [currencyProof, setCurrencyProof] = useState('');
  const [confirmedTable, setConfirmedTable] = useState<VisualTable | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const checked = confirmedTable === table;
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const serial = useRef(0),
    alive = useRef({ active: true });
  useEffect(() => {
    const token = { active: true };
    alive.current = token;
    return () => {
      token.active = false;
    };
  }, [table]);
  function edit(k: keyof typeof fields, value: string) {
    setFields((p) => ({ ...p, [k]: value }));
    setConfirmedTable(null);
    setError(false);
    serial.current++;
  }
  async function transfer() {
    if (disabled || busy || !checked) return;
    const id = ++serial.current,
      activity = alive.current;
    setBusy(true);
    setError(false);
    try {
      const context: VisualAccountingContext = {
        ...fields,
        side: fields.side as 'supplier' | 'ledger',
        decimals: Number(fields.decimals) as 0 | 2 | 3,
        multiplier: Number(fields.multiplier) as 1 | -1,
        numberFormat: fields.numberFormat as 'dot' | 'comma',
        dateFormat: fields.dateFormat as 'ymd' | 'dmy' | 'mdy',
      };
      const record = await createVisualAccountingRecord(
        table,
        headers,
        context,
        new Date().toISOString(),
        currencyProof || null,
      );
      const bytes = await saveVisualAccountingRecord(record);
      if (id !== serial.current || !activity.active) return;
      const name =
        table.image.source.name.replace(/\.[^.]+$/, '') + VISUAL_SOURCE_SUFFIX;
      await onSource(
        new File([bytes.slice().buffer], name, { type: 'application/json' }),
        context.side === 'supplier' ? 0 : 1,
      );
    } catch {
      if (id === serial.current && activity.active) setError(true);
    } finally {
      if (id === serial.current && activity.active) setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    side: v.side,
    supplier: v.supplier,
    entity: v.entity,
    account: v.account,
    currency: v.currency,
    periodStart: v.start,
    cutoff: v.cutoff,
  };
  return (
    <details className="visual-accounting-review stack">
      <summary>{v.title}</summary>
      <p>{v.intro}</p>
      <p className="hint">{v.headerHint}</p>
      <p className="hint">{v.exclusionHint}</p>
      {table.version === 2 && <p className="hint">{v.splitHint}</p>}
      <div className="form-grid">
        {table.grid.roles.map((role, i) => (
          <label className="field" key={role}>
            {v.header(t.visualTable.roleNames[role])}
            <select
              aria-label={v.header(t.visualTable.roleNames[role])}
              disabled={disabled || busy}
              value={headers[i]}
              onChange={(e) => {
                setHeaders((p) =>
                  p.map((s, j) => (j === i ? e.target.value : s)),
                );
                setConfirmedTable(null);
                setError(false);
                serial.current++;
              }}
            >
              <option value="">{v.chooseHeader}</option>
              {visualHeaderCandidates(table, i).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.value}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!table.grid.roles.includes('currency') && (
        <label className="field">
          {v.currencyProof}
          <select
            aria-label={v.currencyProof}
            value={currencyProof}
            disabled={disabled || busy}
            onChange={(e) => {
              setCurrencyProof(e.target.value);
              setConfirmedTable(null);
              serial.current++;
            }}
          >
            <option value="">{v.chooseHeader}</option>
            {visualCurrencyCandidates(table).map((c) => (
              <option value={c.id} key={c.id}>
                {c.value}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label className="field">
          {v.side}
          <select
            aria-label={v.side}
            disabled={disabled || busy}
            value={fields.side}
            onChange={(e) => edit('side', e.target.value)}
          >
            <option value="supplier">{t.app.sides[0]}</option>
            <option value="ledger">{t.app.sides[1]}</option>
          </select>
        </label>
        {(
          [
            'supplier',
            'entity',
            'account',
            'currency',
            'periodStart',
            'cutoff',
          ] as const
        ).map((k) => (
          <label className="field" key={k}>
            {labels[k]}
            <input
              aria-label={labels[k]}
              disabled={disabled || busy}
              type={k === 'periodStart' || k === 'cutoff' ? 'date' : 'text'}
              value={fields[k]}
              maxLength={k === 'currency' ? 3 : 200}
              dir={k === 'currency' ? 'ltr' : 'auto'}
              onChange={(e) =>
                edit(
                  k,
                  k === 'currency'
                    ? e.target.value.toUpperCase()
                    : e.target.value,
                )
              }
            />
          </label>
        ))}
        <label className="field">
          {v.decimals}
          <select
            aria-label={v.decimals}
            value={fields.decimals}
            disabled={disabled || busy}
            onChange={(e) => edit('decimals', e.target.value)}
          >
            {[0, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {v.direction}
          <select
            aria-label={v.direction}
            value={fields.multiplier}
            disabled={disabled || busy}
            onChange={(e) => edit('multiplier', e.target.value)}
          >
            <option value="">{v.choose}</option>
            <option value="1">{v.sameSign}</option>
            <option value="-1">{v.reverseSign}</option>
          </select>
        </label>
        <label className="field">
          {v.numberFormat}
          <select
            aria-label={v.numberFormat}
            value={fields.numberFormat}
            disabled={disabled || busy}
            onChange={(e) => edit('numberFormat', e.target.value)}
          >
            <option value="">{v.choose}</option>
            <option value="dot">1,234.56</option>
            <option value="comma">1.234,56</option>
          </select>
        </label>
        <label className="field">
          {v.dateFormat}
          <select
            aria-label={v.dateFormat}
            value={fields.dateFormat}
            disabled={disabled || busy}
            onChange={(e) => edit('dateFormat', e.target.value)}
          >
            <option value="">{v.choose}</option>
            {(['ymd', 'dmy', 'mdy'] as const).map((f) => (
              <option key={f} value={f}>
                {t.app.dateFormats[f]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="tick">
        <input
          type="checkbox"
          aria-label={v.confirm}
          disabled={disabled || busy}
          checked={checked}
          onChange={(e) => setConfirmedTable(e.target.checked ? table : null)}
        />
        {v.confirm}
      </label>
      {error && (
        <p role="alert" className="hint warn">
          {v.failed}
        </p>
      )}
      <Button
        variant="outline"
        onClick={() => void transfer()}
        disabled={
          disabled ||
          busy ||
          !checked ||
          !table.coverage ||
          headers.some((h) => !h) ||
          (!table.grid.roles.includes('currency') && !currencyProof) ||
          [
            'supplier',
            'entity',
            'currency',
            'periodStart',
            'cutoff',
            'multiplier',
            'numberFormat',
            'dateFormat',
          ].some((k) => !fields[k as keyof typeof fields])
        }
      >
        {busy ? v.busy : v.use}
      </Button>
      <p className="hint">{v.limits}</p>
    </details>
  );
}
