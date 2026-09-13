import type { BunFile } from 'bun';

const DEFAULT_PORT = 3000;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;
const ASSET_PREFIX = 'public/';
const assets = new Map<string, BunFile>();
for (const file of Bun.embeddedFiles as readonly BunFile[]) {
  if (file.name?.startsWith(ASSET_PREFIX)) {
    assets.set(`/${file.name.slice(ASSET_PREFIX.length)}`, file);
  }
}
if (!assets.has('/index.html')) {
  throw new Error('Missing landing assets. Build with bun run landing:build first.');
}

const server = Bun.serve({
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: METHOD_NOT_ALLOWED,
        headers: { Allow: 'GET, HEAD' },
      });
    }
    const path = new URL(request.url).pathname;
    const asset = assets.get(path === '/' ? '/index.html' : path);
    if (!asset) {
      return new Response('Not found', { status: NOT_FOUND });
    }
    return new Response(request.method === 'HEAD' ? null : asset, {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': path.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});
console.log(`Context Use landing listening on ${server.url}`);

process.on('SIGTERM', () => void server.stop());
process.on('SIGINT', () => void server.stop());
