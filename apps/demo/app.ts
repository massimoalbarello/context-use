import { elysiaErrorHandler } from '@repo/backend/lib/errors';
import { createAssetReadableIdController } from '@repo/backend/routes/api/assets/[assetReadableId]/controller';
import { createAssetFacesController } from '@repo/backend/routes/api/assets/[assetReadableId]/faces/controller';
import { createAssetsController } from '@repo/backend/routes/api/assets/controller';
import { createEntityReadableIdController } from '@repo/backend/routes/api/entities/[entityReadableId]/controller';
import { createEntityImagesController } from '@repo/backend/routes/api/entities/[entityReadableId]/images/controller';
import { createEntitiesController } from '@repo/backend/routes/api/entities/controller';
import { createFaceRecognitionController } from '@repo/backend/routes/api/face-recognition/controller';
import { createHealthController } from '@repo/backend/routes/api/health/controller';
import { createHypermediaController } from '@repo/backend/routes/api/hypermedia/controller';
import { createHypermediaSearchController } from '@repo/backend/routes/api/hypermedia/search/controller';
import { createPageReadableIdController } from '@repo/backend/routes/api/pages/[pageReadableId]/controller';
import { createPagesController } from '@repo/backend/routes/api/pages/controller';
import { createKnowledgeProfileController } from '@repo/backend/routes/api/profile/controller';
import { createRecordReadableIdController } from '@repo/backend/routes/api/records/[recordReadableId]/controller';
import { createRecordsController } from '@repo/backend/routes/api/records/controller';
import type { FrontendAssetsServiceContract } from '@repo/backend/services/frontend-assets/service';
import { Elysia } from 'elysia';
import { createDemoIdentity } from './identity';
import type { createDemoResources } from './resources';

// This list deliberately names read operations, including safe GETs only. New controller
// routes never become public automatically. Auth, MCP and delivery controllers aren't mounted.
const READ_API_ROUTES = new Set([
  '/api/health',
  '/api/profile',
  '/api/entities',
  '/api/entities/:entityReadableId',
  '/api/entities/:entityReadableId/images',
  '/api/pages',
  '/api/pages/:pageReadableId',
  '/api/pages/:pageReadableId/preview',
  '/api/assets',
  '/api/assets/:assetReadableId',
  '/api/assets/:assetReadableId/content',
  '/api/assets/:assetReadableId/faces',
  '/api/assets/:assetReadableId/faces/:faceReadableId/crop',
  '/api/face-recognition/settings',
  '/api/records',
  '/api/records/filter-options',
  '/api/records/:recordReadableId',
  '/api/hypermedia/entities',
  '/api/hypermedia/pages',
  '/api/hypermedia/search',
]);
const READ_API_PATHS = [...READ_API_ROUTES].map(
  (route) => new RegExp(`^${route.replace(/:[^/]+/g, '[a-z0-9][a-z0-9-]*')}$`),
);

function isWorkspacePath(path: string): boolean {
  return (
    path === '/' ||
    path === '/hypermedia' ||
    path === '/settings' ||
    path === '/settings/syncs' ||
    path === '/settings/faces' ||
    /^\/(?:entities|pages|assets|records)(?:\/[a-z0-9][a-z0-9-]*)?$/.test(path)
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
  const api = new Elysia({ prefix: '/api' })
    .onError(elysiaErrorHandler)
    .use(createAssetsController(dependencies))
    .use(createAssetReadableIdController(dependencies))
    .use(createAssetFacesController(faceDependencies))
    .use(createEntitiesController(dependencies))
    .use(createEntityReadableIdController(dependencies))
    .use(createEntityImagesController(faceDependencies))
    .use(createFaceRecognitionController(faceDependencies))
    .use(createHypermediaController(dependencies))
    .use(createHypermediaSearchController(dependencies))
    .use(createPagesController(dependencies))
    .use(createPageReadableIdController(dependencies))
    .use(createRecordsController(dependencies))
    .use(createRecordReadableIdController(dependencies))
    .use(createKnowledgeProfileController(dependencies))
    .use(createHealthController(dependencies))
    .compile();
  // A newly added static GET could otherwise shadow an approved :readableId route.
  // Fail startup until every mounted GET has been explicitly reviewed for the demo.
  for (const route of api.routes) {
    if (route.method === 'GET' && !READ_API_ROUTES.has(route.path)) {
      throw new Error(`Unreviewed public demo read route: ${route.path}`);
    }
  }
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
    if (path === '/api/auth/get-session') {
      response = Response.json(await auth.getSession({ headers: request.headers }));
    } else if (READ_API_PATHS.some((pattern) => pattern.test(path))) {
      // Elysia's shared resource controllers declare GET, so handle HEAD at this boundary.
      response = await api.handle(new Request(request.url, { headers: request.headers }));
    } else if (files.has(path)) {
      response = files.get(path)!.clone();
    } else if (isWorkspacePath(path)) {
      response = frontendAssetsService.fallback(path) ?? new Response(null, { status: 404 });
    } else {
      response = Response.json(
        { message: 'This public demo is read-only. This action is unavailable.' },
        { status: 403 },
      );
    }
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (path.startsWith('/api/')) {
      response.headers.set('Cache-Control', 'no-store');
    }
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
