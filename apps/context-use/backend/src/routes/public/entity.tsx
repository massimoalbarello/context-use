import { ENTITY_TYPE_LABELS, type EntityType } from '#backend/models/entities/model.ts';
import { PublicArticle } from './article.tsx';
import { publicDocument } from './document.tsx';

export function publicEntityHtml({
  name,
  publicId,
  canonicalUrl,
  siteName,
  description,
  entityType,
  imagePublicId,
  pages,
  modifiedAt,
}: {
  modifiedAt: string;
  name: string;
  publicId: string;
  canonicalUrl: string;
  siteName?: string;
  description: string;
  entityType: EntityType | null;
  imagePublicId: string | null;
  pages: { publicId: string; title: string }[];
}): string {
  return publicDocument({
    title: name,
    description,
    canonicalUrl,
    siteName,
    markdownUrl: `/public/entities/${encodeURIComponent(publicId)}/markdown`,
    modifiedAt,
    children: (
      <PublicArticle>
        <header className="flex flex-wrap items-center gap-6">
          {imagePublicId ? (
            <img
              className="m-0 size-40 object-cover"
              src={`/public/assets/${encodeURIComponent(imagePublicId)}`}
              alt={name}
              width="160"
              height="160"
            />
          ) : null}
          <div className="min-w-[min(15rem,100%)] flex-1">
            {entityType ? (
              <p className="mt-0 mb-2 text-[0.875rem]">{ENTITY_TYPE_LABELS[entityType]}</p>
            ) : null}
            <h1 className="m-0">{name}</h1>
          </div>
        </header>
        <p className="whitespace-pre-wrap">{description}</p>
        <section aria-labelledby="public-pages">
          <h2 id="public-pages">Public pages mentioning {name}</h2>
          {pages.length ? (
            <ul>
              {pages.map((page) => (
                <li key={page.publicId}>
                  <a href={`/public/pages/${encodeURIComponent(page.publicId)}`}>{page.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No public pages mention {name} yet.</p>
          )}
        </section>
      </PublicArticle>
    ),
  });
}
