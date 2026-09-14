import { useSyncExternalStore } from 'react';

const NARROW_WORKSPACE_QUERY = '(max-width: 767px)';
function subscribe(onChange: () => void) {
  const query = window.matchMedia(NARROW_WORKSPACE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
export function isNarrowWorkspace() {
  return window.matchMedia(NARROW_WORKSPACE_QUERY).matches;
}
export function useNarrowWorkspace() {
  return useSyncExternalStore(subscribe, isNarrowWorkspace, () => false);
}
