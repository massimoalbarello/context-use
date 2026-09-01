import { Elysia, StatusMap, t } from 'elysia';
import type { Auth } from '#lib/auth/better-auth.ts';
import { createAuthPlugin } from '#lib/auth/plugin.ts';
import { ErrorResponseSchema } from '#lib/errors.ts';
import {
  ApproveMcpConnectionBodySchema,
  McpAuthorizationClientQuerySchema,
  McpAuthorizationClientSchema,
  McpConnectionListSchema,
  McpConnectionParamsSchema,
  McpConnectionSchema,
  mcpAuthorizationClientResponse,
  mcpConnectionResponse,
  RenameMcpConnectionBodySchema,
} from '#routes/api/mcp/connections/model.ts';
import type { McpConnectionsServiceContract } from '#services/mcp-connections/service.ts';

const errorResponses = {
  [StatusMap['Bad Request']]: ErrorResponseSchema,
  [StatusMap.Unauthorized]: ErrorResponseSchema,
  [StatusMap.Forbidden]: ErrorResponseSchema,
  [StatusMap['Not Found']]: ErrorResponseSchema,
};

export function createMcpConnectionsController({
  auth,
  connectionsService,
}: {
  auth: Auth;
  connectionsService: McpConnectionsServiceContract;
}) {
  return new Elysia()
    .use(createAuthPlugin({ auth }))
    .guard({ auth: true, response: errorResponses })
    .get(
      '/mcp/authorization-client',
      async ({ query, user, status }) => {
        const result = await connectionsService.authorizationClient({
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
        detail: { tags: ['MCP connections'], summary: 'Describe an OAuth client for approval' },
        query: McpAuthorizationClientQuerySchema,
        response: { [StatusMap.OK]: McpAuthorizationClientSchema },
      },
    )
    .post(
      '/mcp/connections',
      async ({ body, user, status }) => {
        const result = await connectionsService.approve({ actorId: user.id, ...body });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid connection name' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'OAuth client not found' });
        }
        return status(StatusMap.Created, mcpConnectionResponse(result.connection));
      },
      {
        detail: { tags: ['MCP connections'], summary: 'Approve and name an MCP connection' },
        body: ApproveMcpConnectionBodySchema,
        response: { [StatusMap.Created]: McpConnectionSchema },
      },
    )
    .get(
      '/mcp/connections',
      async ({ user, status }) => {
        const result = await connectionsService.list({ actorId: user.id });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        return status(StatusMap.OK, {
          items: result.connections.map(mcpConnectionResponse),
        });
      },
      {
        detail: { tags: ['MCP connections'], summary: 'List active and archived MCP connections' },
        response: { [StatusMap.OK]: McpConnectionListSchema },
      },
    )
    .patch(
      '/mcp/connections/:connectionId',
      async ({ body, params, user, status }) => {
        const result = await connectionsService.rename({
          actorId: user.id,
          connectionId: params.connectionId,
          name: body.name,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'invalid') {
          return status(StatusMap['Bad Request'], { error: 'Invalid connection name' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'MCP connection not found' });
        }
        return status(StatusMap.OK, mcpConnectionResponse(result.connection));
      },
      {
        detail: { tags: ['MCP connections'], summary: 'Rename an MCP connection' },
        params: McpConnectionParamsSchema,
        body: RenameMcpConnectionBodySchema,
        response: { [StatusMap.OK]: McpConnectionSchema },
      },
    )
    .delete(
      '/mcp/connections/:connectionId',
      async ({ params, user, status }) => {
        const result = await connectionsService.archive({
          actorId: user.id,
          connectionId: params.connectionId,
        });
        if (result.state === 'forbidden') {
          return status(StatusMap.Forbidden, { error: 'Forbidden' });
        }
        if (result.state === 'not_found') {
          return status(StatusMap['Not Found'], { error: 'MCP connection not found' });
        }
        return status(StatusMap['No Content'], undefined);
      },
      {
        detail: { tags: ['MCP connections'], summary: 'Archive and revoke an MCP connection' },
        params: McpConnectionParamsSchema,
        response: { [StatusMap['No Content']]: t.Void() },
      },
    );
}
