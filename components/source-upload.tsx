import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Check, Upload, FileCheck2 } from 'lucide-react';

/** A visual affordance only; it never represents parsed or matched values. */
function UploadIllustration() {
  return (
    <svg
      className="source-card__drawing"
      viewBox="0 0 180 126"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="88"
        cy="111"
        rx="52"
        ry="5"
        fill="currentColor"
        opacity=".07"
      />
      <path
        d="M35 99V36a8 8 0 0 1 8-8h22"
        stroke="currentColor"
        opacity=".18"
        strokeWidth="1.5"
      />
      <g className="source-card__paper">
        <path
          d="M65 9h51l19 20v71a7 7 0 0 1-7 7H65a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z"
          fill="white"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeWidth="1.5"
        />
        <path
          d="M115 10v15a5 5 0 0 0 5 5h14"
          fill="currentColor"
          fillOpacity=".05"
          stroke="currentColor"
          strokeOpacity=".3"
          strokeWidth="1.5"
        />
        <path
          d="M75 34h22M75 43h35"
          stroke="currentColor"
          strokeOpacity=".35"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect
          x="73"
          y="56"
          width="47"
          height="33"
          rx="3"
          fill="currentColor"
          fillOpacity=".045"
          stroke="currentColor"
          strokeOpacity=".15"
        />
        <path
          d="M74 67h45M74 78h45M88 57v31M105 57v31"
          stroke="currentColor"
          strokeOpacity=".16"
        />
      </g>
      <circle
        cx="132"
        cy="96"
        r="17"
        fill="white"
        stroke="currentColor"
        strokeOpacity=".2"
      />
      <path
        d="M132 90v12M126 96h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SourceUpload({
  side,
  label,
  filename,
  busy,
  ready,
  onFile,
  onError,
}: {
  side: number;
  label: string;
  filename?: string;
  busy: boolean;
  ready: boolean;
  onFile: (file: File) => void;
  onError: (message: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [blocked, setBlocked] = useState('');
  useEffect(() => {
    setBlocked('');
  }, [busy, ready]);
  const depth = useRef(0);
  const disabled = busy || !ready;
  const stateId = `source-state-${side}`;
  function hasFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }
  function select(files: FileList | null) {
    if (!files?.length) return;
    if (disabled) {
      setBlocked(
        busy
          ? 'انتظر اكتمال القراءة الحالية أو ألغها قبل إضافة ملف آخر.'
          : 'انتظر تجهيز المحرك قبل إضافة الملف.',
      );
      return;
    }
    if (files.length !== 1) {
      onError('أضف ملفًا واحدًا لكل جهة. لم تُستبدل الملفات الحالية.');
      return;
    }
    onFile(files[0]);
  }
  return (
    <article
      className={`dropzone source-card ${filename ? 'has-file' : ''}`}
      data-side={side}
      data-drag-active={dragging && !disabled ? 'true' : 'false'}
      aria-disabled={disabled}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        select(event.dataTransfer.files);
      }}
    >
      <div className="source-card__top" aria-hidden="true">
        <span>{side === 0 ? 'من المورد' : 'من نظامك'}</span>
        <bdi>{side === 0 ? '01' : '02'}</bdi>
      </div>
      <div className="source-card__art">
        {filename ? (
          <FileCheck2
            className="source-card__loaded"
            strokeWidth={1.2}
            aria-hidden="true"
          />
        ) : (
          <UploadIllustration />
        )}
      </div>
      <h3>{label}</h3>
      <p className="source-card__description">
        {filename ? (
          <bdi>{filename}</bdi>
        ) : side === 0 ? (
          'الكشف الذي استلمته من المورد'
        ) : (
          'التقرير المستخرج من نظامك المحاسبي'
        )}
      </p>
      <span
        className="source-card__state"
        id={stateId}
        role={blocked ? 'alert' : undefined}
      >
        {blocked ? (
          blocked
        ) : busy ? (
          'تجري المعالجة على جهازك…'
        ) : !ready ? (
          'جارٍ تجهيز المحرك…'
        ) : filename ? (
          <>
            <Check size={15} aria-hidden="true" /> تمت قراءة الملف — التأكيد في
            الخطوة التالية
          </>
        ) : dragging ? (
          'أفلت الملف هنا'
        ) : (
          'اسحب ملفًا هنا، أو اختره من جهازك'
        )}
      </span>
      <label className="file-button source-card__choose">
        <Upload size={16} aria-hidden="true" />
        {filename ? 'استبدال الملف' : 'اختيار ملف من الجهاز'}
        <input
          type="file"
          accept=".xlsx,.csv,.pdf"
          aria-label={label}
          aria-describedby={`source-file-limits ${stateId}`}
          disabled={disabled}
          onChange={(event) => {
            select(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
    </article>
  );
}
