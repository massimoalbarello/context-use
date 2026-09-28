import { Elysia, StatusMap } from 'elysia';
import { elysiaErrorHandler } from '#backend/lib/errors.ts';
import { createAssetReadableIdController } from '#backend/routes/api/assets/[assetReadableId]/controller.ts';
import { createAssetFacesController } from '#backend/routes/api/assets/[assetReadableId]/faces/controller.ts';
import { createAssetsController } from '#backend/routes/api/assets/controller.ts';
import { createEntityReadableIdController } from '#backend/routes/api/entities/[entityReadableId]/controller.ts';
import { createEntityImagesController } from '#backend/routes/api/entities/[entityReadableId]/images/controller.ts';
import { createEntitiesController } from '#backend/routes/api/entities/controller.ts';
import { createFaceRecognitionController } from '#backend/routes/api/face-recognition/controller.ts';
import { createHealthController } from '#backend/routes/api/health/controller.ts';
import { createHistoryController } from '#backend/routes/api/history/controller.ts';
import { createHypermediaSearchController } from '#backend/routes/api/hypermedia/search/controller.ts';
import { createMapController } from '#backend/routes/api/map/controller.ts';
import { createPageReadableIdController } from '#backend/routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#backend/routes/api/pages/controller.ts';
import { createKnowledgeProfileController } from '#backend/routes/api/profile/controller.ts';
import { createPublicationsController } from '#backend/routes/api/publications/controller.ts';
import { createRecordReadableIdController } from '#backend/routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#backend/routes/api/records/controller.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import { createDemoIdentity } from './identity';
import type { createDemoResources } from './resources';

function unavailableResponse() {
  return Response.json(
    { message: 'This public demo is read-only. This action is unavailable.' },
    { status: StatusMap.Forbidden },
  );
}

function publicReadResponse({
  method,
  path,
  response,
}: {
  method: string;
  path: string;
  response: ReturnType<Response['clone']>;
}): Response {
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (path.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    headers: response.headers,
  });
}

function isWorkspacePath(path: string): boolean {
  return (
    path === '/app' ||
    path === '/app/map' ||
    path === '/app/history' ||
    path === '/app/settings' ||
    path === '/app/settings/api-keys' ||
    path === '/app/settings/faces' ||
    /^\/app\/(?:entities|pages|assets|records)(?:\/[a-z0-9][a-z0-9-]*)?$/.test(path)
  );
}

export function createDemoApp({
  resources,
  frontendAssetsService,
}: {
  resources: ReturnType<typeof createDemoResources>;
  frontendAssetsService: FrontendAssetsServiceContract;
}) {
  const auth = createDemoIdentity();
  const dependencies = { ...resources, auth };
  const faceDependencies = { auth, faces: resources.assetsService.faces };
  // Only these resource controllers receive the demo identity. Account, credential,
  // sync, MCP, and public-site controllers belong exclusively to the instance app.
  const api = new Elysia({ prefix: '/api', strictPath: true })
    .onError((context) =>
      context.code === 'NOT_FOUND' ? unavailableResponse() : elysiaErrorHandler(context),
    )
    .use(createHistoryController(dependencies))
    .use(createAssetsController(dependencies))
    .use(createAssetReadableIdController(dependencies))
    .use(createAssetFacesController(faceDependencies))
    .use(createEntitiesController(dependencies))
    .use(createEntityReadableIdController(dependencies))
    .use(createEntityImagesController(faceDependencies))
    .use(createFaceRecognitionController(faceDependencies))
    .use(createMapController(dependencies))
    .use(createHypermediaSearchController(dependencies))
    .use(createPagesController(dependencies))
    .use(createPageReadableIdController(dependencies))
    .use(createRecordsController(dependencies))
    .use(createRecordReadableIdController(dependencies))
    .use(createKnowledgeProfileController(dependencies))
    .use(createPublicationsController(dependencies))
    .use(createHealthController(dependencies))
    .compile();
  const files = frontendAssetsService.routes();

  // Bun.serve receives only this function. No native/static route can skip this outer gate.
  return async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return Response.json(
        {
          code: 'DEMO_READ_ONLY',
          message: 'This public demo is read-only. Changes and account actions cannot be saved.',
        },
        { status: 403 },
      );
    }
    let response: ReturnType<Response['clone']>;
    if (path === '/') {
      response = new Response(null, { status: StatusMap.Found, headers: { location: '/app/map' } });
    } else if (path === '/api/auth/get-session') {
      response = Response.json(await auth.getSession({ headers: request.headers }));
    } else if (path.startsWith('/api/')) {
      // Elysia's shared resource controllers declare GET, so handle HEAD at this boundary.
      response = await api.handle(new Request(request.url, { headers: request.headers }));
    } else if (files.has(path)) {
      response = files.get(path)!.clone();
    } else if (isWorkspacePath(path)) {
      response = frontendAssetsService.fallback(path) ?? new Response(null, { status: 404 });
    } else {
      response = unavailableResponse();
    }
    return publicReadResponse({ method: request.method, path, response });
  };
}
