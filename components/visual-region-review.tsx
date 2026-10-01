/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG is a precisely clipped accessible image viewport. */
import { useId, useState } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import {
  editVisualRegion,
  removeVisualRegion,
  visualRegions,
  isVisualLiteral,
  type VisualReview,
  type VisualCellRole,
  type VisualCell,
} from '@/lib/reconciliation/visual-review';

export function VisualRegionReview({
  record,
  id,
  region,
  disabled,
  onChange,
  onConfirm,
  onRemove,
  onError,
}: {
  record: VisualReview;
  id: string;
  region: VisualCell['region'];
  disabled: boolean;
  onChange: (r: VisualReview) => void;
  onConfirm: (id: string) => void;
  onRemove: () => void;
  onError: (failure: unknown) => void;
}) {
  const { t } = useI18n(),
    v = t.visualReview,
    clip = useId();
  const cell = visualRegions(record).find((c) => c.id === id);
  const page = record.draft.pages[0];
  const [literal, setLiteral] = useState(cell?.value ?? '');
  const [role, setRole] = useState<VisualCellRole | ''>(cell?.role ?? '');
  function change(r: VisualCellRole | '', text: string) {
    setRole(r);
    setLiteral(text);
    try {
      onChange(
        r && isVisualLiteral(text)
          ? editVisualRegion(record, id, r, text, region)
          : removeVisualRegion(record, id),
      );
    } catch (failure) {
      onChange(removeVisualRegion(record, id));
      onError(failure);
    }
  }
  return (
    <section className="visual-cell-review stack" aria-label={v.regionLabel}>
      <h4>{v.regionTitle}</h4>
      <svg
        className="visual-cell-crop"
        role="img"
        aria-label={v.crop}
        viewBox={`${region.x0} ${region.y0} ${region.x1 - region.x0} ${region.y1 - region.y0}`}
      >
        <defs>
          <clipPath id={clip} clipPathUnits="userSpaceOnUse">
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
          clipPath={`url(#${clip})`}
        />
      </svg>
      <small>{v.manualHint}</small>
      {cell && (
        <small>
          {v.observed}{' '}
          {cell.observed.length
            ? cell.observed.map((o) => (
                <span key={o.wordId}>
                  <bdi>{o.text}</bdi>
                  {o.complete ? ' ' : ` (${v.partialWord}) `}
                </span>
              ))
            : v.noObservation}
        </small>
      )}
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
            dir="auto"
            onChange={(e) => change(role, e.target.value)}
          />
        </label>
      </div>
      <small>{v.valueHint}</small>
      <output className={cell?.review ? 'notice' : 'hint'}>
        {cell?.review ? v.reviewed : v.pending}
      </output>
      <div className="visual-crop-actions">
        <Button
          variant="outline"
          disabled={disabled || !cell || !!cell.review}
          onClick={() => onConfirm(id)}
        >
          {v.confirm}
        </Button>
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            onChange(removeVisualRegion(record, id));
            onRemove();
          }}
        >
          {v.removeCrop}
        </Button>
      </div>
    </section>
  );
}
