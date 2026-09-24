import { useEffect, useId, useRef, useState } from 'react';
import '../app/document-scene.css';
import { useI18n } from '@/lib/i18n/context';

// A4 proportions are preserved in the drawing and at every responsive size.
const PAPER_WIDTH = 196;
const PAPER_HEIGHT = 277.2; // 196 × 297 / 210

/** Paper, ink and its own scan share local coordinates. The scan's entire
 * travel stays inside the page; a separate clip also prevents any light spill. */
function StatementSheet({
  kind,
  prefix,
}: {
  kind: 'supplier' | 'ledger';
  prefix: string;
}) {
  const { t, lang, dir } = useI18n();
  const supplier = kind === 'supplier';
  const clip = `${prefix}-${kind}-paper`;
  const beam = `${prefix}-${kind}-scan-beam`;
  const accent = supplier ? '#386FD4' : '#7951CB';
  const position = supplier
    ? 'translate(78 27) rotate(-5 98 277.2)'
    : 'translate(286 27) rotate(5 98 277.2)';
  return (
    <g className={`document-scene__float document-scene__float--${kind}`}>
      <g
        className={`document-scene__sheet document-scene__sheet--${kind}`}
        data-paper-kind={kind}
        transform={position}
      >
        <defs>
          <clipPath id={clip}>
            <rect x="1" y="1" width="194" height="275.2" rx="8" />
          </clipPath>
          <linearGradient
            id={beam}
            x1="0"
            y1="-25"
            x2="0"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={accent} stopOpacity="0" />
            <stop offset="1" stopColor={accent} stopOpacity=".12" />
          </linearGradient>
        </defs>
        <rect
          className="document-scene__paper-edge"
          x="3"
          y="4"
          width={PAPER_WIDTH}
          height={PAPER_HEIGHT}
          rx="9"
          fill="#EDF1F8"
          stroke="#D5DEEC"
        />
        <rect
          className="document-scene__paper"
          width={PAPER_WIDTH}
          height={PAPER_HEIGHT}
          rx="9"
          fill={`url(#${prefix}-paper)`}
          stroke="#D4DEEC"
          filter={`url(#${prefix}-paper-shadow)`}
        />
        <g className="document-scene__paper-content" clipPath={`url(#${clip})`}>
          <path
            d="M1 10A9 9 0 0 1 10 1H186A9 9 0 0 1 195 10"
            fill="none"
            stroke="#FFFFFF"
          />
          <rect
            x="20"
            y="18"
            width="64"
            height="25"
            rx="6"
            fill={supplier ? '#EEF4FF' : '#F3EEFC'}
          />
          <path
            d="M28 24h6l4 4v9H28zM34 24v5h4"
            fill="none"
            stroke={accent}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <text
            className="document-scene__file-type"
            x="44"
            y="35"
            direction="ltr"
            textAnchor="start"
            unicodeBidi="isolate"
            fill={accent}
          >
            {supplier ? 'PDF' : 'XLSX'}
          </text>
          <g transform="translate(153 18) scale(.26)">
            <path
              d="M10 39C10 31 14 25 22 21L67 0C71-2 74 0 74 5V14C74 22 70 28 63 32L15 55C12 57 10 55 10 51Z"
              fill={accent}
            />
            <path
              d="M4 80C4 72 8 66 16 62L67 37C71 35 74 37 74 42V51C74 59 70 65 63 69L9 96C6 98 4 96 4 92Z"
              fill="#A8B4CF"
            />
          </g>
          <text
            className="document-scene__paper-title"
            x="176"
            y="72"
            direction={dir}
            lang={lang}
            // Ends at the same edge in either direction.
            textAnchor={dir === 'rtl' ? 'start' : 'end'}
          >
            {supplier ? t.scene.supplierPaper : t.scene.ledgerPaper}
          </text>
          <path
            d="M115 85H176M138 94H176"
            stroke="#C7D1E1"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect
            x="20"
            y="106"
            width="156"
            height="118"
            rx="4"
            fill="#FFFFFF"
            stroke="#E0E6EF"
          />
          <path
            d="M24 106H172Q176 106 176 110V128H20V110Q20 106 24 106Z"
            fill={supplier ? '#EFF5FD' : '#F4F0FC'}
          />
          <path d="M67 106V224M126 106V224" stroke="#E5EAF2" />
          <path d="M20 128H176" stroke="#DDE4EF" />
          {[0, 1, 2].map((column) => (
            <rect
              key={column}
              x={[29, 78, 139][column]}
              y="116"
              width={[27, 37, 25][column]}
              height="2.6"
              rx="1.3"
              fill={accent}
              opacity=".55"
            />
          ))}
          {Array.from({ length: 6 }, (_, row) => (
            <g className="document-scene__table-row" key={row}>
              {row > 0 && (
                <path d={`M20 ${128 + row * 16}H176`} stroke="#EDF0F5" />
              )}
              <rect
                x="29"
                y={135 + row * 16}
                width={row % 2 ? 25 : 19}
                height="2.4"
                rx="1.2"
                fill="#B8C5D9"
              />
              <rect
                x={row % 2 ? 86 : 77}
                y={135 + row * 16}
                width={row % 2 ? 29 : 38}
                height="2.4"
                rx="1.2"
                fill="#C5D0E0"
              />
              <rect
                x="139"
                y={135 + row * 16}
                width={row % 3 ? 25 : 19}
                height="2.4"
                rx="1.2"
                fill={row === 2 ? accent : '#B8C5D9'}
                opacity={row === 2 ? 0.65 : 1}
              />
            </g>
          ))}
          <path d="M20 247H119" stroke="#D5DEEB" />
          <circle cx="154" cy="247" r="2" fill={accent} opacity=".5" />
          <circle cx="165" cy="247" r="2" fill="#D4DCE9" />
          <circle cx="176" cy="247" r="2" fill="#D4DCE9" />
        </g>
        <g
          className="document-scene__paper-scan-window"
          clipPath={`url(#${clip})`}
        >
          <g
            className={`document-scene__paper-scan document-scene__paper-scan--${kind}`}
            data-scan-kind={kind}
          >
            <rect
              x="10"
              y="-25"
              width="176"
              height="25"
              fill={`url(#${beam})`}
            />
            <path
              d="M12 0H184"
              stroke={accent}
              strokeWidth="1.45"
              strokeLinecap="round"
              opacity=".7"
            />
            <path
              d="M16 1H180"
              stroke="#FFFFFF"
              strokeWidth=".7"
              opacity=".8"
            />
          </g>
        </g>
      </g>
    </g>
  );
}

