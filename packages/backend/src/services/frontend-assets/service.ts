import { extname } from 'node:path';
import { createLogger } from '#lib/logger.ts';
import type { FrontendAssetsRepositoryContract } from '#repositories/frontend-assets/repository.ts';

const ROOT_ASSET_PATH = '/';
const INDEX_HTML_PATH = '/index.html';
// Vite content-hashes the filenames in this folder, so they never change.
const IMMUTABLE_PATH_PREFIX = '/assets/';
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE_CONTROL = 'no-cache';

export class FrontendAssetsService {
  private readonly assets: FrontendAssetsRepositoryContract;
  private readonly logger = createLogger('FrontendAssetsService');

  constructor(assets: FrontendAssetsRepositoryContract) {
    this.assets = assets;
  }

  routes(): Map<string, Response> {
    const assets = this.assets.list();
    const routes = new Map<string, Response>();

    for (const [path, asset] of assets) {
      routes.set(path, this.respond({ asset, path }));
    }

    const indexHtml = assets.get(INDEX_HTML_PATH);
    if (indexHtml) {
      routes.set(ROOT_ASSET_PATH, this.respond({ asset: indexHtml, path: INDEX_HTML_PATH }));
    }

    this.logger.info(`Serving ${routes.size} frontend routes`);
    return routes;
  }

  fallback(path: string): Response | null {
    // Only client-side routes fall back to the app, a missing file must 404.
    if (extname(path) !== '') {
      return null;
    }

    const indexHtml = this.assets.list().get(INDEX_HTML_PATH);
    return indexHtml ? this.respond({ asset: indexHtml, path: INDEX_HTML_PATH }) : null;
  }

  private respond({ asset, path }: { asset: Blob; path: string }): Response {
    const cacheControl = path.startsWith(IMMUTABLE_PATH_PREFIX)
      ? IMMUTABLE_CACHE_CONTROL
      : REVALIDATE_CACHE_CONTROL;

    return new Response(asset, {
      headers: { 'Cache-Control': cacheControl },
    });
  }
}

export type FrontendAssetsServiceContract = Pick<FrontendAssetsService, 'routes' | 'fallback'>;
