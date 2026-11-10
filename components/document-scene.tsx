import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import '../app/document-scene.css';
import { useI18n } from '@/lib/i18n/context';
import type { ReconciliationDomain } from '@/lib/i18n/reconciliation-directory';
import {
  acceptFormats,
  typeStageRoles,
  type StageRole,
} from '@/lib/i18n/type-stage';

// A4 proportions are preserved in the drawing and at every responsive size.
const PAPER_WIDTH = 196;
const PAPER_HEIGHT = 277.2; // 196 × 297 / 210
const KINDS = ['ledger', 'supplier'] as const;
type Kind = (typeof KINDS)[number];

// The type stage (UX-7): a paper turns about its upright axis until its edge
// faces the reader, takes the name of its new role, and turns back.
const TURN_OUT = 280;
const TURN_IN = 360;
const TURN_STAGGER = 90;
const edgeOn = (degrees: number) => `perspective(900px) rotateY(${degrees}deg)`;

/** The role a paper wears: the first role on `supplier`, the second on
 * `ledger` (the historical keys keep their colour and phase). */
const roleIndex = (kind: Kind) => (kind === 'supplier' ? 0 : 1);
const roleOf = (lang: 'ar' | 'en', domain: ReconciliationDomain, kind: Kind) =>
  typeStageRoles[lang][domain][roleIndex(kind)];

/** A long role name takes a smaller size so it fits two lines of the paper. */
function titleSize(name: string) {
  return name.length <= 14
    ? 'l'
    : name.length <= 24
      ? 'm'
      : name.length <= 34
        ? 's'
        : 'xs';
}

/** Paper, ink and its own scan share local coordinates. The scan's entire
 * travel stays inside the page; a separate clip also prevents any light spill.
 * The role's name and formats are live text over the drawing, sized in the
 * paper's own units so they scale with it. */
