import { useEffect, useRef, useState } from 'react';

// Takes the reader to a result they asked for (UX-2): the heading scrolls into
// view below the top bar and takes the focus, so a screen reader reads what it
// says.
function take(heading: HTMLHeadingElement | null) {
  heading?.scrollIntoView({ block: 'start' });
  heading?.focus({ preventScroll: true });
}

/** After a run, an example or a restored session, the workspace calls
 * reveal(). A decision inside a result does not call it, and a late reply
 * never reaches it, since each workspace applies only the reply to its latest
 * request. */
export function useResultFocus() {
  const heading = useRef<HTMLHeadingElement>(null);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (request) take(heading.current);
  }, [request]);
  return { heading, reveal: () => setRequest((n) => n + 1) };
}

/** For a result drawn apart from the state that asks for it: takes the
 * reader to the heading while `pending` holds, then lets the owner clear it,
 * so drawing the result again later does not move the focus. */
export function usePendingResultFocus(pending: boolean, done: () => void) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!pending) return;
    take(heading.current);
    done();
  }, [pending, done]);
  return heading;
}
