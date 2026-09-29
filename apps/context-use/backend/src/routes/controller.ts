import { Elysia, StatusMap } from 'elysia';
import { API_PATH } from '#backend/lib/api-path.ts';
import { type Auth, MCP_ROUTE_PATH } from '#backend/lib/auth/better-auth.ts';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { NotFoundError } from '#backend/lib/errors.ts';
import type { FrontendAssetsServiceContract } from '#backend/services/frontend-assets/service.ts';
import type { OwnerRegistrationServiceContract } from '#backend/services/owner-registration/service.ts';
import { publicNotFound } from './public/response.tsx';

export function createEntryController({
  auth,
  ownerRegistrationService,
}: {
  auth: Auth;
  ownerRegistrationService: OwnerRegistrationServiceContract;
}) {
  return new Elysia().get(
    '/',
    async ({ request, redirect, set }) => {
      set.headers['cache-control'] = 'private, no-store';
      const { ownerRegistered } = await ownerRegistrationService.status();
      if (!ownerRegistered) {
        return redirect('/app/login', StatusMap.Found);
      }
      const session = await auth.getSession({ headers: request.headers });
      return redirect(session?.user.id === OWNER_USER_ID ? '/app' : '/public', StatusMap.Found);
    },
    { detail: { hide: true } },
  );
}

// Every file the frontend build produced, one route each. Mounted ahead of the global
// lifecycle hooks on purpose: a route whose handler *is* a ready-made Response stays on
// Bun's native static-route path, and since Bun 1.4 that path answers `If-None-Match` with
// a 304 by itself. A global `derive`/`onAfterResponse` compiles the route into the dynamic
// pipeline instead, and the free revalidation goes with it — so these are registered before
// `requestResponsePlugin` and are the one part of the server that isn't request-logged.
export function createFrontendAssetsController({
  frontendAssetsService,
}: {
  frontendAssetsService: FrontendAssetsServiceContract;
}) {
  const controller = new Elysia();

  for (const [path, response] of frontendAssetsService.routes()) {
    // Hidden from the spec: the frontend is served by this server, but it is not API surface.
    controller.get(path, response, { detail: { hide: true } });
  }

  return controller;
}

// A mount, not a `*` route: a wildcard is greedy within its own method, so a `GET *` here
// swallows every GET a sibling controller binds to a wildcard of its own. A mount runs only
// once nothing else has matched, which is what a fallback means — so unlike the assets above
// this one has to come last.
export function createFrontendFallbackController({
  frontendAssetsService,
}: {
  frontendAssetsService: FrontendAssetsServiceContract;
}) {
  return new Elysia()
    .get(
      '/public/assets/:publicId/preview',
      ({ request }) =>
        frontendAssetsService.fallback(new URL(request.url).pathname) ??
        publicNotFound({ request }),
      { detail: { hide: true } },
    )
    .mount((request) => {
      const { pathname } = new URL(request.url);
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        pathname.startsWith(API_PATH) ||
        pathname === MCP_ROUTE_PATH ||
        pathname === `${MCP_ROUTE_PATH}/`
      ) {
        throw new NotFoundError();
      }
      if (pathname === '/app' || pathname.startsWith('/app/')) {
        return frontendAssetsService.fallback(pathname) ?? publicNotFound({ request });
      }
      return publicNotFound({ request });
    });
}
