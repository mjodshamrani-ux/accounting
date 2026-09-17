import { useId, type SVGProps } from 'react';
import {
  BRAND_COLORS,
  BRAND_DISPLAY_NAME,
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

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn('brand-wordmark', className)}
      role="img"
      aria-label={BRAND_NAME}
    >
      <span
        className="brand-wordmark-arabic"
        dir="rtl"
        lang="ar"
        aria-hidden="true"
      >
        {BRAND_DISPLAY_NAME}
      </span>
    </span>
  );
}

/** Native Arabic text: the font and browser own joining, marks and line wrapping. */
export function DisplayHeading({
  id,
  className,
}: {
  id: DisplayHeadingId;
  className?: string;
}) {
  const heading = DISPLAY_HEADINGS[id];
  return (
    <span
      className={cn('display-heading', className)}
      data-display-heading={id}
      dir="rtl"
      lang="ar"
    >
      {heading.text}
    </span>
  );
}