/** Decorative illustration only. Its motion has no connection to import,
 * progress, accounting results, source values or matching decisions. */
export function DocumentScene() {
  const { t, dir } = useI18n();
  const prefix = `tarasuf-scene-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const element = useRef<HTMLElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updatePreference();
    updateVisibility();
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    const target = element.current;
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            ([entry]) => setInView(entry.isIntersecting),
            { threshold: 0.12 },
          );
    if (observer && target) observer.observe(target);
    else setInView(true);
    return () => {
      observer?.disconnect();
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const running = inView && pageVisible && !paused && !reducedMotion;
  return (
    <figure
      className="document-scene"
      ref={element}
      data-running={running ? 'true' : 'false'}
    >
      <div className="document-scene__stage" aria-hidden="true">
        <svg
          className="document-scene__art"
          viewBox="0 0 560 490"
          fill="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id={`${prefix}-paper`}
              x1="0"
              y1="0"
              x2="196"
              y2="277.2"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#FFFFFF" />
              <stop offset=".72" stopColor="#FFFFFF" />
              <stop offset="1" stopColor="#F8FAFD" />
            </linearGradient>
            <radialGradient id={`${prefix}-ambient`}>
              <stop stopColor="#E8E9FF" stopOpacity=".7" />
              <stop offset="1" stopColor="#F5F8FF" stopOpacity="0" />
            </radialGradient>
            <linearGradient
              id={`${prefix}-rim`}
              x1="95"
              y1="331"
              x2="457"
              y2="405"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#233952" />
              <stop offset=".29" stopColor="#304563" />
              <stop offset=".69" stopColor="#354367" />
              <stop offset="1" stopColor="#182B44" />
            </linearGradient>
            <linearGradient
              id={`${prefix}-front`}
              x1="82"
              y1="350"
              x2="478"
              y2="419"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#102239" />
              <stop offset=".55" stopColor="#182C48" />
              <stop offset="1" stopColor="#0A1B2E" />
            </linearGradient>
            <linearGradient
              id={`${prefix}-light`}
              x1="114"
              y1="346"
              x2="448"
              y2="358"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#2D8CFF" />
              <stop offset=".55" stopColor="#5D74EA" />
              <stop offset="1" stopColor="#9B68ED" />
            </linearGradient>
            <radialGradient id={`${prefix}-well`} cx=".48" cy=".1" r=".85">
              <stop stopColor="#223258" />
              <stop offset=".7" stopColor="#0D1A2E" />
              <stop offset="1" stopColor="#081425" />
            </radialGradient>
            <filter
              id={`${prefix}-paper-shadow`}
              x="-25%"
              y="-12%"
              width="150%"
              height="130%"
            >
              <feDropShadow
                dx="0"
                dy="5"
                stdDeviation="5"
                floodColor="#1E3052"
                floodOpacity=".10"
              />
            </filter>
            <filter
              id={`${prefix}-floor-shadow`}
              x="-25%"
              y="-100%"
              width="150%"
              height="300%"
            >
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient
              id={`${prefix}-rays-blue`}
              x1="0"
              y1="302"
              x2="0"
              y2="387"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#2D8CFF" stopOpacity="0" />
              <stop offset="1" stopColor="#2D8CFF" stopOpacity=".10" />
            </linearGradient>
            <linearGradient
              id={`${prefix}-rays-purple`}
              x1="0"
              y1="302"
              x2="0"
              y2="387"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#7C3AED" stopOpacity="0" />
              <stop offset="1" stopColor="#7C3AED" stopOpacity=".09" />
            </linearGradient>
          </defs>
          <ellipse
            cx="280"
            cy="269"
            rx="252"
            ry="193"
            fill={`url(#${prefix}-ambient)`}
          />
          <ellipse
            cx="280"
            cy="458"
            rx="180"
            ry="10"
            fill="#536596"
            opacity=".12"
            filter={`url(#${prefix}-floor-shadow)`}
          />
          <g className="document-scene__portal-back" data-portal-top="335">
            <path
              d="M82 390C82 359.62 170.65 335 280 335S478 359.62 478 390V408C478 438.38 389.35 463 280 463S82 438.38 82 408Z"
              fill={`url(#${prefix}-front)`}
            />
            <ellipse
              cx="280"
              cy="390"
              rx="198"
              ry="55"
              fill={`url(#${prefix}-rim)`}
              stroke="#304765"
            />
            <ellipse
              cx="280"
              cy="383"
              rx="168"
              ry="36"
              fill={`url(#${prefix}-well)`}
            />
            <ellipse
              cx="280"
              cy="383"
              rx="168"
              ry="36"
              stroke={`url(#${prefix}-light)`}
              strokeWidth="2"
              opacity=".9"
            />
            <path
              d="M133 369C160 354 216 347 280 347S400 354 427 369"
              stroke="#8CA9F6"
              strokeOpacity=".27"
            />
          </g>
          <g className="document-scene__light-columns">
            <path
              d="M102 302H268L239 385H151Z"
              fill={`url(#${prefix}-rays-blue)`}
            />
            <path
              d="M292 302H458L409 385H321Z"
              fill={`url(#${prefix}-rays-purple)`}
            />
            <path
              d="M117 315 157 380M254 315 235 380"
              stroke="#2D8CFF"
              strokeOpacity=".055"
            />
            <path
              d="M306 315 325 380M443 315 403 380"
              stroke="#7C3AED"
              strokeOpacity=".055"
            />
          </g>
          <g className="document-scene__papers">
            <StatementSheet kind="ledger" prefix={prefix} />
            <StatementSheet kind="supplier" prefix={prefix} />
          </g>
          <g className="document-scene__portal-front">
            <path
              d="M82 390C82 420.38 170.65 445 280 445S478 420.38 478 390V408C478 438.38 389.35 463 280 463S82 438.38 82 408Z"
              fill={`url(#${prefix}-front)`}
            />
            <path
              d="M82 390C82 420.38 170.65 445 280 445S478 420.38 478 390L448 383C448 402.88 372.78 419 280 419S112 402.88 112 383Z"
              fill={`url(#${prefix}-rim)`}
            />
            <path
              d="M112 383C112 402.88 187.22 419 280 419S448 402.88 448 383"
              stroke={`url(#${prefix}-light)`}
              strokeWidth="2.2"
            />
            <path
              d="M89 402C111 427 189 443 280 443S449 427 471 402"
              stroke="#8D9FBF"
              strokeOpacity=".18"
            />
            <path
              d="M235 452H264"
              stroke="#2D8CFF"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".55"
            />
            <path
              d="M273 453H290"
              stroke="#9360E9"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".55"
            />
          </g>
        </svg>
      </div>
      <figcaption className="document-scene__caption" dir={dir}>
        <span>{t.scene.caption}</span>
        <span
          className="document-scene__caption-separator"
          aria-hidden="true"
        />
        <button
          type="button"
          className="document-scene__motion-toggle"
          disabled={reducedMotion}
          aria-pressed={paused || reducedMotion}
          aria-label={
            reducedMotion
              ? t.scene.motionReducedLabel
              : paused
                ? t.scene.playLabel
                : t.scene.pauseLabel
          }
          onClick={() => setPaused((value) => !value)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {paused || reducedMotion ? (
              <path d="m5 3 8 5-8 5Z" />
            ) : (
              <path d="M4.5 3v10M11.5 3v10" />
            )}
          </svg>
          {reducedMotion
            ? t.scene.motionReduced
            : paused
              ? t.scene.play
              : t.scene.pause}
        </button>
      </figcaption>
    </figure>
  );
}
