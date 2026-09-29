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
    <html
      lang="en"
      className="scheme-light-dark bg-[#faf9f6] text-[#292723] [font-family:ui-sans-serif,system-ui,sans-serif] dark:bg-[#201f1c] dark:text-[#e9e5dc]"
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
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
      <body className="m-0 bg-inherit text-inherit [&_*]:box-border [:where(&_a)]:text-inherit [:where(&_a)]:decoration-[#8a8479] [:where(&_a)]:underline-offset-[0.2em] [:where(&_a:focus-visible)]:outline-2 [:where(&_a:focus-visible)]:outline-current [:where(&_a:focus-visible)]:outline-offset-4 [:where(&_a:hover)]:decoration-[0.15em]">
        <main className="mx-auto max-w-3xl px-6 pt-12 max-sm:px-5 max-sm:pt-6">
          {!isHomepage ? (
            <nav
              aria-label="Public navigation"
              className="mb-12 flex items-center justify-between gap-4 text-[#69655d] text-[0.875rem] max-sm:mb-8 dark:text-[#bbb5a9]"
            >
              <a href="/public">Home</a>
            </nav>
          ) : null}
          {children}
        </main>
        <footer className="mx-auto mt-14 mb-16 w-[calc(100%-3rem)] max-w-[45rem] border-[#d7d1c6] border-t border-solid pt-6 leading-[1.6] max-sm:mt-10 max-sm:w-[calc(100%-2.5rem)] dark:border-[#514d46]">
          <div className="flex items-baseline justify-between gap-4">
            <p className="m-0 text-[1rem]">
              self-hosted with{' '}
              <span role="img" aria-label="love" className="mx-[0.15em]">
                ❤️
              </span>{' '}
              using{' '}
              <ReadingLink
                className="font-bold text-[#315e4e] decoration-dotted dark:text-[#a1cbb9]"
                href="https://github.com/massimoalbarello/context-use"
              >
                context-use
              </ReadingLink>
              .
            </p>
            <a className="shrink-0 text-[0.875rem]" href="/app">
              Owner dashboard
            </a>
          </div>
          {modifiedAt || markdownUrl ? (
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4 text-[#69655d] text-[0.875rem] dark:text-[#bbb5a9]">
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
              {markdownUrl ? (
                <a className="ml-auto font-semibold" href={markdownUrl}>
                  View as Markdown
                </a>
              ) : null}
            </div>
          ) : null}
        </footer>
      </body>
    </html>,
  )}`;
}

const STYLE_HASH = new Bun.CryptoHasher('sha256').update(publicStyles).digest('base64');

export const PUBLIC_DOCUMENT_CSP = `default-src 'none'; img-src 'self'; media-src 'self'; style-src 'sha256-${STYLE_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox`;
