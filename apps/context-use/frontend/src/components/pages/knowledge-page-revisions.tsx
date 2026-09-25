import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@repo/ui/button';
import { ChevronDown } from 'lucide-react';
import type { KnowledgePage } from '../../queries/pages';
import { Badge } from '../ui/badge';
import { KnowledgePageRevisionComparison } from './knowledge-page-revision-comparison';
import { TemporalCoverageLabel } from './temporal-coverage-label';

export function KnowledgePageRevisions({
  page,
  publication,
}: {
  page: Pick<KnowledgePage, 'readableId' | 'revisionNumber' | 'revisions'>;
  publication: {
    publishedRevisionNumber: number | null;
    pending: boolean;
    onPublish: (revisionNumber: number) => void;
  } | null;
}) {
  return (
    <section className="py-7">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Revisions</h2>
        <Badge variant="secondary">{page.revisions.length}</Badge>
      </div>
      <ol className="grid max-w-4xl list-none gap-3 p-0">
        {page.revisions.map((revision) => (
          <Collapsible.Root
            render={<li />}
            className="min-w-0 rounded-xl bg-muted/50 px-4 py-3"
            defaultOpen={revision.revisionNumber === page.revisionNumber}
            key={`${page.readableId}:${revision.revisionNumber}`}
            aria-label={`Revision ${revision.revisionNumber}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-semibold text-sm">
                    Revision {revision.revisionNumber}
                  </strong>
                  {revision.revisionNumber === publication?.publishedRevisionNumber && (
                    <Badge>Public</Badge>
                  )}
                </div>
                <p className="mt-1 break-words text-sm">{revision.title}</p>
                {revision.temporalCoverage && (
                  <TemporalCoverageLabel
                    className="mt-1 text-xs"
                    expression={revision.temporalCoverage}
                  />
                )}
                <p className="mt-1 text-muted-foreground text-xs">
                  Created by {revision.author.name} ·{' '}
                  <time dateTime={revision.createdAt.toISOString()}>
                    {revision.createdAt.toLocaleString()}
                  </time>
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {publication && revision.revisionNumber !== publication.publishedRevisionNumber && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Publish revision ${revision.revisionNumber}`}
                    disabled={publication.pending}
                    onClick={() => publication.onPublish(revision.revisionNumber)}
                  >
                    Publish
                  </Button>
                )}
                <Collapsible.Trigger
                  render={<Button variant="ghost" size="sm" />}
                  className="group"
                  aria-label={`Changes in revision ${revision.revisionNumber}`}
                >
                  Changes
                  <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
                </Collapsible.Trigger>
              </div>
            </div>
            <Collapsible.Panel className="pt-4">
              <KnowledgePageRevisionComparison
                readableId={page.readableId}
                revisionNumber={revision.revisionNumber}
              />
            </Collapsible.Panel>
          </Collapsible.Root>
        ))}
      </ol>
    </section>
  );
}
