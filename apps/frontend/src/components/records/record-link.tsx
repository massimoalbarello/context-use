import { Link } from '@tanstack/react-router';
import { FileInput } from 'lucide-react';
import { cn } from '../../lib/class-names';
import type { ExternalRecordSummary } from '../../queries/records';
import { resourceCardVariants } from '../knowledge/resource-list';

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
        <strong className="min-w-0 truncate font-semibold text-sm leading-snug">
          {record.title}
        </strong>
        {record.excerpt && (
          <small className="truncate text-muted-foreground text-xs leading-relaxed">
            {record.excerpt}
          </small>
        )}
        <small className="truncate text-muted-foreground text-xs leading-relaxed">
          Synced by {record.externalService.name}
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
      className={cn(resourceCardVariants(), 'h-auto min-h-24 transition')}
      to="/records/$id"
      params={{ id: record.readableId }}
      activeOptions={{ exact: true }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <RecordCardContent record={record} />
    </Link>
  );
}
