import type { Messages } from './messages';

/** A message kept in state must not be frozen in one language: switching the
 * interface would leave it behind. State holds what to say, and the current
 * language decides how it reads when it is rendered. */
export type UiText =
  | { ui: (t: Messages) => string }
  // Text produced by the accounting engine, rendered through its catalogue.
  | { engine: string };
export const uiText = (ui: (t: Messages) => string): UiText => ({ ui });
export const engineText = (engine: string): UiText => ({ engine });
/** A failure the interface raises itself and explains in its own words. */
export class UiFailure extends Error {
  constructor(readonly text: UiText) {
    super('ui-failure');
  }
}
/** An error from the engine or the worker keeps its original message; anything
 * that is not an Error is reported with the interface's own fallback. */
export const errorText = (
  error: unknown,
  fallback: (t: Messages) => string,
): UiText =>
  error instanceof UiFailure
    ? error.text
    : error instanceof Error && error.message.trim()
      ? { engine: error.message }
      : { ui: fallback };
/** Throws a failure explained by the interface catalogue. */
export function fail(ui: (t: Messages) => string): never {
  throw new UiFailure({ ui });
}
export function renderText(
  text: UiText,
  t: Messages,
  engine: (text: string) => string,
): string {
  return 'ui' in text ? text.ui(t) : engine(text.engine);
}