function StatementSheet({
  kind,
  prefix,
  role,
  side,
  centred,
  turn,
}: {
  kind: Kind;
  prefix: string;
  role: StageRole | undefined;
  side: 'left' | 'right';
  centred: boolean;
  turn: (element: HTMLDivElement | null) => void;
}) {
  const { lang, dir } = useI18n();
  const first = kind === 'supplier';
  const clip = `${prefix}-${kind}-paper`;
  const beam = `${prefix}-${kind}-scan-beam`;
  const fill = `${prefix}-${kind}-fill`;
  const shadow = `${prefix}-${kind}-shadow`;
  const accent = first ? '#386FD4' : '#7951CB';
  return (
    <div
      className={`document-scene__slot document-scene__slot--${side}`}
      data-centred={centred ? 'true' : 'false'}
      data-absent={role ? 'false' : 'true'}
    >
      <div className={`document-scene__float document-scene__float--${kind}`}>
        <div
          className={`document-scene__sheet document-scene__sheet--${kind}`}
          data-paper-kind={kind}
          data-role-name={role?.name ?? ''}
        >
          <div className="document-scene__turn" ref={turn}>
            <svg
              className="document-scene__paper-art"
              viewBox={`0 0 ${PAPER_WIDTH} ${PAPER_HEIGHT}`}
              fill="none"
              focusable="false"
              aria-hidden="true"
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
                <linearGradient
                  id={fill}
                  x1="0"
                  y1="0"
                  x2={PAPER_WIDTH}
                  y2={PAPER_HEIGHT}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop stopColor="#FFFFFF" />
                  <stop offset=".72" stopColor="#FFFFFF" />
                  <stop offset="1" stopColor="#F8FAFD" />
                </linearGradient>
                <filter
                  id={shadow}
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
                fill={`url(#${fill})`}
                stroke="#D4DEEC"
                filter={`url(#${shadow})`}
              />
              <g
                className="document-scene__paper-content"
                clipPath={`url(#${clip})`}
              >
                <path
                  d="M1 10A9 9 0 0 1 10 1H186A9 9 0 0 1 195 10"
                  fill="none"
                  stroke="#FFFFFF"
                />
                <g
                  className="document-scene__paper-mark"
                  transform="translate(153 18) scale(.26)"
                >
                  <path
                    d="M10 39C10 31 14 25 22 21L67 0C71-2 74 0 74 5V14C74 22 70 28 63 32L15 55C12 57 10 55 10 51Z"
                    fill={accent}
                  />
                  <path
                    d="M4 80C4 72 8 66 16 62L67 37C71 35 74 37 74 42V51C74 59 70 65 63 69L9 96C6 98 4 96 4 92Z"
                    fill="#A8B4CF"
                  />
                </g>
                <rect
                  className="document-scene__paper-table"
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
                  fill={first ? '#EFF5FD' : '#F4F0FC'}
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
            </svg>
            <span
              className={`document-scene__file-type document-scene__file-type--${kind}`}
              dir="ltr"
            >
              <svg viewBox="0 0 12 15" aria-hidden="true" focusable="false">
                <path d="M1 1h6l4 4v9H1zM7 1v5h4" />
              </svg>
              {acceptFormats(role?.accept)}
            </span>
            <span
              className="document-scene__paper-title"
              lang={lang}
              dir={dir}
              data-size={titleSize(role?.name ?? '')}
            >
              <span className="document-scene__paper-title-text">
                {role?.name}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Decorative illustration only. Its motion has no connection to import,
 * progress, accounting results, source values or matching decisions. The
 * papers wear the roles of the chosen type; the caption names the type. */
export function DocumentScene({
  domain = 'supplier',
  titles = {},
}: {
  domain?: ReconciliationDomain;
  /** The name of each type as the type list writes it. */
  titles?: Partial<Record<ReconciliationDomain, string>>;
}) {
  const { t, lang, dir } = useI18n();
  const prefix = `tarasuf-scene-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const element = useRef<HTMLElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  // The type the papers show; it follows `domain` after a turn, or at once
  // when motion is reduced or paused.
  const [shown, setShown] = useState(domain);
  const turns = useRef<Partial<Record<Kind, HTMLDivElement | null>>>({});
  const turning = useRef(false);

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
  const roles = typeStageRoles[lang][shown];
  // The first role reads first: on the right in Arabic, on the left in English.
  const sideOf = (kind: Kind) =>
    (kind === 'supplier') === (dir === 'ltr') ? 'left' : 'right';

  // Choosing a type scrolls its workspace into view, so the stage is rarely
  // on screen at that moment. With motion allowed, the papers keep their
  // roles until the reader sees the stage again and turn then; with motion
  // reduced or paused they change at once.
  const motionAllowed = !paused && !reducedMotion;
  useEffect(() => {
    if (domain === shown) return;
    const visible = KINDS.filter(
      (kind) => !!roleOf(lang, shown, kind) && turns.current[kind],
    );
    if (!motionAllowed || !visible.length) {
      setShown(domain);
      return;
    }
    if (!running) return;
    let cancelled = false;
    const outs = visible.map((kind) =>
      turns.current[kind]!.animate(
        [{ transform: edgeOn(0) }, { transform: edgeOn(90) }],
        {
          // Both papers turn away together; the first role's comes back
          // first: 280 + 90 + 360 = 730 ms in all, under the 750 budgeted.
          duration: TURN_OUT,
          easing: 'cubic-bezier(0.55, 0, 1, 0.45)',
          fill: 'forwards',
        },
      ),
    );
    Promise.all(outs.map((animation) => animation.finished))
      .then(() => {
        if (cancelled) return;
        turning.current = true;
        setShown(domain);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (!turning.current) outs.forEach((animation) => animation.cancel());
    };
  }, [domain, shown, running, motionAllowed, lang]);

  useLayoutEffect(() => {
    const entering = turning.current;
    turning.current = false;
    KINDS.forEach((kind) => {
      const turn = turns.current[kind];
      if (!turn) return;
      turn.getAnimations().forEach((animation) => animation.cancel());
      if (entering && roleOf(lang, shown, kind))
        turn.animate([{ transform: edgeOn(-90) }, { transform: edgeOn(0) }], {
          duration: TURN_IN,
          delay: roleIndex(kind) * TURN_STAGGER,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'backwards',
        });
    });
  }, [shown, lang]);

  return (
    <figure
      className="document-scene"
      ref={element}
      data-running={running ? 'true' : 'false'}
      data-stage-domain={shown}
      data-stage-target={domain}
    >
      <div className="document-scene__stage" aria-hidden="true">
        <svg
          className="document-scene__art document-scene__art--back"
          viewBox="0 0 560 490"
          fill="none"
          focusable="false"
        >
          <defs>
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
        </svg>
        <div className="document-scene__papers">
          {KINDS.map((kind) => (
            <StatementSheet
              key={kind}
              kind={kind}
              prefix={prefix}
              role={roleOf(lang, shown, kind)}
              side={sideOf(kind)}
              centred={roles.length === 1}
              turn={(turn) => {
                turns.current[kind] = turn;
              }}
            />
          ))}
        </div>
        <svg
          className="document-scene__art document-scene__art--front"
          viewBox="0 0 560 490"
          fill="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id={`${prefix}-face-front`}
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
              id={`${prefix}-face-rim`}
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
              id={`${prefix}-face-light`}
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
          </defs>
          <g className="document-scene__portal-front">
            <path
              d="M82 390C82 420.38 170.65 445 280 445S478 420.38 478 390V408C478 438.38 389.35 463 280 463S82 438.38 82 408Z"
              fill={`url(#${prefix}-face-front)`}
            />
            <path
              d="M82 390C82 420.38 170.65 445 280 445S478 420.38 478 390L448 383C448 402.88 372.78 419 280 419S112 402.88 112 383Z"
              fill={`url(#${prefix}-face-rim)`}
            />
            <path
              d="M112 383C112 402.88 187.22 419 280 419S448 402.88 448 383"
              stroke={`url(#${prefix}-face-light)`}
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
        <span className="document-scene__caption-line">
          <span className="document-scene__caption-text">
            {t.scene.illustration}
          </span>
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
        </span>
        <StageSources domain={domain} titles={titles} />
      </figcaption>
    </figure>
  );
}

/**
 * Under the stage, the chosen type by name and its sources as readable text,
 * in the order of the papers and of the upload cards. Every type's list is laid
 * out in the same cell and only the chosen one shows, so the room it takes
 * is the room of the longest and choosing a type never moves the type list
 * below the intro.
 */
function StageSources({
  domain,
  titles,
}: {
  domain: ReconciliationDomain;
  titles: Partial<Record<ReconciliationDomain, string>>;
}) {
  const { t, lang } = useI18n();
  const all = typeStageRoles[lang];
  return (
    <span className="document-scene__sources">
      {(Object.keys(all) as ReconciliationDomain[]).map((candidate) => {
        const current = candidate === domain;
        return (
          <span
            key={candidate}
            className="document-scene__source-list"
            data-stage-sources={candidate}
            data-current={current ? 'true' : 'false'}
            aria-hidden={current ? undefined : 'true'}
          >
            <span className="document-scene__type">{titles[candidate]}</span>
            <span className="sr-only">{t.scene.sources}</span>
            {all[candidate].map((role, index) => (
              <span
                key={index}
                className={`document-scene__source document-scene__source--${index ? 'second' : 'first'}`}
              >
                <span className="document-scene__source-name">{role.name}</span>
                <span className="document-scene__source-formats" dir="ltr">
                  {acceptFormats(role.accept)}
                </span>
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
