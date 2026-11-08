// Small, size-limited pages can afford ten recovery snapshots even when edits are infrequent.
// The 24-hour window is additional: rapid edits must not exhaust a day's recovery history.
export const MIN_RETAINED_PAGE_REVISIONS = 10;
export const PAGE_REVISION_RETENTION_MS = 86_400_000;
