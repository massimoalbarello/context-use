import { Button } from '@repo/ui/button';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { usePublicationApproval } from '../../lib/hooks/use-publication-approval';
import {
  type PagePublicationPreview,
  pageDiffQueryOptions,
  pagePublicationPreviewQueryOptions,
} from '../../queries/pages';
import { PublicationReviewDialog } from '../publications/publication-review-dialog';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { RevisionDiff } from './revision-diff';

export function PagePublicationReview({
  approval,
}: {
  approval: ReturnType<typeof usePublicationApproval>;
}) {
  const preparation = approval.ready?.preparation;
  const publishing = approval.request?.action === 'publish';
  const selected = preparation?.pageRevision?.revisionNumber;
  const published = preparation?.pageRevision?.publishedRevisionNumber;
  const preview = useQuery({
    ...pagePublicationPreviewQueryOptions({
      readableId: preparation?.resource.readableId ?? '',
      revisionNumber: selected ?? 0,
      approvalId: approval.ready?.approvalId,
    }),
    enabled: publishing && selected != null,
  });
  const revision = preview.data;
  const reviewed = preview.isSuccess && !!revision && revision.revisionNumber === selected;
  return (
    <PublicationReviewDialog
      approval={approval}
      className="max-w-3xl"
      confirmDisabled={publishing && !reviewed}
    >
      {publishing ? (
        <>
          <p className="text-sm">
            Anyone with the link can read this page. Future edits stay private until you publish
            them.
          </p>
          <p className="text-sm">
            References to private pages appear as plain text. Referenced pages stay private until
            you publish them.
          </p>
          {preview.error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-destructive text-sm" role="alert">
                {preview.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
                Retry preview
              </Button>
            </div>
          ) : reviewed ? (
            <PagePublicationContent
              key={approval.ready?.approvalId}
              readableId={preparation!.resource.readableId}
              revision={revision}
              publishedRevisionNumber={published ?? null}
            />
          ) : (
            <p className="text-muted-foreground text-sm" role="status">
              Loading preview…
            </p>
          )}
        </>
      ) : (
        <div className="grid gap-3">
          {preparation?.pageRevision?.publicHomepage && (
            <p className="font-medium text-sm" role="alert">
              This is your public homepage. Unpublishing it will make your public site show “Nothing
              published yet”.
            </p>
          )}
          <p className="text-sm">
            {published == null ? 'This page' : `Public revision ${published}`} will stop being
            available at this page’s public URL and in public entity page indices. Linked resources
            keep their own publication state.
          </p>
        </div>
      )}
    </PublicationReviewDialog>
  );
}

function PagePublicationContent({
  readableId,
  revision,
  publishedRevisionNumber,
}: {
  readableId: string;
  revision: PagePublicationPreview;
  publishedRevisionNumber: number | null;
}) {
  const [view, setView] = useState<'preview' | 'changes'>('preview');
  const preview = (
    <Card role="region" aria-label="Page preview" className="min-w-0 gap-0 py-0">
      <div className="border-border border-b bg-muted px-4 py-3 sm:px-6">
        <p className="font-medium text-muted-foreground text-xs">Page preview</p>
      </div>
      <CardContent className="overflow-hidden p-0">
        <iframe
          title="Public page preview"
          className="h-[50vh] w-full border-0"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={({ currentTarget }) => {
            for (const link of currentTarget.contentDocument?.links ?? []) {
              const href = link.getAttribute('href');
              if (href?.startsWith('#')) {
                link.href = `about:srcdoc${href}`;
              } else {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
              }
            }
          }}
          srcDoc={revision.html}
        />
      </CardContent>
    </Card>
  );
  if (publishedRevisionNumber === null) {
    return preview;
  }
  return (
    <Tabs
      value={view}
      onValueChange={(value) => setView(value === 'changes' ? 'changes' : 'preview')}
    >
      <TabsList aria-label="Publication review" variant="line">
        <TabsTrigger value="preview">Preview</TabsTrigger>
        <TabsTrigger value="changes">Changes</TabsTrigger>
      </TabsList>
      <TabsContent value="preview">{preview}</TabsContent>
      <TabsContent value="changes">
        {view === 'changes' && (
          <PagePublicationComparison
            readableId={readableId}
            from={publishedRevisionNumber}
            to={revision.revisionNumber}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

function PagePublicationComparison({
  readableId,
  from,
  to,
}: {
  readableId: string;
  from: number;
  to: number;
}) {
  const comparison = useQuery(pageDiffQueryOptions({ readableId, from, to }));
  if (comparison.error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-destructive text-sm" role="alert">
          {comparison.error.message}
        </p>
        <Button variant="outline" size="sm" onClick={() => void comparison.refetch()}>
          Retry changes
        </Button>
      </div>
    );
  }
  const diff = comparison.data;
  return comparison.isSuccess && diff?.from === from && diff.to === to ? (
    <div className="max-h-[50vh] min-w-0 overflow-y-auto pr-2">
      <RevisionDiff diff={diff} />
    </div>
  ) : (
    <p className="text-muted-foreground text-sm" role="status">
      Loading changes…
    </p>
  );
}
