/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG is a precisely clipped accessible image viewport. */
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';
import { Button } from './ui/button';
import { VisualCropPicker } from './visual-crop-picker';
import {
  isVisualLiteral,
  type VisualReview,
  type VisualCell,
} from '@/lib/reconciliation/visual-review';
import {
  createVisualTable,
  editVisualTableRow,
  confirmVisualTableCoverage,
  confirmVisualTableExclusion,
  tableCellCandidates,
  tableRowBox,
  visualTableCounts,
  saveVisualTable,
  type VisualTable,
  type TableRow,
  type TableRole,
} from '@/lib/reconciliation/visual-table';

const editable = (r: TableRow) => ({
  disposition: r.disposition,
  note: r.note,
  cells: [...r.cells],
});
function coordinates(input: string): number[] {
  if (input.length > 2048) throw new Error('coordinates');
  const parts = input.split(',');
  if (parts.length > 201 || parts.some((s) => !/^\d{1,4}$/.test(s.trim())))
    throw new Error('coordinates');
  return parts.map((s) => Number(s.trim()));
}
function RowReview({
  table,
  index,
  disabled,
  onEdit,
  onConfirm,
}: {
  table: VisualTable;
  index: number;
  disabled: boolean;
  onEdit: (index: number, fields: Omit<TableRow, 'id' | 'review'>) => void;
  onConfirm: (index: number) => void;
}) {
  const { t } = useI18n(),
    v = t.visualTable,
    clip = useId();
  const row = table.rows[index],
    box = tableRowBox(table, index),
    page = table.image.draft.pages[0];
  const [fields, setFields] = useState(() => editable(row));
  function change(next: ReturnType<typeof editable>) {
    setFields(next);
    // A pending empty reason must not leave a previous reviewed exclusion
    // hidden behind the input the reviewer just changed.
    onEdit(
      index,
      (next.disposition === 'unreadable' ||
        next.disposition === 'non-movement') &&
        !isVisualLiteral(next.note)
        ? {
            disposition: 'unclassified',
            note: '',
            cells: next.cells.map(() => null),
          }
        : next,
    );
  }
  return (
    <section className="visual-table-row stack" aria-label={v.row(index + 1)}>
      <h4>{v.row(index + 1)}</h4>
      <svg
        className="visual-table-crop"
        role="img"
        aria-label={t.visualReview.crop}
        viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`}
      >
        <defs>
          <clipPath id={clip} clipPathUnits="userSpaceOnUse">
            <rect
              x={box.x0}
              y={box.y0}
              width={box.x1 - box.x0}
              height={box.y1 - box.y0}
            />
          </clipPath>
        </defs>
        <image
          href={page.imageDataUrl}
          width={page.width}
          height={page.height}
          clipPath={`url(#${clip})`}
        />
      </svg>
      <label className="field">
        {v.disposition}
        <select
          aria-label={v.disposition}
          disabled={disabled}
          value={fields.disposition}
          onChange={(e) =>
            change({
              ...fields,
              disposition: e.target.value as TableRow['disposition'],
              cells: fields.cells.map(() => null),
            })
          }
        >
          {(
            ['unclassified', 'movement', 'non-movement', 'unreadable'] as const
          ).map((d) => (
            <option key={d} value={d}>
              {v.dispositions[d]}
            </option>
          ))}
        </select>
      </label>
      {(fields.disposition === 'non-movement' ||
        fields.disposition === 'unreadable') && (
        <label className="field">
          {v.note}
          <input
            aria-label={v.note}
            maxLength={512}
            dir="auto"
            disabled={disabled}
            value={fields.note}
            onChange={(e) => change({ ...fields, note: e.target.value })}
          />
        </label>
      )}
      {fields.disposition === 'movement' && (
        <>
          <small>{v.cropHint}</small>
          <div className="visual-table-fields">
            {table.grid.roles.map((role, col) => (
              <label className="field" key={role}>
                {v.roleNames[role]}
                <select
                  aria-label={v.roleNames[role]}
                  disabled={disabled}
                  value={fields.cells[col] ?? ''}
                  onChange={(e) =>
                    change({
                      ...fields,
                      cells: fields.cells.map((c, i) =>
                        i === col ? e.target.value || null : c,
                      ),
                    })
                  }
                >
                  <option value="">{v.noCell}</option>
                  {tableCellCandidates(table, index, col).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.value}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
      {row.disposition === 'non-movement' && (
        <>
          {row.review && <output>{v.exclusionChecked}</output>}
          <Button
            variant="outline"
            disabled={disabled || !!row.review}
            onClick={() => onConfirm(index)}
          >
            {v.confirmExcluded}
          </Button>
        </>
      )}
    </section>
  );
}

/** Mounted against one immutable cell record. Any edit to that record remounts
 * this panel and drops its table proofs; cancelled asynchronous work cannot win. */
export function VisualTableReview({
  image,
  initial,
  disabled,
}: {
  image: VisualReview;
  initial?: VisualTable | null;
  disabled: boolean;
}) {
  const { t } = useI18n(),
    v = t.visualTable,
    page = image.draft.pages[0];
  const [table, setTable] = useState<VisualTable | null>(initial ?? null);
  const [box, setBox] = useState<VisualCell['region'] | null>(
    initial?.grid.region ?? null,
  );
  const [rows, setRows] = useState(initial?.grid.rowCuts.join(', ') ?? '');
  const [columns, setColumns] = useState(
    initial?.grid.columnCuts.join(', ') ?? '',
  );
  const [roles, setRoles] = useState<TableRole[]>(
    initial ? [...initial.grid.roles] : ['amount'],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const operation = useRef(0),
    current = useRef(table);
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );
  function update(value: VisualTable | null) {
    current.current = value;
    setTable(value);
  }
  function invalidate() {
    update(null);
    setError(false);
    operation.current++;
  }
  let columnCount = 0;
  try {
    columnCount = Math.min(8, Math.max(0, coordinates(columns).length - 1));
  } catch {
    /* Invalid draft coordinates are checked on Create. */
  }
  async function run(
    action: 'create' | 'exclusion' | 'coverage' | 'save',
    row = -1,
  ) {
    if (busy || disabled || (action !== 'create' && !current.current)) return;
    const token = ++operation.current,
      snapshot = current.current;
    setBusy(true);
    setError(false);
    try {
      let next: VisualTable | null = null;
      if (action === 'create') {
        if (!box) throw new Error('box');
        next = await createVisualTable(image, {
          region: box,
          rowCuts: coordinates(rows),
          columnCuts: coordinates(columns),
          roles: roles.slice(0, columnCount),
        });
      } else if (action === 'exclusion')
        next = await confirmVisualTableExclusion(
          snapshot!,
          row,
          new Date().toISOString(),
        );
      else if (action === 'coverage')
        next = await confirmVisualTableCoverage(
          snapshot!,
          new Date().toISOString(),
        );
      else {
        const bytes = await saveVisualTable(snapshot!);
        if (operation.current === token && current.current === snapshot) {
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: 'application/json' }),
          );
          const a = document.createElement('a');
          a.href = url;
          a.download = `tarasuf-visual-table-${image.source.sha256.slice(0, 8)}.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (next && operation.current === token && current.current === snapshot)
        update(next);
    } catch {
      if (operation.current === token) setError(true);
    } finally {
      if (operation.current === token) setBusy(false);
    }
  }
  const counts = table ? visualTableCounts(table) : null;
  return (
    <details className="visual-table-review stack" open={!!initial}>
      <summary>{v.title}</summary>
      <p>{v.intro}</p>
      <small>{v.limits}</small>
      <p>{v.choose}</p>
      <VisualCropPicker
        image={page.imageDataUrl}
        width={page.width}
        height={page.height}
        alt={t.visualReader.originalImage(1)}
        enabled
        disabled={disabled || busy}
        highlight={box ?? undefined}
        onPick={(region) => {
          invalidate();
          setBox(region);
          setRows(`${region.y0}, ${region.y1}`);
          setColumns(`${region.x0}, ${region.x1}`);
          setRoles(['amount']);
        }}
      />
      {box && (
        <>
          <output dir="ltr">
            x: {box.x0}–{box.x1} / y: {box.y0}–{box.y1}
          </output>
          <div className="visual-table-fields">
            <label className="field">
              {v.rowCuts}
              <input
                aria-label={v.rowCuts}
                value={rows}
                dir="ltr"
                maxLength={2048}
                disabled={disabled || busy}
                onChange={(e) => {
                  invalidate();
                  setRows(e.target.value);
                }}
              />
            </label>
            <label className="field">
              {v.columnCuts}
              <input
                aria-label={v.columnCuts}
                value={columns}
                dir="ltr"
                maxLength={100}
                disabled={disabled || busy}
                onChange={(e) => {
                  invalidate();
                  setColumns(e.target.value);
                }}
              />
            </label>
          </div>
          <small>{v.cutsHint}</small>
          <fieldset className="visual-table-fields">
            <legend>{v.roles}</legend>
            {Array.from({ length: columnCount }, (_, i) => (
              <select
                key={i}
                aria-label={`${v.roles} ${i + 1}`}
                value={roles[i] ?? 'amount'}
                disabled={disabled || busy}
                onChange={(e) => {
                  invalidate();
                  setRoles(
                    Array.from({ length: columnCount }, (_, j) =>
                      j === i
                        ? (e.target.value as TableRole)
                        : (roles[j] ?? 'amount'),
                    ),
                  );
                }}
              >
                {(
                  [
                    'reference',
                    'date',
                    'amount',
                    'balance',
                    'currency',
                  ] as const
                ).map((r) => (
                  <option key={r} value={r}>
                    {v.roleNames[r]}
                  </option>
                ))}
              </select>
            ))}
          </fieldset>
          <Button
            variant="outline"
            disabled={disabled || busy}
            onClick={() => void run('create')}
          >
            {table ? v.replace : v.create}
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="notice error">
          {v.failed}
        </p>
      )}
      {busy && <output>{v.saving}</output>}
      {table && counts && (
        <>
          <output className="notice">
            {v.counts(
              counts.movements,
              counts.excluded,
              counts.unreadable,
              counts.unclassified,
              counts.missingCells,
            )}
          </output>
          {!!counts.unassignedCrops && (
            <output className="notice">
              {v.unassigned(counts.unassignedCrops)}
            </output>
          )}
          {table.rows.map((r, i) => (
            <RowReview
              key={`${table.revision}:${r.id}`}
              table={table}
              index={i}
              disabled={disabled || busy}
              onEdit={(index, fields) => {
                try {
                  update(editVisualTableRow(current.current!, index, fields));
                  setError(false);
                } catch {
                  update(
                    editVisualTableRow(current.current!, index, {
                      disposition: 'unclassified',
                      note: '',
                      cells: table.grid.roles.map(() => null),
                    }),
                  );
                  setError(true);
                }
              }}
              onConfirm={(index) => void run('exclusion', index)}
            />
          ))}
          <p className="hint">{v.coverageHint}</p>
          <output>{table.coverage ? v.covered : v.pending}</output>
          <div className="visual-crop-actions">
            <Button
              variant="outline"
              disabled={
                disabled ||
                busy ||
                !!table.coverage ||
                !!counts.unclassified ||
                !!counts.uncheckedExclusions ||
                !!counts.unassignedCrops
              }
              onClick={() => void run('coverage')}
            >
              {v.coverage}
            </Button>
            <Button
              variant="outline"
              disabled={disabled || busy}
              onClick={() => void run('save')}
            >
              {v.save}
            </Button>
          </div>
          <p className="hint">{v.onlyEvidence}</p>
        </>
      )}
    </details>
  );
}
