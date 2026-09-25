import { ENTITY_TYPE_LABELS, type EntityType } from '#backend/models/entities/model.ts';
import { publicDocument } from './document.tsx';

export function publicEntityHtml({
  name,
  description,
  entityType,
  imagePublicId,
  pages,
}: {
  name: string;
  description: string;
  entityType: EntityType | null;
  imagePublicId: string | null;
  pages: { publicId: string; title: string }[];
}): string {
  return publicDocument({
    title: name,
    children: (
      <article>
        <header className="entity-identity">
          {imagePublicId ? (
            <img
              className="entity-portrait"
              src={`/public/assets/${encodeURIComponent(imagePublicId)}`}
              alt={name}
              width="160"
              height="160"
            />
          ) : null}
          <div>
            {entityType ? <p className="entity-type">{ENTITY_TYPE_LABELS[entityType]}</p> : null}
            <h1>{name}</h1>
          </div>
        </header>
        <p className="entity-description">{description}</p>
        <section aria-labelledby="public-pages">
          <h2 id="public-pages">Public pages</h2>
          {pages.length ? (
            <ul>
              {pages.map((page) => (
                <li key={page.publicId}>
                  <a href={`/public/pages/${encodeURIComponent(page.publicId)}`}>{page.title}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p>No public pages mention this entity yet.</p>
          )}
        </section>
      </article>
    ),
  });
}
