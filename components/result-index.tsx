import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { resultIndexCopy, type ResultPart } from '@/lib/i18n/result-index';
import { useI18n } from '@/lib/i18n/context';
import './result-index.css';

export type { ResultPart };

/** What a part of a result carries so the index can take the reader to it:
 * its id, the focus from script and not from the keyboard, and its kind. */
export type ResultAnchor = {
  id: string;
  tabIndex: -1;
  'data-result-part': ResultPart;
};

/** The parts of one result, in the order the page draws them, each with its
 * own id. A workspace spreads `anchor(part)` on the element that begins the
 * part and gives the same list to the index (UX-4). */
export function useResultParts(
  parts: readonly ResultPart[],
  /** A part that begins at an element with an id of its own keeps it. */
  own: Partial<Record<ResultPart, string>> = {},
) {
  const base = useId();
  const id = (part: ResultPart) => own[part] ?? `${base}-result-${part}`;
  return {
    parts,
    id,
    anchor: (part: ResultPart): ResultAnchor => ({
      id: id(part),
      tabIndex: -1,
      'data-result-part': part,
    }),
  };
}

export type ResultParts = ReturnType<typeof useResultParts>;

/** The space a link leaves between the index and the part it opens. */
const GAP = 12;

/**
 * The index of a result (UX-4): under the alignment strip, a list of the
 * result's parts that stays under the top bar while the reader scrolls
 * through the result. A link takes the reader to its part and gives that
 * part the focus, so the keyboard continues from there; the move is
 * instant when the reader asked for reduced motion. The part being read is
 * marked as the current location. On a narrow screen the list folds behind
 * one button that names the part being read, so the index takes one line.
 * It lists only what the result draws: a workspace names its parts.
 */
export function ResultIndex({ map }: { map: ResultParts }) {
  const { lang } = useI18n();
  const c = resultIndexCopy[lang];
  const nav = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useId();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ResultPart | undefined>(map.parts[0]);
  // The parts and their ids as plain text, so the effect below follows
  // them without holding the map itself.
  const key = map.parts.join(' ');
  const ids = map.parts.map((part) => map.id(part)).join('\n');

  // The part being read: the last whose start has come within a line of the
  // index, where a link leaves it.
  useEffect(() => {
    const parts = key.split(' ') as ResultPart[];
    const idList = ids.split('\n');
    let frame = 0;
    const read = () => {
      frame = 0;
      const index = nav.current;
      if (!index) return;
      const box = index.getBoundingClientRect();
      // Until the index holds under the top bar, the reader is at the head
      // of the result.
      const stuck =
        box.top <= (parseFloat(getComputedStyle(index).top) || 0) + 1;
      const line = box.bottom + GAP + 12;
      let now = parts[0];
      if (stuck)
        parts.forEach((part, i) => {
          const target = document.getElementById(idList[i]);
          if (target && target.getBoundingClientRect().top <= line) now = part;
        });
      setCurrent(now);
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    addEventListener('scroll', later, { passive: true });
    addEventListener('resize', later);
    return () => {
      removeEventListener('scroll', later);
      removeEventListener('resize', later);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, ids]);

  const go = (event: MouseEvent<HTMLAnchorElement>, part: ResultPart) => {
    event.preventDefault();
    setOpen(false);
    // After the list has folded, so the index is measured as it will stand.
    requestAnimationFrame(() => {
      const target = document.getElementById(map.id(part));
      const index = nav.current;
      if (!target || !index) return;
      const stuck = parseFloat(getComputedStyle(index).top) || 0;
      const top =
        target.getBoundingClientRect().top +
        scrollY -
        stuck -
        index.offsetHeight -
        GAP;
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollTo({ top: Math.max(0, top), behavior: still ? 'auto' : 'smooth' });
      target.focus({ preventScroll: true });
      setCurrent(part);
    });
  };

  const close = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <nav
      ref={nav}
      className="result-index"
      aria-label={c.name}
      data-result-index=""
      data-open={open ? '' : undefined}
    >
      <button
        ref={toggle}
        type="button"
        className="result-index__toggle"
        aria-expanded={open}
        aria-controls={list}
        onClick={() => setOpen(!open)}
        onKeyDown={close}
      >
        <span>{c.open}</span>
        <span className="result-index__current">
          {current && c.parts[current]}
          <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
        </span>
      </button>
      <ol id={list} className="result-index__list">
        {map.parts.map((part) => (
          <li key={part}>
            <a
              href={`#${map.id(part)}`}
              data-result-link={part}
              aria-current={current === part ? 'location' : undefined}
              onClick={(event) => go(event, part)}
              onKeyDown={close}
            >
              {c.parts[part]}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
