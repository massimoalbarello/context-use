export function RecordTimestamp({ value }: { value: string | Date | null }) {
  if (value === null) {
    return <span>Not provided</span>;
  }
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })}
    </time>
  );
}
