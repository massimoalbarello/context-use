import type { RootContent } from 'mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import { DEFAULT_PUBLIC_SITE_NAME } from '#backend/lib/runtime-config.ts';
import { ENTITY_TYPE_LABELS } from '#backend/models/entities/model.ts';
import type { PublicResourcesServiceContract } from '#backend/services/public-resources/service.ts';

type PublicEntity = NonNullable<
  Awaited<ReturnType<PublicResourcesServiceContract['entityContent']>>
>;
type PublicResourceSummary = Awaited<
  ReturnType<PublicResourcesServiceContract['index']>
>['entries'][number];

export function publicResourcePath(resource: Pick<PublicResourceSummary, 'kind' | 'publicId'>) {
  return `/public/${resource.kind === 'page' ? 'pages' : 'entities'}/${encodeURIComponent(resource.publicId)}`;
}

export function markdownLinks(links: { title: string; url: string }[]): RootContent {
  return {
    type: 'list',
    ordered: false,
    spread: false,
    children: links.map(({ title, url }) => ({
      type: 'listItem',
      spread: false,
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'link', url, children: [{ type: 'text', value: title.replace(/\s+/g, ' ') }] },
          ],
        },
      ],
    })),
  };
}

export function publicEntityMarkdown(entity: PublicEntity): string {
  return toMarkdown({
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: entity.name }] },
      ...(entity.entityType
        ? [
            {
              type: 'paragraph' as const,
              children: [{ type: 'text' as const, value: ENTITY_TYPE_LABELS[entity.entityType] }],
            },
          ]
        : []),
      { type: 'paragraph', children: [{ type: 'text', value: entity.description }] },
      ...(entity.imagePublicId
        ? [
            {
              type: 'paragraph' as const,
              children: [
                {
                  type: 'image' as const,
                  url: `/public/assets/${encodeURIComponent(entity.imagePublicId)}`,
                  alt: entity.name,
                },
              ],
            },
          ]
        : []),
      {
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: `Public pages mentioning ${entity.name}` }],
      },
      entity.pages.length
        ? markdownLinks(
            entity.pages.map((page) => ({
              title: page.title,
              url: publicResourcePath({ ...page, kind: 'page' }),
            })),
          )
        : {
            type: 'paragraph',
            children: [{ type: 'text', value: `No public pages mention ${entity.name} yet.` }],
          },
    ],
  });
}

export function publicSiteMarkdown({
  origin,
  siteName = DEFAULT_PUBLIC_SITE_NAME,
}: {
  origin: string;
  siteName?: string;
}) {
  return toMarkdown({
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: siteName }] },
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value:
              'Browse the public directory to find published pages and people. Follow its next-page links for more content. Read individual pages and entities with Accept: text/markdown or their /markdown URL. Pages show the approved revision; private drafts are not available. No sign-in is needed.',
          },
        ],
      },
      markdownLinks([
        { title: 'Homepage', url: new URL('/public', origin).href },
        { title: 'Public directory', url: new URL('/public/directory', origin).href },
        { title: 'Sitemap', url: new URL('/sitemap.xml', origin).href },
      ]),
    ],
  });
}
