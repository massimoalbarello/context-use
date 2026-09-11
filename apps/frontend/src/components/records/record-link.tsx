import { Link } from '@tanstack/react-router';
import { FileInput } from 'lucide-react';
import type { ExternalRecordSummary } from '../../queries/records';
import { resourceCardVariants } from '../knowledge/resource-list';
import { RecordTimestamp } from './record-timestamp';

export function RecordCardContent({ record }: { record: ExternalRecordSummary }) {
  return (
    <>
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <FileInput className="size-5 fill-none stroke-[1.4] stroke-current" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <strong
          title={record.title}
          className="line-clamp-3 min-w-0 font-semibold text-sm leading-snug"
        >
          {record.title}
        </strong>
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          {record.provider} · {record.kind}
        </small>
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          Created <RecordTimestamp value={record.sourceCreatedAt} compact />
        </small>
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          Updated <RecordTimestamp value={record.sourceUpdatedAt} compact />
        </small>
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          Synced by {record.sync.name}
        </small>
      </span>
    </>
  );
}

export function RecordLink({
  record,
  active = false,
}: {
  record: ExternalRecordSummary;
  active?: boolean;
}) {
  return (
    <Link
      className={`${resourceCardVariants()} h-auto min-h-24`}
      to="/records/$id"
      params={{ id: record.readableId }}
      search={(previous) => previous}
      activeOptions={{ exact: true }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <RecordCardContent record={record} />
    </Link>
  );
}
