/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG supplies a crop viewport and needs an accessible image role. */
import { useId, useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import {
  editVisualCell,
  removeVisualCell,
  isVisualLiteral,
  type VisualReview,
  type VisualCellRole,
} from '@/lib/reconciliation/visual-review';

/** A source crop plus one literal attestation, never a transaction approval. */
export function VisualCellReview({
  record,
  wordId,
  disabled,
  onChange,
  onConfirm,
}: {
  record: VisualReview;
  wordId: string;
  disabled: boolean;
  onChange: (next: VisualReview) => void;
  onConfirm: (id: string) => void;
}) {
  const { t } = useI18n(),
    v = t.visualReview;
  const cropId = useId();
  const page = record.draft.pages[0],
    word = page.words.find((w) => w.id === wordId)!;
  const cell = record.cells.find((c) => c.wordId === wordId);
  const [literal, setLiteral] = useState(cell?.value ?? word.text);
  const [role, setRole] = useState<VisualCellRole | ''>(cell?.role ?? '');
  const region = cell?.region ?? {
    x0: Math.max(0, word.bbox.x0 - 64),
    y0: Math.max(0, word.bbox.y0 - 24),
    x1: Math.min(page.width, word.bbox.x1 + 64),
    y1: Math.min(page.height, word.bbox.y1 + 24),
  };
  function change(nextRole: VisualCellRole | '', nextLiteral: string) {
    setRole(nextRole);
    setLiteral(nextLiteral);
    if (!nextRole || !isVisualLiteral(nextLiteral))
      onChange(removeVisualCell(record, wordId));
    else
      onChange(editVisualCell(record, wordId, nextRole, nextLiteral, region));
  }
  return (
    <section className="visual-cell-review stack" aria-label={v.cellLabel}>
      <h4>{v.cellTitle}</h4>
      {/* A vector viewport crops the verified local PNG without resampling it. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <svg
        className="visual-cell-crop"
        role="img"
        aria-label={v.crop}
        viewBox={`${region.x0} ${region.y0} ${region.x1 - region.x0} ${region.y1 - region.y0}`}
      >
        <defs>
          <clipPath id={cropId} clipPathUnits="userSpaceOnUse">
            <rect
              x={region.x0}
              y={region.y0}
              width={region.x1 - region.x0}
              height={region.y1 - region.y0}
            />
          </clipPath>
        </defs>
        <image
          href={page.imageDataUrl}
          width={page.width}
          height={page.height}
          clipPath={`url(#${cropId})`}
        />
        <rect
          x={word.bbox.x0}
          y={word.bbox.y0}
          width={word.bbox.x1 - word.bbox.x0}
          height={word.bbox.y1 - word.bbox.y0}
          fill="none"
          stroke="#b45309"
          strokeWidth="1"
        />
      </svg>
      <small>
        {v.observed} <bdi>{word.text}</bdi>
      </small>
      <div className="visual-cell-fields">
        <label className="field">
          {v.role}
          <select
            aria-label={v.role}
            value={role}
            disabled={disabled}
            onChange={(e) =>
              change(e.target.value as VisualCellRole | '', literal)
            }
          >
            <option value="">{v.chooseRole}</option>
            {(['amount', 'date', 'reference', 'currency'] as const).map((r) => (
              <option key={r} value={r}>
                {v.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {v.value}
          <input
            aria-label={v.value}
            value={literal}
            maxLength={512}
            disabled={disabled}
            onChange={(e) => change(role, e.target.value)}
            dir="auto"
          />
        </label>
      </div>
      <small>{v.valueHint}</small>
      <output className={cell?.review ? 'notice' : 'hint'}>
        {cell?.review ? v.reviewed : v.pending}
      </output>
      <Button
        variant="outline"
        disabled={disabled || !cell || !!cell.review}
        onClick={() => onConfirm(wordId)}
      >
        {v.confirm}
      </Button>
    </section>
  );
}
