import { Elysia, StatusMap } from 'elysia';
import type { Auth } from '#backend/lib/auth/better-auth.ts';
import { createAuthPlugin } from '#backend/lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#backend/lib/errors.ts';
import type {
  PublicationApprovalBeginResult,
  PublicationApprovalServiceContract,
} from '#backend/services/publications/approval-service.ts';
import {
  ApprovalParamsSchema,
  BeginPublicationBodySchema,
  BeginPublicationConflictSchema,
  CompletePublicationBodySchema,
  CompletePublicationConflictSchema,
  InvalidAssertionSchema,
  PublicationCompleteSchema,
  PublicationParamsSchema,
  PublicationReadySchema,
  PublicationStatusSchema,
  publicationBlockersResponse,
} from './model.ts';

const conflictMessages = {
  approval_invalid:
    'This approval has expired or is no longer available. Review the operation again.',
  passkey_required: 'Add an owner passkey before changing publication.',
  state_changed: 'The reviewed resource or publication changed. Review the operation again.',
  credential_changed: 'The passkey changed during approval. Review the operation again.',
};

export function createPublicationsController({
  auth,
  publicationApprovalService,
}: {
  auth: Auth;
  publicationApprovalService: PublicationApprovalServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({
      auth: true,
      response: {
        [StatusMap.Unauthorized]: ErrorResponseSchema,
        [StatusMap['Bad Request']]: ErrorResponseSchema,
        [StatusMap['Not Found']]: ErrorResponseSchema,
        [StatusMap['Internal Server Error']]: ErrorResponseSchema,
      },
    })
    .get(
      '/publications/:resourceType/:readableId',
      async ({ params, user, status }) => {
        const result = await publicationApprovalService.status({ ...params, ownerId: user.id });
        return result
          ? status(StatusMap.OK, result)
          : status(StatusMap['Not Found'], { error: 'Resource not found' });
      },
      {
        detail: { tags: ['Publications'], summary: 'Read publication status' },
        params: PublicationParamsSchema,
        response: { [StatusMap.OK]: PublicationStatusSchema },
      },
    )
    .post(
      '/publications/approvals',
      async ({ body, user, session, status }) => {
        const result = await publicationApprovalService.begin({
          request: { ...body, ownerId: user.id },
          sessionId: session.id,
        });
        if (result.state === 'ready') {
          return status(StatusMap.OK, publicationReadyResponse(result));
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Resource not found' });
        }
        if (result.state === 'blocked') {
          return status(StatusMap.Conflict, publicationBlockersResponse(result.blockers));
        }
        return status(StatusMap.Conflict, {
          state: result.state,
          error: conflictMessages[result.state],
        });
      },
      {
        detail: {
          tags: ['Publications'],
          summary: 'Prepare a publication operation and begin owner approval',
        },
        body: BeginPublicationBodySchema,
        response: {
          [StatusMap.OK]: PublicationReadySchema,
          [StatusMap.Conflict]: BeginPublicationConflictSchema,
        },
      },
    )
    .post(
      '/publications/approvals/:approvalId/complete',
      async ({ params, body, user, session, status }) => {
        const result = await publicationApprovalService.complete({
          ownerId: user.id,
          sessionId: session.id,
          approvalId: params.approvalId,
          assertion: body.assertion,
        });
        if (result.state === 'changed' || result.state === 'unchanged') {
          return status(StatusMap.OK, {
            state: result.state,
            publication: {
              publicId: result.publication.publicId,
              publishedAt: result.publication.publishedAt,
            },
          });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'Resource not found' });
        }
        if (result.state === 'assertion_invalid') {
          return status(StatusMap.Forbidden, {
            state: result.state,
            error: 'Fresh owner passkey verification is required.',
          });
        }
        if (result.state === 'blocked') {
          return status(StatusMap.Conflict, publicationBlockersResponse(result.blockers));
        }
        return status(StatusMap.Conflict, {
          state: result.state,
          error: conflictMessages[result.state],
        });
      },
      {
        detail: {
          tags: ['Publications'],
          summary: 'Complete the stored publication operation with owner verification',
        },
        params: ApprovalParamsSchema,
        body: CompletePublicationBodySchema,
        response: {
          [StatusMap.OK]: PublicationCompleteSchema,
          [StatusMap.Conflict]: CompletePublicationConflictSchema,
          [StatusMap.Forbidden]: InvalidAssertionSchema,
        },
      },
    );
}

function publicationReadyResponse(
  result: Extract<PublicationApprovalBeginResult, { state: 'ready' }>,
) {
  const { resource, publication, includedImage, pageRevision, blockers } = result.preparation;
  return {
    state: result.state,
    approvalId: result.approvalId,
    expiresAt: result.expiresAt,
    preparation: { resource, publication, includedImage, pageRevision, blockers },
    options: {
      challenge: result.options.challenge,
      rpId: result.options.rpId,
      timeout: result.options.timeout,
      userVerification: 'required' as const,
      allowCredentials: result.options.allowCredentials?.map(({ id, type }) => ({ id, type })),
    },
  };
}
