import { IMAGE_LAYOUT_STYLES } from "@context-use/shared";

const CONTEXT_USE_URL = "https://github.com/massimoalbarello/context-use";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type PublicIndexEntry = {
  kind: "directory" | "page";
  path: string;
  title: string | null;
  summary: string | null;
  published_count: number;
  default_page_path: string | null;
};

function humanizePath(path: string): string {
  const leaf = path.split("/").at(-1) ?? "knowledge";
  return leaf
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function indexHref(path: string): string {
  return path ? `/p/${path}/` : "/p/";
}

export function publicPageHref(path: string | null): string | null {
  return path ? `/p/${path}` : null;
}

function renderKnowledgeNavigation(currentPath: string, currentLabel: string): string {
  const segments = currentPath.split("/").filter(Boolean);
  const knowledge = currentPath
    ? '<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="/p/">Knowledge</a></li>'
    : "";
  const ancestors = segments.slice(0, -1).map((segment, position) => {
    const path = segments.slice(0, position + 1).join("/");
    return `<li><span class="breadcrumb-separator" aria-hidden="true">/</span><a href="${escapeHtml(indexHref(path))}">${escapeHtml(humanizePath(segment))}</a></li>`;
  }).join("");
  return `<nav class="knowledge-navigation" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>${knowledge}${ancestors}<li aria-current="page"><span class="breadcrumb-separator" aria-hidden="true">/</span>${escapeHtml(currentLabel)}</li></ol></nav>`;
}

function renderLastEdited(lastEditedAt?: string | Date): string {
  if (lastEditedAt === undefined) return "";
  const date = new Date(lastEditedAt);
  if (Number.isNaN(date.getTime())) return "";
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `<span class="page-last-edited"><strong>Last edited</strong> <time datetime="${date.toISOString()}">${label}</time></span>`;
}

function renderFootnote(publicPath?: string, lastEditedAt?: string | Date): string {
  const utilities = [
    renderLastEdited(lastEditedAt),
    publicPath === undefined
      ? ""
      : `<a href="/p/${escapeHtml(publicPath)}.md" type="text/markdown">View as Markdown</a>`,
    '<a href="/llms.txt" type="text/plain">AI-readable site index</a>',
  ].filter(Boolean).join('<span class="footer-separator" aria-hidden="true">·</span>');
  return `<footer class="context-use-footnote"><p class="context-use-credit">self-hosted with ❤️ using <a class="external-link" href="${CONTEXT_USE_URL}" target="_blank" rel="noopener noreferrer" title="External link (opens in a new tab)">context-use</a>.</p><p class="context-use-utilities">${utilities}</p></footer>`;
}

export function renderPublicPageDocument(
  title: string,
  content: string,
  publicPath?: string,
  lastEditedAt?: string | Date,
): string {
  const navigation = publicPath === undefined ? "" : renderKnowledgeNavigation(publicPath, title);
  const markdownAlternate = publicPath === undefined
    ? ""
    : `<link rel="alternate" type="text/markdown" href="/p/${escapeHtml(publicPath)}.md" title="${escapeHtml(title)} as Markdown">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>${markdownAlternate}<link rel="stylesheet" href="/public.css"><link rel="stylesheet" href="/content.css"></head><body><main class="public-page">${navigation}<article>${content}</article>${renderFootnote(publicPath, lastEditedAt)}</main></body></html>`;
}

export function renderPublicIndexDocument(index: {
  path: string;
  default_page_path: string | null;
  entries: PublicIndexEntry[];
}): string {
  const title = index.path ? humanizePath(index.path) : "Knowledge";
  const navigation = renderKnowledgeNavigation(index.path, title);
  const entries = index.entries.map((entry) => {
    const entryTitle = entry.kind === "page" ? entry.title ?? humanizePath(entry.path) : humanizePath(entry.path);
    const description = entry.kind === "page"
      ? entry.summary ?? "Published page."
      : `${entry.published_count} published page${entry.published_count === 1 ? "" : "s"}.`;
    const href = entry.kind === "page"
      ? publicPageHref(entry.path)!
      : publicPageHref(entry.default_page_path) ?? indexHref(entry.path);
    return `<li><a href="${href}">${escapeHtml(entryTitle)}</a><span>— ${escapeHtml(description)}</span></li>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-page public-index">${navigation}<header class="public-index-header"><h1>${escapeHtml(title)}</h1><span>Only explicitly published knowledge appears here.</span></header><ol class="public-index-list">${entries}</ol>${renderFootnote()}</main></body></html>`;
}

export function renderPublicLandingDocument(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My public context</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-landing"><section class="billboard"><p class="landing-kicker">My public context</p><h1>A public billboard<br>for what I choose to share.</h1><p class="landing-lede">This is the front door to who I am, what I’m thinking about, and what I’m building.</p><a class="landing-cta" href="/p/about/intro">Explore my knowledge base <span aria-hidden="true">→</span></a></section><footer class="landing-footer"><p class="landing-credit">self-hosted with ❤️ using <a class="external-link" href="${CONTEXT_USE_URL}" target="_blank" rel="noopener noreferrer" title="External link (opens in a new tab)">context-use</a>.</p><p class="landing-utilities">A self-hostable knowledge base that stays private until I choose otherwise. <a href="/llms.txt" type="text/plain">AI-readable site index</a>.</p></footer></main></body></html>`;
}

export const publicPageStyles = `body{margin:0;background:#f7f7f4;color:#20201d;font:17px/1.65 ui-serif,Georgia,serif}.public-page{max-width:760px;margin:8vh auto;padding:0 24px}h1,h2,h3{line-height:1.2}.public-page article :is(h1,h2,h3,h4,h5,h6)[id]{scroll-margin-top:1.5rem}a{color:#315a4a}.public-page article a,.context-use-footnote a{text-underline-offset:.16em}.external-link{text-decoration-style:dotted}.external-link::after{display:inline-block;margin-left:.16em;font:650 .68em/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;vertical-align:.25em;content:"↗"}.private-reference{color:#777;font-style:italic}pre{overflow:auto;padding:16px;background:#ecece7;border-radius:8px}img,video{max-width:100%;height:auto}video,audio{width:100%}.knowledge-navigation{margin-bottom:3rem;color:#858078;font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif}.knowledge-navigation ol{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem 0;margin:0;padding:0;list-style:none}.breadcrumb-separator{margin:0 .55rem;color:#aaa59d}.knowledge-navigation a{color:#64605a;text-decoration:none}.knowledge-navigation a:hover{text-decoration:underline}.knowledge-navigation [aria-current="page"]{color:#858078}.public-index-header{margin-bottom:2.5rem}.public-index-header h1{margin:0 0 .6rem;font-size:clamp(2.4rem,7vw,4.5rem);font-weight:500;letter-spacing:-.04em}.public-index-header span{color:#716d66;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}.public-index-list{margin:0;padding-left:1.7rem}.public-index-list li{padding:.32rem 0 .32rem .25rem}.public-index-list a{font-style:italic;text-decoration-style:dotted;text-underline-offset:.18em}.public-index-list span{margin-left:.35em}.context-use-footnote{margin-top:4rem;padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#7b7a73;font:12px/1.55 ui-sans-serif,system-ui,sans-serif}.context-use-footnote p{margin:0}.context-use-credit{color:#3f3f3a;font-size:15px}.context-use-credit a{font-weight:750}.context-use-footnote .context-use-utilities{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .6rem;margin-top:.45rem}.context-use-utilities a{color:#66665f;font-weight:550}.footer-separator{color:#aaa8a0}.public-landing{box-sizing:border-box;display:flex;flex-direction:column;max-width:1240px;min-height:100vh;margin:0 auto;padding:clamp(2rem,6vw,5.5rem)}.billboard{margin:auto 0}.landing-kicker{margin:0 0 1.25rem;color:#99602d;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase}.billboard h1{max-width:950px;margin:0;font-size:clamp(3.2rem,7.5vw,7rem);font-weight:500;letter-spacing:-.055em;line-height:.91}.landing-lede{max-width:650px;margin:2rem 0;color:#55554f;font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.5}.landing-cta{display:inline-flex;gap:.75rem;align-items:center;padding:.85rem 1.15rem;border:1px solid #20201d;border-radius:999px;color:#20201d;font:700 14px/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap}.landing-cta:hover{background:#20201d;color:#f7f7f4}.landing-footer{margin-top:clamp(3rem,8vw,7rem);padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#77766f;font:12px/1.55 ui-sans-serif,system-ui,sans-serif}.landing-footer p{margin:0}.landing-credit{color:#3f3f3a;font-size:15px}.landing-credit a{font-weight:750}.landing-footer .landing-utilities{margin-top:.45rem}.landing-utilities a{color:#66665f;font-weight:550}@media(max-width:800px){.public-landing{min-height:auto}.billboard{padding:8vh 0 2vh}.public-page{margin:5vh auto}.public-index-list span{display:block;margin-left:0}}`;

export { IMAGE_LAYOUT_STYLES };
