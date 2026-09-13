const NON_BROWSER_ORIGIN = 'http://localhost';

export function applicationOrigin(): string {
  return typeof window === 'undefined' ? NON_BROWSER_ORIGIN : window.location.origin;
}
