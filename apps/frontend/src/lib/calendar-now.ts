/** UI calendar time only; authentication and persisted timestamps use the real clock. */
export function calendarNow(): Date {
  const isolatedNow = import.meta.env.DEV && import.meta.env.VITE_ISOLATED_CALENDAR_NOW;
  return isolatedNow ? new Date(isolatedNow) : new Date();
}
