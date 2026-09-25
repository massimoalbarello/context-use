import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const READING_STYLES = `
:root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; color: #292723; background: #faf9f6; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 48rem; margin: auto; padding: 3rem 1.5rem 0; }
nav { display: flex; gap: 1rem; justify-content: space-between; align-items: center; margin-bottom: 3rem; font-size: .875rem; color: #69655d; }
nav span { font-weight: 600; letter-spacing: .02em; }
article { overflow-wrap: anywhere; line-height: 1.8; font-size: 1.0625rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; letter-spacing: -.025em; scroll-margin-top: 1.5rem; }
h1 { font-size: clamp(2rem, 6vw, 3rem); margin: 0 0 2rem; }
h2 { font-size: 1.65rem; margin-top: 2.5rem; }
h3, h4, h5, h6 { margin-top: 2rem; }
p, ul, ol { margin: 1.25rem 0; }
a { color: inherit; text-decoration-color: #8a8479; text-underline-offset: .2em; }
a:hover { text-decoration-thickness: .15em; }
a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
img { display: block; max-width: 100%; height: auto; border-radius: .5rem; margin: 1.5rem auto; }
blockquote { margin: 1.5rem 0; border-left: 3px solid #c8c2b7; padding-left: 1.25rem; color: #69655d; }
code { font-size: .875em; background: #eeeae2; padding: .15em .3em; border-radius: .2rem; }
pre { overflow-x: auto; padding: 1.25rem; background: #eeeae2; border-radius: .5rem; line-height: 1.6; }
pre code { padding: 0; background: none; }
footer { max-width: 45rem; width: calc(100% - 3rem); margin: 3.5rem auto 4rem; padding-top: 1.5rem; border-top: 1px solid #d7d1c6; line-height: 1.6; }
footer p { margin: 0; font-size: 1rem; }
footer [role="img"] { margin-inline: .15em; }
footer .repository { color: #315e4e; font-weight: 700; text-decoration-style: dotted; }
.footer-details { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1rem; margin-top: .75rem; font-size: .875rem; color: #69655d; }
.footer-links { margin-left: auto; display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; }
.footer-links a { font-weight: 600; }
hr { border: 0; border-top: 1px solid #d7d1c6; margin: 2rem 0; }
.entity-identity { display: flex; align-items: center; flex-wrap: wrap; gap: 1.5rem; }
.entity-identity h1 { margin: 0; }
.entity-identity > div { flex: 1; min-width: min(15rem, 100%); }
img.entity-portrait { width: 10rem; height: 10rem; object-fit: cover; margin: 0; }
.entity-type { margin: 0 0 .5rem; font-size: .875rem; }
.entity-description { white-space: pre-wrap; }
@media (max-width: 40rem) { main { padding: 1.5rem 1.25rem 0; } footer { width: calc(100% - 2.5rem); margin-top: 2.5rem; } nav { margin-bottom: 2rem; } }
@media (prefers-color-scheme: dark) { :root { color: #e9e5dc; background: #201f1c; } nav, blockquote, .footer-details { color: #bbb5a9; } footer { border-color: #514d46; } footer .repository { color: #a1cbb9; } code, pre { background: #302e29; } }
`;

export function publicDocument({
  title,
  navigation,
  modifiedAt,
  markdownUrl,
  children,
}: {
  title: string;
  navigation?: ReactNode;
  modifiedAt?: string;
  markdownUrl?: string;
  children: ReactNode;
}): string {
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>{title}</title>
        <style>{READING_STYLES}</style>
      </head>
      <body>
        <main>
          <nav aria-label="Public resource">
            <span>Context Use</span>
            {navigation}
          </nav>
          {children}
        </main>
        <footer>
          <p>
            self-hosted with{' '}
            <span role="img" aria-label="love">
              ❤️
            </span>{' '}
            using{' '}
            <a className="repository" href="https://github.com/massimoalbarello/context-use">
              context-use<span aria-hidden="true">↗</span>
            </a>
            .
          </p>
          <div className="footer-details">
            {modifiedAt ? (
              <span>
                Last edited{' '}
                <time dateTime={modifiedAt}>
                  {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  }).format(new Date(modifiedAt))}
                </time>
              </span>
            ) : null}
            <div className="footer-links">
              {markdownUrl ? <a href={markdownUrl}>View as Markdown</a> : null}
            </div>
          </div>
        </footer>
      </body>
    </html>,
  )}`;
}

const STYLE_HASH = new Bun.CryptoHasher('sha256').update(READING_STYLES).digest('base64');

export const PUBLIC_DOCUMENT_CSP = `default-src 'none'; img-src 'self'; style-src 'sha256-${STYLE_HASH}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin allow-downloads`;
