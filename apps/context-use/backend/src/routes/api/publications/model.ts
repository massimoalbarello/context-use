import { t } from 'elysia';
import type { PublicationPreparation } from '#backend/models/publications/model.ts';
import { ReadableIdSchema } from '#backend/routes/api/model.ts';

const ResourceTypeSchema = t.Union([t.Literal('page'), t.Literal('entity'), t.Literal('asset')]);
const ActionSchema = t.Union([t.Literal('publish'), t.Literal('unpublish')]);
const RevisionNumberSchema = t.Integer({ minimum: 1 });

export const PublicationParamsSchema = t.Object({
  resourceType: ResourceTypeSchema,
  readableId: ReadableIdSchema,
});

export const BeginPublicationBodySchema = t.Union([
  t.Object(
    {
      resourceType: t.Literal('page'),
      readableId: ReadableIdSchema,
      action: t.Literal('publish'),
      revisionNumber: RevisionNumberSchema,
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      resourceType: t.Literal('page'),
      readableId: ReadableIdSchema,
      action: t.Literal('unpublish'),
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      resourceType: t.Union([t.Literal('entity'), t.Literal('asset')]),
      readableId: ReadableIdSchema,
      action: ActionSchema,
    },
    { additionalProperties: false },
  ),
]);

export const ApprovalParamsSchema = t.Object({ approvalId: t.String({ format: 'uuid' }) });
const EncodedValueSchema = t.String({
  minLength: 1,
  maxLength: 16384,
  pattern: '^[A-Za-z0-9_-]+$',
});
export const CompletePublicationBodySchema = t.Object(
  {
    assertion: t.Object(
      {
        id: EncodedValueSchema,
        rawId: EncodedValueSchema,
        type: t.Literal('public-key'),
        authenticatorAttachment: t.Optional(
          t.Union([t.Literal('platform'), t.Literal('cross-platform')]),
        ),
        response: t.Object(
          {
            clientDataJSON: EncodedValueSchema,
            authenticatorData: EncodedValueSchema,
            signature: EncodedValueSchema,
            userHandle: t.Optional(t.String({ maxLength: 16384, pattern: '^[A-Za-z0-9_-]*$' })),
          },
          { additionalProperties: false },
        ),
        clientExtensionResults: t.Object(
          {
            appid: t.Optional(t.Boolean()),
            credProps: t.Optional(
              t.Object({ rk: t.Optional(t.Boolean()) }, { additionalProperties: false }),
            ),
            hmacCreateSecret: t.Optional(t.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const PublicationSchema = t.Object({
  publicId: t.Nullable(t.String()),
  publishedAt: t.Nullable(t.String()),
});
const ResourceSchema = t.Object({
  resourceType: ResourceTypeSchema,
  readableId: ReadableIdSchema,
  name: t.String(),
});
const BlockerSchema = t.Object({
  reason: t.Union([
    t.Literal('public_page_reference'),
    t.Literal('public_entity_image'),
    t.Literal('image_unavailable'),
    t.Literal('reference_not_public'),
    t.Literal('reference_unavailable'),
    t.Literal('record_reference'),
  ]),
  resource: t.Object({
    resourceType: t.Union([ResourceTypeSchema, t.Literal('record')]),
    readableId: ReadableIdSchema,
    name: t.String(),
  }),
});
const PreparationSchema = t.Object({
  resource: ResourceSchema,
  publication: PublicationSchema,
  includedImage: t.Nullable(t.Object({ resource: ResourceSchema, publication: PublicationSchema })),
  pageRevision: t.Nullable(
    t.Object({
      revisionNumber: t.Nullable(RevisionNumberSchema),
      publishedRevisionNumber: t.Nullable(RevisionNumberSchema),
    }),
  ),
  blockers: t.Array(BlockerSchema),
});
export const PublicationStatusSchema = t.Union([
  t.Object({
    resourceType: t.Literal('page'),
    ...PublicationSchema.properties,
    publishedRevisionNumber: t.Nullable(RevisionNumberSchema),
  }),
  t.Object({
    resourceType: t.Union([t.Literal('entity'), t.Literal('asset')]),
    ...PublicationSchema.properties,
  }),
]);
export const PublicationReadySchema = t.Object({
  state: t.Literal('ready'),
  approvalId: t.String(),
  expiresAt: t.String(),
  preparation: PreparationSchema,
  options: t.Object({
    challenge: t.String(),
    rpId: t.Optional(t.String()),
    timeout: t.Optional(t.Number()),
    allowCredentials: t.Optional(
      t.Array(t.Object({ id: t.String(), type: t.Literal('public-key') })),
    ),
    userVerification: t.Literal('required'),
  }),
});
export const PublicationCompleteSchema = t.Object({
  state: t.Union([t.Literal('changed'), t.Literal('unchanged')]),
  publication: PublicationSchema,
});
const PublicationBlockedSchema = t.Object({
  state: t.Literal('blocked'),
  error: t.String(),
  blockers: t.Array(BlockerSchema),
});
export const BeginPublicationConflictSchema = t.Union([
  PublicationBlockedSchema,
  t.Object({
    state: t.Union([t.Literal('approval_invalid'), t.Literal('passkey_required')]),
    error: t.String(),
  }),
]);
export const CompletePublicationConflictSchema = t.Union([
  PublicationBlockedSchema,
  t.Object({
    state: t.Union([
      t.Literal('approval_invalid'),
      t.Literal('state_changed'),
      t.Literal('credential_changed'),
    ]),
    error: t.String(),
  }),
]);
export const InvalidAssertionSchema = t.Object({
  state: t.Literal('assertion_invalid'),
  error: t.String(),
});

export function publicationBlockersResponse(blockers: PublicationPreparation['blockers']) {
  return {
    state: 'blocked' as const,
    error: 'Resolve the publication dependencies before trying again.',
    blockers: blockers.map(({ reason, resource }) => ({
      reason,
      resource: {
        resourceType: resource.resourceType,
        readableId: resource.readableId,
        name: resource.name,
      },
    })),
  };
}
