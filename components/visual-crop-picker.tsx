import { useRef, useState, type PointerEvent } from 'react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';
import {
  cropBetween,
  moveCrop,
  type VisualBox,
} from '@/lib/reconciliation/visual-crop';

/** Selection changes no record until Use crop is pressed. Cancel drops it. */
export function VisualCropPicker({
  image,
  width,
  height,
  alt,
  enabled,
  disabled,
  highlight,
  editing,
  onPick,
}: {
  image: string;
  width: number;
  height: number;
  alt: string;
  enabled: boolean;
  disabled: boolean;
  highlight?: VisualBox;
  editing?: VisualBox;
  onPick: (box: VisualBox, fresh: boolean) => void;
}) {
  const { t } = useI18n(),
    v = t.visualReview;
  const [active, setActive] = useState(false);
  const [box, setBox] = useState<VisualBox | null>(null);
  const [fresh, setFresh] = useState(true);
  const anchor = useRef<{ point: [number, number]; pointerId: number } | null>(
    null,
  );
  const shown = active ? box : highlight;
  function start(newRegion: boolean) {
    setFresh(newRegion);
    setBox(
      !newRegion && editing
        ? editing
        : {
            x0: Math.floor(width / 4),
            x1: Math.ceil((3 * width) / 4),
            y0: Math.floor(height / 3),
            y1: Math.min(height, Math.floor(height / 3) + 80),
          },
    );
    setActive(true);
    anchor.current = null;
  }
  function point(e: PointerEvent<HTMLButtonElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * width) / r.width,
      ((e.clientY - r.top) * height) / r.height,
    ];
  }
  function accept() {
    if (!box || disabled || anchor.current) return;
    onPick(box, fresh);
    setActive(false);
  }
  const visual = (
    <>
      {/* oxlint-disable-next-line next/no-img-element */}
      <img
        src={image}
        alt={alt}
        draggable={false}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {shown && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            border: '2px solid #d97706',
            background: '#f59e0b20',
            pointerEvents: 'none',
            left: `${(shown.x0 / width) * 100}%`,
            top: `${(shown.y0 / height) * 100}%`,
            width: `${((shown.x1 - shown.x0) / width) * 100}%`,
            height: `${((shown.y1 - shown.y0) / height) * 100}%`,
          }}
        />
      )}
    </>
  );
  return (
    <div className="stack">
      {active ? (
        <button
          type="button"
          className="visual-crop-surface"
          aria-label={v.selectSurface}
          disabled={disabled}
          onPointerDown={(e) => {
            if (disabled || !e.isPrimary || e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            anchor.current = { point: point(e), pointerId: e.pointerId };
            setBox(null);
          }}
          onPointerMove={(e) => {
            if (!anchor.current || anchor.current.pointerId !== e.pointerId)
              return;
            setBox(cropBetween(anchor.current.point, point(e), width, height));
          }}
          onPointerUp={(e) => {
            if (!anchor.current || anchor.current.pointerId !== e.pointerId)
              return;
            setBox(cropBetween(anchor.current.point, point(e), width, height));
            anchor.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            anchor.current = null;
            setBox(null);
          }}
          onLostPointerCapture={() => {
            anchor.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setActive(false);
              anchor.current = null;
            } else if (e.key === 'Enter') {
              e.preventDefault();
              accept();
            } else if (box && e.key.startsWith('Arrow')) {
              e.preventDefault();
              setBox(moveCrop(box, e.key, e.shiftKey, width, height));
            }
          }}
        >
          {visual}
        </button>
      ) : (
        <div
          style={{
            position: 'relative',
            border: '1px solid var(--border)',
            lineHeight: 0,
          }}
        >
          {visual}
        </div>
      )}
      {enabled && (
        <div className="stack">
          {active ? (
            <>
              <small>{v.selectHelp}</small>
              <div className="visual-crop-actions">
                <Button
                  variant="outline"
                  disabled={disabled || !box}
                  onClick={accept}
                >
                  {v.useCrop}
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setActive(false);
                    anchor.current = null;
                  }}
                >
                  {v.cancelCrop}
                </Button>
              </div>
            </>
          ) : (
            <div className="visual-crop-actions">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => start(true)}
              >
                {v.addCrop}
              </Button>
              {editing && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => start(false)}
                >
                  {v.changeCrop}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
