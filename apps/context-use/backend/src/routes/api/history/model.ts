import { t } from 'elysia';

export const HistoryQuerySchema = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
});

export const HistoryPageSchema = t.Object({
  items: t.Array(
    t.Object({
      sequence: t.Integer(),
      resourceType: t.Union([
        t.Literal('entity'),
        t.Literal('page'),
        t.Literal('asset'),
        t.Literal('record'),
      ]),
      readableId: t.String(),
      name: t.String(),
      action: t.Union([
        t.Literal('created'),
        t.Literal('updated'),
        t.Literal('archived'),
        t.Literal('deleted'),
      ]),
      message: t.String(),
      clientName: t.Nullable(t.String()),
      details: t.Array(t.String()),
      pageRevisionNumber: t.Nullable(t.Integer()),
      createdAt: t.Date(),
      available: t.Boolean(),
    }),
  ),
  nextCursor: t.Nullable(t.String()),
});
