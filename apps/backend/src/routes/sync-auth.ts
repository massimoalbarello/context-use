import type { OpenAPIV3 } from 'openapi-types';
import { isUuidV7, type RecordSyncPrincipal } from '#models/syncs/model.ts';
import type { RecordSyncAuthenticationContract } from '#services/syncs/service.ts';

export const RECORD_SYNC_SECURITY_SCHEME = 'recordSyncBearer';
export const recordSyncSecuritySchemes = {
  [RECORD_SYNC_SECURITY_SCHEME]: {
    type: 'http',
    scheme: 'bearer',
    description: 'API key issued to a sync for record delivery and independent asset uploads.',
  },
} satisfies Record<string, OpenAPIV3.SecuritySchemeObject>;

export async function authenticateSyncRequest({
  request,
  syncs,
}: {
  request: Request;
  syncs: RecordSyncAuthenticationContract;
}): Promise<RecordSyncPrincipal | null> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  const apiKey = authorization.slice('Bearer '.length);
  return isUuidV7(apiKey) ? await syncs.authenticate({ apiKey }) : null;
}
