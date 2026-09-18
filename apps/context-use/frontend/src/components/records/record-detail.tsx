import { useRecord } from '../../lib/hooks/use-records';
import type { ContextRecord } from '../../queries/records';
import { DetailHeader, DetailShell } from '../knowledge/detail-shell';
import { ResourceDetailHeading } from '../knowledge/resource-detail-heading';
import { ResourceList } from '../knowledge/resource-list';
import { WorkspaceResourceError } from '../knowledge/workspace-resource-error';
import { KnowledgePageLink } from '../pages/knowledge-page-link';
import { ContextRecordMarkdown } from '../records/record-markdown';
import { RecordTimestamp } from '../records/record-timestamp';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

type RecordView = 'preview' | 'metadata' | 'links';

function isRecordView(value: unknown): value is RecordView {
  return value === 'preview' || value === 'metadata' || value === 'links';
}

export function RecordDetail({
  id,
  view = 'preview',
  onViewChange,
}: {
  id: string;
  view?: RecordView;
  onViewChange: (options: { view: RecordView; hash?: string }) => void;
}) {
  const { data: record, error, refetch } = useRecord(id);
  if (error) {
    return (
      <WorkspaceResourceError
        resource="record"
        error={error}
        retry={() => {
          void refetch();
        }}
      />
    );
  }
  if (!record) {
    return (
      <p className="p-8 text-muted-foreground text-sm" role="status">
        Loading record…
      </p>
    );
  }

  return (
    <DetailShell className="gap-0">
      <DetailHeader>
        <ResourceDetailHeading
          actions={null}
          context={<Badge variant="secondary">{record.source.provider}</Badge>}
        >
          Record
        </ResourceDetailHeading>
      </DetailHeader>
      <Tabs
        className="mt-5 min-w-0"
        value={view}
        onValueChange={(value) => {
          if (isRecordView(value)) {
            onViewChange({ view: value });
          }
        }}
      >
        <TabsList className="gap-5" variant="line" aria-label="Record views">
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="links">Links</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="pt-7">
          <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{record.title}</h1>
          <ContextRecordMarkdown markdown={record.body} label={record.title} />
        </TabsContent>
        <TabsContent value="metadata" className="py-7">
          <RecordMetadata record={record} />
        </TabsContent>
        <TabsContent value="links" className="py-7">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="font-semibold text-lg">Referenced by</h2>
            <Badge variant="secondary">{record.backlinks.length}</Badge>
          </div>
          {record.backlinks.length > 0 ? (
            <ResourceList>
              {record.backlinks.map((page) => (
                <li key={page.readableId}>
                  <KnowledgePageLink page={page} presentation="card" />
                </li>
              ))}
            </ResourceList>
          ) : (
            <p className="text-muted-foreground text-sm">No pages reference this record yet.</p>
          )}
        </TabsContent>
      </Tabs>
    </DetailShell>
  );
}

export function RecordMetadata({ record }: { record: ContextRecord }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">Title</dt>
        <dd>{record.title}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{record.source.provider}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Data kind</dt>
        <dd>{record.source.kind}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">Occurred at</dt>
        <dd>
          <RecordTimestamp value={record.occurredAt} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Source created</dt>
        <dd>
          <RecordTimestamp value={record.sourceCreatedAt} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Source updated</dt>
        <dd>
          <RecordTimestamp value={record.sourceUpdatedAt} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">First received</dt>
        <dd>
          <RecordTimestamp value={record.createdAt} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Last received</dt>
        <dd>
          <RecordTimestamp value={record.updatedAt} />
        </dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">Source record ID</dt>
        <dd className="break-all font-mono text-xs">{record.source.id}</dd>
      </div>
    </dl>
  );
}
