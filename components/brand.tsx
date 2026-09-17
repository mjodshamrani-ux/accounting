import { useId, type SVGProps } from 'react';
import {
  BRAND_COLORS,
  BRAND_DISPLAY_NAME,
  BRAND_LATIN_NAME,
  BRAND_NAME,
  DISPLAY_HEADINGS,
  type DisplayHeadingId,
} from '@/lib/brand';
import { cn } from '@/lib/utils';

const ribbonPaths = [
  'M10 49C10 40 14 34 22 29L70 1C74-1 77 1 77 5V16C77 26 73 33 65 37L15 66C12 68 10 66 10 62Z',
  'M4 95C4 85 8 78 17 73L70 43C74 41 77 43 77 47V58C77 68 73 75 65 79L9 111C6 113 4 111 4 107Z',
];

export function BrandMark({
  className,
  decorative = true,
  monochrome = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  decorative?: boolean;
  monochrome?: boolean;
}) {
  const gradientId = `tarasuf-gradient-${useId().replace(/:/g, '')}`;
  return (
    <svg
      {...props}
      viewBox="0 0 82 116"
      className={cn('brand-mark', className)}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : BRAND_NAME}
      role={decorative ? undefined : 'img'}
      focusable="false"
    >
      {!decorative && <title>{BRAND_NAME}</title>}
      {!monochrome && (
        <defs>
          <linearGradient
            id={gradientId}
            x1="77"
            y1="5"
            x2="4"
            y2="104"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={BRAND_COLORS.blue} />
            <stop offset="1" stopColor={BRAND_COLORS.purple} />
          </linearGradient>
        </defs>
      )}
      {ribbonPaths.map((path) => (
        <path
          key={path}
          d={path}
          fill={monochrome ? 'currentColor' : `url(#${gradientId})`}
        />
      ))}
    </svg>
  );
}

const brandAsset = (path: string) => `${import.meta.env.BASE_URL}brand/${path}`;

export function BrandWordmark({
  className,
  showLatin = true,
}: {
  className?: string;
  showLatin?: boolean;
}) {
  return (
    <span
      className={cn('brand-wordmark', className)}
      role="img"
      aria-label={BRAND_NAME}
    >
      <img
        className="brand-wordmark-arabic"
        src={brandAsset('tarasuf-wordmark.svg')}
        width="2967.75"
        height="1149"
        alt=""
        title={BRAND_DISPLAY_NAME}
        aria-hidden="true"
        draggable={false}
      />
      {showLatin && (
        <span className="brand-wordmark-latin" dir="ltr" aria-hidden="true">
          {BRAND_LATIN_NAME}
        </span>
      )}
    </span>
  );
}

/** Static lettering artwork; the owning view supplies its semantic h1/h2. */
export function DisplayHeading({
  id,
  className,
}: {
  id: DisplayHeadingId;
  className?: string;
}) {
  const heading = DISPLAY_HEADINGS[id];
  return (
    <span className={cn('display-heading', className)}>
      <span className="sr-only">{heading.label}</span>
      <img
        src={brandAsset(`type/${id}.svg`)}
        width={heading.width}
        height={heading.height}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </span>
  );
}
