import { InlineEntity } from '@repo/ui/inline-entity';
import type { ReactNode } from 'react';
import { InlineAsset } from '../components/assets/asset-link';
import { DeferredAsset, markdownAssetMediaClass } from '../components/assets/deferred-asset';
import { EntityAvatar } from '../components/entities/entity-link';
import { markdownTextContent } from '../components/pages/markdown-heading';
import { PageProse } from '../components/pages/page-prose';
import type { Page, PagesClient } from './client';
import { PreviewImage, PreviewPortrait } from './resource-preview';

export function PageMarkdown({
  markdown,
  onOpen,
  client,
  mentions = [],
  onExternal,
  fragment,
}: {
  markdown: string;
  client?: PagesClient;
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
            className={markdownAssetMediaClass}
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
  client?: PagesClient;
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
