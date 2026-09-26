import Negotiator from 'negotiator';
import { PUBLIC_DOCUMENT_CSP, publicDocument } from './document.tsx';

export function publicReadingResponse({
  request,
  html,
  markdown,
  canonicalUrl,
  markdownUrl,
  status = 200,
}: {
  request: Request;
  html: () => string;
  markdown: () => string;
  canonicalUrl?: string;
  markdownUrl?: string;
  status?: number;
}) {
  const mediaType = new Negotiator({
    headers: { accept: request.headers.get('accept') ?? '*/*' },
  }).mediaType(['text/html', 'text/markdown']);
  const headers = new Headers({
    vary: 'Accept',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': PUBLIC_DOCUMENT_CSP,
    'referrer-policy': 'no-referrer',
  });
  const links = ['</llms.txt>; rel="describedby"'];
  if (canonicalUrl) {
    links.push(`<${canonicalUrl}>; rel="canonical"`);
  }
  if (markdownUrl) {
    links.push(`<${markdownUrl}>; rel="alternate"; type="text/markdown"`);
  }
  headers.set('link', links.join(', '));
  if (!mediaType) {
    headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(
      'Request text/html or text/markdown. Browse public content at /public/directory.',
      {
        status: 406,
        headers,
      },
    );
  }
  headers.set('content-type', `${mediaType}; charset=utf-8`);
  return new Response(mediaType === 'text/markdown' ? markdown() : html(), { status, headers });
}

export function publicNotFound({
  request,
  markdown = false,
}: {
  request: Request;
  markdown?: boolean;
}) {
  const content =
    '# Public content not found\n\nThis address is unavailable.\n\n[Browse public content](/public/directory) or use the [AI-readable site index](/llms.txt).\n';
  if (markdown) {
    return new Response(content, {
      status: 404,
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
  }
  return publicReadingResponse({
    request,
    status: 404,
    markdown: () => content,
    html: () =>
      publicDocument({
        title: 'Public content not found',
        children: (
          <article>
            <h1>Public content not found</h1>
            <p>This address is unavailable.</p>
            <p>
              <a href="/public/directory">Browse public content</a> or use the{' '}
              <a href="/llms.txt">AI-readable site index</a>.
            </p>
          </article>
        ),
      }),
  });
}
