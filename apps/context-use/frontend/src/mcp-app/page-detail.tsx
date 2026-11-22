import { InlineEntity } from '@repo/ui/inline-entity';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { InlineAsset } from '../components/assets/asset-link';
import { DeferredAsset } from '../components/assets/deferred-asset';
import { EntityAvatar } from '../components/entities/entity-link';
import { ResourceDetailActions } from '../components/knowledge/resource-detail-actions';
import { ResourceDetailHeading } from '../components/knowledge/resource-detail-heading';
import { markdownTextContent } from '../components/markdown/markdown-heading';
import { PageProse } from '../components/pages/page-prose';
import { TemporalCoverageLabel } from '../components/pages/temporal-coverage-label';
import type { McpAppClient, Page } from './client';
import { PreviewImage, PreviewPortrait } from './resource-preview';

export function PageDetail({
  client,
  address,
  onOpen,
  onEdit,
  page,
}: {
  client: McpAppClient;
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

export function PageMarkdown({
  markdown,
  onOpen,
  client,
  mentions = [],
  onExternal,
  fragment,
}: {
  markdown: string;
  client?: McpAppClient;
  mentions?: Page['mentions'];
  onOpen?: (address: string) => void;
  onExternal?: (url: string) => void;
  fragment?: string;
}) {
  return (
    <PageProse
      className="min-w-0 overflow-x-auto break-words"
      articleRef={(node) => {
        if (node && fragment) {
          node.ownerDocument.getElementById(fragment)?.scrollIntoView();
        }
      }}
      markdown={markdown}
      renderLink={({ href, target, children }) => {
        if (!target || target.kind === 'record') {
          return (
            <ExternalLink href={href} onExternal={onExternal}>
              {children}
            </ExternalLink>
          );
        }
        const content =
          target.kind === 'entity' ? (
            <EntityMention
              client={client}
              mention={mentions.find((item) => item.readableId === target.readableId)}
            >
              {children}
            </EntityMention>
          ) : target.kind === 'asset' ? (
            <InlineAsset>{children}</InlineAsset>
          ) : (
            children
          );
        return onOpen ? (
          <button
            type="button"
            className={
              target.kind === 'entity'
                ? 'group/entity text-inherit'
                : 'font-medium text-foreground underline decoration-foreground/35 underline-offset-4'
            }
            onClick={() => onOpen(href)}
          >
            {content}
          </button>
        ) : (
          <span>{content}</span>
        );
      }}
      renderAsset={({ address, alt, className, linked }) => {
        if (!client) {
          return null;
        }
        const image = (
          <PreviewImage
            client={client}
            address={address}
            alt={alt || 'Attached asset'}
            className="bg-muted"
          />
        );
        return (
          <DeferredAsset className={className}>
            {onOpen && !linked ? (
              <button
                type="button"
                className="block w-full"
                onClick={() => onOpen(address)}
                aria-label={`Open ${alt || 'asset'}`}
              >
                {image}
              </button>
            ) : (
              image
            )}
          </DeferredAsset>
        );
      }}
    />
  );
}

function EntityMention({
  client,
  mention,
  children,
}: {
  client?: McpAppClient;
  mention?: Page['mentions'][number];
  children: ReactNode;
}) {
  const name = mention?.name ?? markdownTextContent(children);
  const avatar =
    client && mention?.imageAddress ? (
      <PreviewPortrait client={client} address={mention.imageAddress} name={name} size="sm" />
    ) : (
      <EntityAvatar entity={{ name }} size="sm" />
    );
  return (
    <InlineEntity name={name} avatar={avatar}>
      {children}
    </InlineEntity>
  );
}

function ExternalLink({
  href,
  children,
  onExternal,
}: {
  href?: string;
  children: ReactNode;
  onExternal?: (url: string) => void;
}) {
  if (!href || !onExternal || !/^(https?:|mailto:)/.test(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      className="font-medium underline underline-offset-4"
      onClick={(event) => {
        event.preventDefault();
        onExternal(href);
      }}
    >
      {children}
    </a>
  );
}
