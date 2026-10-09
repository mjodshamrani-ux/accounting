import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getServerSnapshot = () => false;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
