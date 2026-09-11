export function RecordTimestamp({
  value,
  compact = false,
}: {
  value: string | Date | null;
  compact?: boolean;
}) {
  if (value === null) {
    return <span>Not provided</span>;
  }
  const date = new Date(value);
  const full = date.toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' });
  return (
    <time dateTime={date.toISOString()} title={full}>
      {compact
        ? date.toLocaleDateString(undefined, {
            timeZone: 'UTC',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : full}
    </time>
  );
}
