import { useId } from 'react';

type FeatureArtKind = 'privacy' | 'evidence' | 'workflow' | 'assistant';

/** Original vector scenes: decorative geometry only; no financial values. */
export function FeatureArt({ kind }: { kind: FeatureArtKind }) {
  const id = `feature-${useId().replace(/:/g, '')}`;
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <svg
      className={`tarasuf-feature-art-svg tarasuf-feature-art-${kind}`}
      viewBox="0 0 480 300"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#ECF0FB" />
        </linearGradient>
        <linearGradient id={`${id}-surface`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset=".5" stopColor="#F7F9FF" />
          <stop offset="1" stopColor="#DBE2F5" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#C9D8F4" />
          <stop offset=".55" stopColor="#A8B7DF" />
          <stop offset="1" stopColor="#BFADE6" />
        </linearGradient>
        <linearGradient id={`${id}-brand`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#2D8CFF" />
          <stop offset=".52" stopColor="#5962EE" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#173861" />
          <stop offset="1" stopColor="#40348B" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#F3F8FF" stopOpacity=".93" />
          <stop offset="1" stopColor="#C8D5F8" stopOpacity=".62" />
        </linearGradient>
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#5F9DEA" />
          <stop offset="1" stopColor="#9270D7" />
        </linearGradient>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-40%"
          width="180%"
          height="190%"
        >
          <feDropShadow
            dx="0"
            dy="13"
            stdDeviation="12"
            floodColor="#2B3F77"
            floodOpacity=".12"
          />
        </filter>
        <filter
          id={`${id}-small-shadow`}
          x="-30%"
          y="-30%"
          width="170%"
          height="180%"
        >
          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="5"
            floodColor="#32446F"
            floodOpacity=".10"
          />
        </filter>
        <filter
          id={`${id}-ground`}
          x="-40%"
          y="-100%"
          width="180%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      {kind === 'privacy' && (
        <>
          <ellipse
            cx="254"
            cy="259"
            rx="145"
            ry="16"
            fill="#748AC4"
            opacity=".13"
            filter={paint('ground')}
          />
          <path
            d="M89 223 224 156Q238 149 251 153L391 203Q409 210 391 220L273 280Q260 286 247 281L91 234Q79 230 89 223Z"
            fill={paint('edge')}
            opacity=".65"
          />
          <path
            d="m89 218 135-67q14-7 27-3l140 50q18 7 0 17l-118 60q-13 6-26 1L91 229q-12-4-2-11Z"
            fill={paint('surface')}
            stroke="#CFD9ED"
          />
          <g className="tarasuf-art-back-layer" filter={paint('small-shadow')}>
            <g transform="translate(173 30) rotate(-12 56 86)">
              <rect
                width="105"
                height="157"
                rx="8"
                fill={paint('paper')}
                stroke="#CFD9EC"
              />
              <rect
                x="14"
                y="17"
                width="22"
                height="27"
                rx="4"
                fill="#E8F1FF"
              />
              <path
                d="M19 24h12m-12 6h12m-12 6h7"
                stroke="#82A9DE"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M15 61h68M15 73h68M15 85h42M15 108h68M15 120h68"
                stroke="#D8E2F1"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
            <g transform="translate(263 35) rotate(12 46 74)">
              <rect
                width="95"
                height="144"
                rx="8"
                fill={paint('paper')}
                stroke="#D6D8EC"
              />
              <rect
                x="14"
                y="16"
                width="24"
                height="27"
                rx="4"
                fill="#F0EAFE"
              />
              <path
                d="M19 23h14m-14 6h14m-14 6h9"
                stroke="#A18BD4"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M14 60h65M14 73h65M14 86h45M14 108h65"
                stroke="#E0DFF0"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          </g>
          <g filter={paint('shadow')}>
            <path
              d="m128 108 96-49 145 40-96 50Z"
              fill={paint('surface')}
              stroke="#C8D3EA"
            />
            <path
              d="m273 149 96-50v112l-96 47Z"
              fill={paint('edge')}
              stroke="#ADBBDA"
            />
            <path
              d="m128 108 145 41v109l-145-41Z"
              fill={paint('surface')}
              stroke="#C0CDE6"
            />
            <path
              d="m138 120 125 35v90l-125-35Z"
              fill="#F5F8FF"
              stroke="#D2DCF0"
            />
            <path
              d="m284 156 72-35v79l-72 35Z"
              fill="#DEE5F7"
              stroke="#B9C8E5"
            />
            <path
              d="m294 162 50-24m-50 38 50-24m-50 38 50-24"
              stroke="#B8C9E8"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path d="m143 124 113 32" stroke="white" strokeWidth="2" />
            <g transform="matrix(1 .28 0 1 168 130)">
              <path
                d="M34 0 68 13v34c0 22-18 36-34 43C18 83 0 69 0 47V13Z"
                fill={paint('brand')}
                stroke="#6C86DB"
                strokeWidth="1"
              />
              <path
                d="m5 16 29-11 29 11v29c0 18-14 31-29 38"
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity=".35"
              />
              <path
                d="M23 38v-9a11 11 0 0 1 22 0v9"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <rect x="18" y="36" width="32" height="27" rx="6" fill="white" />
              <circle cx="34" cy="47" r="3" fill="#6580E5" />
              <path
                d="M34 49v6"
                stroke="#6580E5"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
            <path
              d="m128 216 145 41 96-46"
              fill="none"
              stroke="#9EAFD4"
              strokeOpacity=".55"
            />
          </g>
          <g transform="translate(94 171)" filter={paint('small-shadow')}>
            <circle cx="0" cy="0" r="24" fill="white" stroke="#E0E7F5" />
            <circle r="17" fill="#EEF4FF" />
            <path
              d="m-7 0 5 5 9-10"
              fill="none"
              stroke="#658CDD"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <path
            d="M111 80h18m-9-9v18M383 155h12m-6-6v12"
            stroke="#BBC9E6"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === 'evidence' && (
        <>
          <ellipse
            cx="245"
            cy="260"
            rx="140"
            ry="14"
            fill="#8995BB"
            opacity=".14"
            filter={paint('ground')}
          />
          <g
            className="tarasuf-art-back-layer"
            transform="translate(101 73) rotate(-9 146 93)"
          >
            <rect
              x="0"
              y="23"
              width="280"
              height="170"
              rx="12"
              fill="#DCE4F4"
              stroke="#C7D3E9"
            />
            <rect
              x="0"
              y="15"
              width="280"
              height="170"
              rx="12"
              fill={paint('paper')}
              stroke="#CCD8EE"
            />
            <path
              d="M25 44h137M25 62h187M25 111h230M25 133h196M25 154h218"
              stroke="#DDE6F4"
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>
          <g
            className="tarasuf-art-front-layer"
            transform="translate(106 58) rotate(5 137 82)"
            filter={paint('shadow')}
          >
            <rect x="0" y="7" width="278" height="176" rx="12" fill="#CCD8EF" />
            <rect
              width="278"
              height="176"
              rx="12"
              fill={paint('paper')}
              stroke="#C6D4EB"
            />
            <rect x="19" y="19" width="32" height="32" rx="9" fill="#E9EDFC" />
            <path
              d="m28 35 5 5 10-11"
              stroke="#7A83CE"
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M64 29h80M64 41h120"
              stroke="#C6D4EA"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path d="M22 69h232" stroke="#E1E8F3" />
            <rect
              x="19"
              y="83"
              width="240"
              height="33"
              rx="6"
              fill="#EDF4FF"
              stroke="#D9E7FB"
            />
            <circle cx="38" cy="100" r="8" fill={paint('brand')} />
            <path
              d="m34 100 3 3 5-6"
              fill="none"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M58 100h78m32 0h29m19 0h20"
              stroke="#91ACD2"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M30 134h107m30 0h70M30 153h75m62 0h70"
              stroke="#D6E1F1"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
          <g transform="translate(305 207)" filter={paint('small-shadow')}>
            <rect
              x="-41"
              y="-20"
              width="102"
              height="40"
              rx="20"
              fill="white"
              stroke="#D9E2F2"
            />
            <path
              d="m-17-5 6-6a7 7 0 0 1 10 10l-5 5m-1 1-6 6a7 7 0 0 1-10-10l5-5m1 6 10-10"
              fill="none"
              stroke="#7A70C2"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M15-4h24M15 4h16"
              stroke="#ADB9D2"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
          <path
            d="M69 151h16m-8-8v16M408 89h12m-6-6v12"
            stroke="#C4CDE4"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === 'workflow' && (
        <>
          <ellipse
            cx="242"
            cy="258"
            rx="167"
            ry="13"
            fill="#8091BD"
            opacity=".12"
            filter={paint('ground')}
          />
          <path
            d="M71 208 159 158Q170 150 181 155l61 24q10 4 21-2l71-39 75 26"
            fill="none"
            stroke="#DDE4F2"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M71 203 159 153q11-8 22-3l61 24q10 4 21-2l71-39 75 26"
            fill="none"
            stroke={paint('line')}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="3 6"
          />
          <g
            className="tarasuf-art-back-layer"
            transform="translate(58 107)"
            filter={paint('small-shadow')}
          >
            <path d="m0 56 66-36 67 24v13L66 93 0 69Z" fill={paint('edge')} />
            <path
              d="m0 56 66-36 67 24-67 36Z"
              fill={paint('surface')}
              stroke="#CBD7ED"
            />
            <g transform="matrix(.8 .28 -.5 .35 55 -14)">
              <rect
                width="77"
                height="113"
                rx="7"
                fill={paint('paper')}
                stroke="#B4C8E4"
                strokeWidth="1.5"
              />
              <rect
                x="13"
                y="13"
                width="24"
                height="27"
                rx="4"
                fill="#DCEBFF"
              />
              <path
                d="M13 54h50M13 69h50M13 84h32"
                stroke="#BDCFE8"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </g>
            <g transform="matrix(.8 .28 -.5 .35 62 -29)">
              <rect
                width="77"
                height="113"
                rx="7"
                fill={paint('paper')}
                stroke="#CBD7ED"
                strokeWidth="1.5"
              />
              <rect
                x="13"
                y="13"
                width="24"
                height="27"
                rx="4"
                fill="#EBE5FD"
              />
              <path
                d="M13 54h50M13 69h50M13 84h32"
                stroke="#C7CBE8"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </g>
          </g>
          <g transform="translate(192 101)" filter={paint('shadow')}>
            <path d="m0 68 68-37 67 24v19L68 111 0 87Z" fill={paint('edge')} />
            <path
              d="m0 68 68-37 67 24-67 37Z"
              fill={paint('surface')}
              stroke="#CBD7ED"
            />
            <g transform="matrix(.85 .29 -.7 .39 67 0)">
              <rect
                x="0"
                y="0"
                width="72"
                height="85"
                rx="15"
                fill={paint('brand')}
                stroke="#7A8FDF"
                strokeWidth="2"
              />
              <path
                d="M21 27h32l-8-8m8 8-8 8M51 55H19l8 8m-8-8 8-8"
                fill="none"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
          <g
            className="tarasuf-art-front-layer"
            transform="translate(317 65)"
            filter={paint('small-shadow')}
          >
            <path d="m0 66 66-36 67 24v18L66 108 0 84Z" fill={paint('edge')} />
            <path
              d="m0 66 66-36 67 24-67 36Z"
              fill={paint('surface')}
              stroke="#CBD7ED"
            />
            <g transform="matrix(.8 .28 -.5 .35 58 -10)">
              <rect
                width="77"
                height="113"
                rx="7"
                fill={paint('paper')}
                stroke="#CBD7ED"
                strokeWidth="1.5"
              />
              <path
                d="M13 25h50M13 53h50M13 70h50M13 87h50M38 48v45"
                stroke="#CAD6EB"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="56" cy="19" r="15" fill={paint('brand')} />
              <path
                d="m49 19 5 5 9-10"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
          <circle cx="65" cy="204" r="4" fill="#89AEE3" />
          <circle cx="415" cy="162" r="4" fill="#A38BCF" />
        </>
      )}
      {kind === 'assistant' && (
        <>
          <ellipse
            cx="240"
            cy="263"
            rx="153"
            ry="14"
            fill="#7F8BB6"
            opacity=".13"
            filter={paint('ground')}
          />
          <path
            d="M128 190c-13 28 12 42 53 42h39m52 0h35c36 0 59-22 50-46"
            fill="none"
            stroke={paint('line')}
            strokeWidth="1.5"
            strokeDasharray="3 5"
          />
          <g
            className="tarasuf-art-back-layer"
            transform="translate(162 35) rotate(5 112 55)"
            filter={paint('small-shadow')}
          >
            <path
              d="M15 0h202a15 15 0 0 1 15 15v78a15 15 0 0 1-15 15H57l-22 18v-18H15A15 15 0 0 1 0 93V15A15 15 0 0 1 15 0Z"
              fill={paint('paper')}
              stroke="#CBD7EE"
            />
            <circle cx="199" cy="28" r="12" fill="#E9EDFC" />
            <path
              d="M198 23a4 4 0 0 1 4 7c-2 1-3 1-3 4m0 4v.2"
              fill="none"
              stroke="#8596BC"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M27 30h137M27 47h104M27 70h149"
              stroke="#CED9EE"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
          <g
            className="tarasuf-art-front-layer"
            transform="translate(77 117) rotate(-4 142 52)"
            filter={paint('shadow')}
          >
            <path
              d="M16 0h246a16 16 0 0 1 16 16v94a16 16 0 0 1-16 16H70l-22 16v-16H16a16 16 0 0 1-16-16V16A16 16 0 0 1 16 0Z"
              fill={paint('surface')}
              stroke="#C5D4EF"
            />
            <path
              d="M260 1H16A15 15 0 0 0 1 16v94"
              fill="none"
              stroke="white"
              strokeWidth="2"
            />
            <rect
              x="228"
              y="17"
              width="33"
              height="33"
              rx="10"
              fill={paint('brand')}
            />
            <path d="m237 32 6-4 8 3-6 4Zm0 7 6-4 8 3-6 4Z" fill="white" />
            <path
              d="M23 29h178M61 46h140M23 65h178"
              stroke="#B9CAE6"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <rect
              x="22"
              y="83"
              width="145"
              height="25"
              rx="6"
              fill="#EFF1FD"
              stroke="#E0E5F7"
            />
            <path
              d="m35 95 4 4 7-8"
              fill="none"
              stroke="#7989C5"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M57 95h88"
              stroke="#9DAFD2"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </g>
          <g transform="translate(339 199)" filter={paint('small-shadow')}>
            <circle r="26" fill="white" stroke="#DAE3F3" />
            <path
              d="M-8-3v-5a8 8 0 0 1 16 0v5"
              fill="none"
              stroke="#8296C4"
              strokeWidth="2.5"
            />
            <rect
              x="-12"
              y="-4"
              width="24"
              height="21"
              rx="5"
              fill={paint('brand')}
            />
            <circle cy="4" r="2" fill="white" />
            <path
              d="M0 5v4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
          <path
            d="M91 59h14m-7-7v14M405 171h12m-6-6v12"
            stroke="#C4CDE4"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
