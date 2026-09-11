import { Link } from '@tanstack/react-router';
import { FileInput } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExternalRecordSummary } from '../../queries/records';
import { resourceCardVariants } from '../knowledge/resource-list';

type RecordIdentity = Pick<ExternalRecordSummary, 'readableId' | 'title' | 'provider' | 'kind'>;

export function RecordCardContent({ record }: { record: RecordIdentity }) {
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
      </span>
    </>
  );
}

export function RecordLink({
  record,
  active = false,
  presentation,
  children,
}:
  | { record: RecordIdentity; active?: boolean; presentation?: 'card'; children?: never }
  | {
      record: Pick<RecordIdentity, 'readableId' | 'title'>;
      presentation: 'inline';
      children?: ReactNode;
      active?: never;
    }) {
  if (presentation === 'inline') {
    return (
      <Link
        className="font-medium text-foreground underline decoration-foreground/35 underline-offset-4 transition hover:decoration-foreground"
        to="/records/$id"
        params={{ id: record.readableId }}
        search={(previous) => ({ ...previous, view: 'preview' })}
      >
        {children ?? record.title}
      </Link>
    );
  }
  return (
    <Link
      className={`${resourceCardVariants()} h-auto min-h-24`}
      to="/records/$id"
      params={{ id: record.readableId }}
      search={(previous) => ({ ...previous, view: 'preview' })}
      activeOptions={{ exact: true, includeSearch: false }}
      data-route-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
    >
      <RecordCardContent record={record} />
    </Link>
  );
}
