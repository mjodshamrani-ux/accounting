import type { ar } from './locales/ar';

/** The Arabic catalogue is the source of truth. English must provide exactly the
 * same keys with the same parameters: a missing, extra or mistyped key is a
 * compile error, not a runtime surprise. */
export type Messages = typeof ar;
