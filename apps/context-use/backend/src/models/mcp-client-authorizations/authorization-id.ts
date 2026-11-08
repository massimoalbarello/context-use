import { createHash } from 'node:crypto';

export function mcpClientAuthorizationId(input: {
  ownerId: string;
  oauthClientId: string;
  codeChallenge: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([input.ownerId, input.oauthClientId, input.codeChallenge]))
    .digest('hex');
}
