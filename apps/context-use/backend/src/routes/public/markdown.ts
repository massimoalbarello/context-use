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
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Public pages' }] },
      entity.pages.length
        ? markdownLinks(
            entity.pages.map((page) => ({
              title: page.title,
              url: publicResourcePath({ ...page, kind: 'page' }),
            })),
          )
        : {
            type: 'paragraph',
            children: [{ type: 'text', value: 'No public pages mention this entity yet.' }],
          },
    ],
  });
}

export function publicIndexMarkdown({
  entries,
  nextUrl,
  origin,
  siteName = DEFAULT_PUBLIC_SITE_NAME,
}: {
  entries: PublicResourceSummary[];
  nextUrl: string | null;
  origin: string;
  siteName?: string;
}) {
  return toMarkdown({
    type: 'root',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: siteName }] },
      {
        type: 'blockquote',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                value: 'Pages and entities explicitly published on this Context Use instance.',
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value:
              'Use this index to find and read public content. No sign-in is needed. Request any linked page with Accept: text/markdown, or use its /markdown URL. Page content reflects the approved revision. Private drafts and records are not available here. Links to public images and downloads remain in the content.',
          },
        ],
      },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'When to use this site' }] },
      {
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value:
              'Use this site to answer questions about the published notes, identify people and organizations they mention, and follow their references. Start with the links below, read the relevant pages, and cite their public URLs. This public reading surface cannot search private knowledge or change content; those tasks require authorization from the owner through the app.',
          },
        ],
      },
      ...(['page', 'entity'] as const).flatMap((kind): RootContent[] => {
        const group = entries.filter((entry) => entry.kind === kind);
        return group.length
          ? [
              {
                type: 'heading',
                depth: 2,
                children: [{ type: 'text', value: kind === 'page' ? 'Pages' : 'Entities' }],
              },
              markdownLinks(
                group.map((entry) => ({
                  title: entry.title,
                  url: new URL(`${publicResourcePath(entry)}/markdown`, origin).href,
                })),
              ),
            ]
          : [];
      }),
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Navigation' }] },
      markdownLinks([
        ...(nextUrl ? [{ title: 'Next index page', url: new URL(nextUrl, origin).href }] : []),
        { title: 'Homepage', url: new URL('/', origin).href },
        { title: 'Browse public content', url: new URL('/public/directory', origin).href },
        { title: 'Sitemap', url: new URL('/sitemap.xml', origin).href },
      ]),
    ],
  });
}
