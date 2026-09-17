import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Check, Upload, FileCheck2 } from 'lucide-react';

/** A visual affordance only; it never represents parsed or matched values. */
function UploadIllustration() {
  const id = `source-art-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className="source-card__drawing"
      viewBox="0 0 180 126"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${id}-paper`}
          x1="60"
          y1="5"
          x2="128"
          y2="101"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F4F7FD" />
        </linearGradient>
        <linearGradient
          id={`${id}-base`}
          x1="40"
          y1="100"
          x2="140"
          y2="119"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="currentColor" stopOpacity=".09" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".2" />
        </linearGradient>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-20%"
          width="180%"
          height="150%"
        >
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="3"
            floodColor="#263B65"
            floodOpacity=".1"
          />
        </filter>
      </defs>
      <ellipse
        cx="90"
        cy="117"
        rx="54"
        ry="5"
        fill="currentColor"
        opacity=".04"
      />
      <path
        d="M36 107C36 99 60 93 90 93S144 99 144 107V110C144 118 120 123 90 123S36 118 36 110Z"
        fill={`url(#${id}-base)`}
      />
      <ellipse
        cx="90"
        cy="106"
        rx="54"
        ry="12"
        fill="#FFFFFF"
        stroke="currentColor"
        strokeOpacity=".13"
      />
      <ellipse
        cx="90"
        cy="106"
        rx="41"
        ry="7"
        fill="currentColor"
        opacity=".045"
      />
      <g className="source-card__paper">
        <rect
          x="64"
          y="8"
          width="68"
          height="96.17"
          rx="5"
          fill="#E7EDF7"
          stroke="currentColor"
          strokeOpacity=".12"
        />
        <rect
          x="60"
          y="5"
          width="68"
          height="96.17"
          rx="5"
          fill={`url(#${id}-paper)`}
          stroke="currentColor"
          strokeOpacity=".25"
          filter={`url(#${id}-shadow)`}
        />
        <path
          d="M104 21h12M92 29h24"
          stroke="currentColor"
          strokeOpacity=".5"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <rect
          x="71"
          y="18"
          width="11"
          height="13"
          rx="2"
          fill="currentColor"
          opacity=".12"
        />
        <rect
          x="71"
          y="42"
          width="46"
          height="42"
          rx="3"
          fill="#FFFFFF"
          stroke="currentColor"
          strokeOpacity=".16"
        />
        <path d="M72 43h44v9H72Z" fill="currentColor" opacity=".08" />
        <path
          d="M72 52h44M72 62h44M72 73h44M86 43v40M102 43v40"
          stroke="currentColor"
          strokeOpacity=".15"
        />
        <path
          d="M77 57h4M91 57h6M107 57h5M77 67h4M91 67h6M107 67h5M77 78h4M91 78h6M107 78h5"
          stroke="currentColor"
          strokeOpacity=".35"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M94 91h22"
          stroke="currentColor"
          strokeOpacity=".23"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <circle cx="135" cy="86" r="16" fill="currentColor" opacity=".12" />
      <circle
        cx="134"
        cy="83"
        r="16"
        fill="#FFFFFF"
        stroke="currentColor"
        strokeOpacity=".25"
        filter={`url(#${id}-shadow)`}
      />
      <path
        d="M134 77v12M128 83h12"
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
          ? 'انتظر انتهاء القراءة أو ألغها قبل إضافة ملف آخر.'
          : 'نجهّز أداة القراءة. انتظر قليلًا ثم أضف الملف.',
      );
      return;
    }
    if (files.length !== 1) {
      onError(
        'أرفقت أكثر من ملف. أضف ملفًا واحدًا في كل خانة. ملفاتك الحالية لم تتغير.',
      );
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
          'المعالجة جارية على جهازك'
        ) : !ready ? (
          'نجهّز أداة القراءة'
        ) : filename ? (
          <>
            <Check size={15} aria-hidden="true" /> قرأنا الملف. راجع بياناته في
            الخطوة التالية.
          </>
        ) : dragging ? (
          'أفلت الملف هنا'
        ) : (
          'اسحب الملف هنا أو اختره من جهازك'
        )}
      </span>
      <label className="file-button source-card__choose">
        <Upload size={16} aria-hidden="true" />
        {filename ? 'استبدال الملف' : 'اختيار ملف'}
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
