import { Elysia } from 'elysia';
import { elysiaErrorHandler } from '#lib/errors.ts';
import { createAssetReadableIdController } from '#routes/api/assets/[assetReadableId]/controller.ts';
import { createAssetsController } from '#routes/api/assets/controller.ts';
import { createEntityReadableIdController } from '#routes/api/entities/[entityReadableId]/controller.ts';
import { createEntitiesController } from '#routes/api/entities/controller.ts';
import { createHealthController } from '#routes/api/health/controller.ts';
import { createHypermediaController } from '#routes/api/hypermedia/controller.ts';
import { createHypermediaSearchController } from '#routes/api/hypermedia/search/controller.ts';
import { createPageReadableIdController } from '#routes/api/pages/[pageReadableId]/controller.ts';
import { createPagesController } from '#routes/api/pages/controller.ts';
import { createKnowledgeProfileController } from '#routes/api/profile/controller.ts';
import { createRecordReadableIdController } from '#routes/api/records/[recordReadableId]/controller.ts';
import { createRecordsController } from '#routes/api/records/controller.ts';
import type { FrontendAssetsServiceContract } from '#services/frontend-assets/service.ts';
import { createDemoIdentity } from './identity';
import type { createDemoResources } from './resources';

// This list deliberately names read operations, including safe GETs only. New controller
// routes never become public automatically. Auth, MCP and delivery controllers aren't mounted.
const READ_API_ROUTES = new Set([
  '/api/health',
  '/api/profile',
  '/api/entities',
  '/api/entities/:entityReadableId',
  '/api/pages',
  '/api/pages/:pageReadableId',
  '/api/pages/:pageReadableId/preview',
  '/api/assets',
  '/api/assets/:assetReadableId',
  '/api/assets/:assetReadableId/content',
  '/api/records',
  '/api/records/filter-options',
  '/api/records/:recordReadableId',
  '/api/hypermedia/resources',
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
    /^\/(?:entities|pages|assets|records)(?:\/(?!new$)[a-z0-9][a-z0-9-]*)?$/.test(path)
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
  const api = new Elysia({ prefix: '/api' })
    .onError(elysiaErrorHandler)
    .use(createAssetsController(dependencies))
    .use(createAssetReadableIdController(dependencies))
    .use(createEntitiesController(dependencies))
    .use(createEntityReadableIdController(dependencies))
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
      return Response.json({ error: 'This public demo is read-only.' }, { status: 403 });
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
        { error: 'This route is unavailable in the public demo.' },
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
