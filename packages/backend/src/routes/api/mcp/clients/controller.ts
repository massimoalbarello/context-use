import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  ApproveMcpClientBodySchema,
  McpAuthorizationClientQuerySchema,
  McpAuthorizationClientSchema,
  McpClientListSchema,
  McpClientParamsSchema,
  McpClientSchema,
  mcpAuthorizationClientResponse,
  mcpClientResponse,
  RenameMcpClientBodySchema,
} from '#routes/api/mcp/clients/model.ts';
import type { McpClientAuthorizationsServiceContract } from '#services/mcp-client-authorizations/service.ts';

const errorResponses = {
  [StatusMap['Bad Request']]: ErrorResponseSchema,
  [StatusMap.Unauthorized]: ErrorResponseSchema,
  [StatusMap.Forbidden]: ErrorResponseSchema,
  [StatusMap['Not Found']]: ErrorResponseSchema,
};

const clientNameConflict = { error: 'An MCP client already uses this name' } as const;

export function createMcpClientsController({
  auth,
  clientAuthorizationsService,
  mcpServerUrl,
}: {
  auth: Auth;
  clientAuthorizationsService: McpClientAuthorizationsServiceContract;
  mcpServerUrl: string;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: errorResponses })
    .get(
      '/mcp/authorization-client',
      async ({ query, user, status }) => {
        const result = await clientAuthorizationsService.authorizationClient({
          actorId: user.id,
          clientId: query.clientId,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'OAuth client not found' });
        }
        return status(StatusMap.OK, mcpAuthorizationClientResponse(result.client));
      },
      {
        detail: { tags: ['MCP clients'], summary: 'Describe an OAuth client for approval' },
        query: McpAuthorizationClientQuerySchema,
        response: { [StatusMap.OK]: McpAuthorizationClientSchema },
      },
    )
    .post(
      '/mcp/clients',
      async ({ body, user, status }) => {
        const result = await clientAuthorizationsService.approve({ actorId: user.id, ...body });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid client name' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'OAuth client not found' });
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, clientNameConflict);
        }
        return status(StatusMap.Created, mcpClientResponse(result.clientAuthorization));
      },
      {
        detail: { tags: ['MCP clients'], summary: 'Approve and name an MCP client' },
        body: ApproveMcpClientBodySchema,
        response: {
          [StatusMap.Created]: McpClientSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/mcp/clients',
      async ({ user, status }) => {
        const result = await clientAuthorizationsService.list({ actorId: user.id });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        return status(StatusMap.OK, {
          serverUrl: mcpServerUrl,
          items: result.clientAuthorizations.map(mcpClientResponse),
        });
      },
      {
        detail: { tags: ['MCP clients'], summary: 'List active and archived MCP clients' },
        response: { [StatusMap.OK]: McpClientListSchema },
      },
    )
    .patch(
      '/mcp/clients/:clientAuthorizationId',
      async ({ body, params, user, status }) => {
        const result = await clientAuthorizationsService.rename({
          actorId: user.id,
          clientAuthorizationId: params.clientAuthorizationId,
          name: body.name,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid client name' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'MCP client not found' });
        }
        if (result.state === 'name_conflict') {
          return status(StatusMap.Conflict, clientNameConflict);
        }
        return status(StatusMap.OK, mcpClientResponse(result.clientAuthorization));
      },
      {
        detail: { tags: ['MCP clients'], summary: 'Rename an MCP client' },
        params: McpClientParamsSchema,
        body: RenameMcpClientBodySchema,
        response: {
          [StatusMap.OK]: McpClientSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
        },
      },
    )
    .put(
      '/mcp/clients/:clientAuthorizationId/archive',
      async ({ params, user, status }) => {
        const result = await clientAuthorizationsService.archive({
          actorId: user.id,
          clientAuthorizationId: params.clientAuthorizationId,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'MCP client not found' });
        }
        return status(StatusMap['No Content'], undefined);
      },
      {
        detail: { tags: ['MCP clients'], summary: 'Archive and revoke an MCP client' },
        params: McpClientParamsSchema,
        response: { [StatusMap['No Content']]: t.Void() },
      },
    );
}
