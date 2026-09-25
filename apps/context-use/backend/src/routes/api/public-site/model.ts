import { t } from 'elysia';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';

export const PublicSiteSettingsSchema = t.Object({
  homepage: t.Nullable(
    t.Object({ readableId: ReadableIdSchema, publicId: t.String(), title: t.String() }),
  ),
});

export const SetHomepageBodySchema = t.Object(
  { readableId: t.Nullable(ReadableIdSchema) },
  { additionalProperties: false },
);
