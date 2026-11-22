import { useState } from 'react';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { TemporalCoverageLabel } from '../components/pages/temporal-coverage-label';
import type { Page, PagesClient } from './client';
import { PageMarkdown } from './page-markdown';

export function PageDetail({
  client,
  address,
  onOpen,
  onEdit,
  page,
}: {
  client: PagesClient;
  address: string;
  onOpen: (address: string) => void;
  onEdit: () => void;
  page: Page;
}) {
  const [linkError, setLinkError] = useState<string | null>(null);
  return (
    <section className="grid gap-5">
      <ResourceDetailHeading
        context={
          page.temporalCoverage && <TemporalCoverageLabel expression={page.temporalCoverage} />
        }
        actions={<ResourceDetailActions mode="view" resource="page" onEdit={onEdit} />}
      >
        Revision {page.revisionNumber} · {page.publication.isPublic ? 'Public' : 'Private'}
      </ResourceDetailHeading>
      {linkError && <p role="alert">{linkError}</p>}
      <PageMarkdown
        fragment={address.split('#')[1]}
        markdown={page.markdown}
        client={client}
        mentions={page.mentions}
        onOpen={onOpen}
        onExternal={(url) => {
          void client.app
            .openLink({ url })
            .catch(() => setLinkError('Could not open this link. Try again.'));
        }}
      />
    </section>
  );
}
