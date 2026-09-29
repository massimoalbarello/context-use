import { ReadingLink } from '@repo/ui/reading-link';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PUBLIC_SITE_NAME } from '#backend/lib/runtime-config.ts';
import { publicStyles } from './styles.gen.ts';

const DESCRIPTION_LENGTH = 280;

export function publicDocument({
  title,
  siteName = DEFAULT_PUBLIC_SITE_NAME,
  description = title,
  canonicalUrl,
  modifiedAt,
  markdownUrl,
  linkTarget,
  children,
}: {
  title: string;
  siteName?: string;
  description?: string;
  canonicalUrl?: string;
  modifiedAt?: string;
  markdownUrl?: string;
  linkTarget?: '_top';
  children: ReactNode;
}): string {
  const isHomepage = canonicalUrl !== undefined && new URL(canonicalUrl).pathname === '/public';
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <meta httpEquiv="Content-Security-Policy" content={PUBLIC_DOCUMENT_CONTENT_CSP} />
        {linkTarget ? <base target={linkTarget} /> : null}
        <title>{title}</title>
        <meta name="description" content={description.slice(0, DESCRIPTION_LENGTH)} />
        <meta property="og:title" content={title} />
        <meta property="og:site_name" content={siteName} />
        <meta property="og:description" content={description.slice(0, DESCRIPTION_LENGTH)} />
        <meta property="og:type" content="website" />
        {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
        {canonicalUrl ? <meta property="og:url" content={canonicalUrl} /> : null}
        {markdownUrl ? <link rel="alternate" type="text/markdown" href={markdownUrl} /> : null}
        <link rel="describedby" href="/llms.txt" />
        <link rel="sitemap" type="application/xml" href="/sitemap.xml" />
        {isHomepage ? (
          <script type="application/ld+json">
            {JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: siteName,
              url: canonicalUrl,
            }).replace(/</g, '\\u003c')}
          </script>
        ) : null}
        <style>{publicStyles}</style>
      </head>
      <body>
        <main>
          {!isHomepage ? (
            <nav aria-label="Public navigation">
              <a href="/public">Home</a>
            </nav>
          ) : null}
          {children}
        </main>
        <footer>
          <div className="footer-credit">
            <p>
              self-hosted with{' '}
              <span role="img" aria-label="love">
                ❤️
              </span>{' '}
              using{' '}
              <ReadingLink
                className="repository"
                href="https://github.com/massimoalbarello/context-use"
              >
                context-use
              </ReadingLink>
              .
            </p>
            <a className="owner-login" href="/app">
              Owner dashboard
            </a>
          </div>
          {modifiedAt || markdownUrl ? (
            <div className="footer-details">
              {modifiedAt ? (
                <span>
                  Last updated{' '}
                  <time dateTime={modifiedAt}>
                    {new Intl.DateTimeFormat('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(modifiedAt))}
                  </time>
                </span>
              ) : null}
              {markdownUrl ? <a href={markdownUrl}>View as Markdown</a> : null}
            </div>
          ) : null}
        </footer>
      </body>
    </html>,
  )}`;
}

const STYLE_HASH = new Bun.CryptoHasher('sha256').update(publicStyles).digest('base64');

// Keep authored content script-free, including srcdoc publication reviews. The sandbox
// permits scripts only so the separate PDF viewer can run and native media can load lazily.
const PUBLIC_DOCUMENT_CONTENT_CSP = `default-src 'none'; script-src 'none'; img-src 'self'; media-src 'self'; frame-src 'self'; style-src 'sha256-${STYLE_HASH}'; base-uri 'none'; form-action 'none'`;
export const PUBLIC_DOCUMENT_CSP = `${PUBLIC_DOCUMENT_CONTENT_CSP}; frame-ancestors 'none'; sandbox allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-scripts`;
