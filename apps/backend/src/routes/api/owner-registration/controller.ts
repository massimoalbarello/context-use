import { Elysia, StatusMap } from 'elysia';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { OwnerRegistrationStatusSchema } from '#routes/api/owner-registration/model.ts';
import type { OwnerRegistrationServiceContract } from '#services/owner-registration/service.ts';

export function createOwnerRegistrationController({
  ownerRegistrationService,
}: {
  ownerRegistrationService: OwnerRegistrationServiceContract;
}) {
  return new Elysia().get(
    '/owner-registration',
    async ({ status }) => status(StatusMap.OK, await ownerRegistrationService.status()),
    {
      detail: {
        tags: ['Owner registration'],
        summary: 'Read owner registration status',
        description: 'Reports whether this Context Use instance already has an owner passkey.',
      },
      response: {
        [StatusMap.OK]: OwnerRegistrationStatusSchema,
        [StatusMap['Internal Server Error']]: ErrorResponseSchema,
      },
    },
  );
}
