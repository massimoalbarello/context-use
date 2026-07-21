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
};

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function humanizePath(path: string): string {
  const leaf = path.split("/").at(-1) ?? "knowledge";
  return leaf
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function indexHref(path: string): string {
  return path ? `/i/${path}` : "/i";
}

function renderKnowledgeNavigation(folderPath: string): string {
  const folder = folderPath
    ? `<span aria-hidden="true">/</span><a href="${indexHref(folderPath)}">${escapeHtml(humanizePath(folderPath))} index</a>`
    : "";
  return `<nav class="knowledge-navigation" aria-label="Knowledge navigation"><a href="/i">Knowledge index</a>${folder}</nav>`;
}

function renderFootnote(): string {
  return `<footer class="context-use-footnote"><p>self-hosted with ❤️ using <a href="${CONTEXT_USE_URL}">context-use</a>.</p></footer>`;
}

export function renderPublicPageDocument(
  title: string,
  content: string,
  publicPath?: string,
): string {
  const navigation = publicPath === undefined ? "" : renderKnowledgeNavigation(parentPath(publicPath));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/public.css"><link rel="stylesheet" href="/content.css"></head><body><main class="public-page">${navigation}<article>${content}</article>${renderFootnote()}</main></body></html>`;
}

export function renderPublicIndexDocument(index: { path: string; entries: PublicIndexEntry[] }): string {
  const title = index.path ? `${humanizePath(index.path)} index` : "Knowledge index";
  const parent = parentPath(index.path);
  const navigation = index.path ? renderKnowledgeNavigation(parent) : "";
  const entries = index.entries.map((entry) => {
    const entryTitle = entry.kind === "page" ? entry.title ?? humanizePath(entry.path) : humanizePath(entry.path);
    const description = entry.kind === "page"
      ? entry.summary ?? "Published page."
      : `${entry.published_count} published page${entry.published_count === 1 ? "" : "s"}.`;
    const href = entry.kind === "page" ? `/p/${entry.path}` : indexHref(entry.path);
    return `<li><a href="${href}">${escapeHtml(entryTitle)}</a><span>— ${escapeHtml(description)}</span></li>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-page public-index">${navigation}<header class="public-index-header"><p>Generated index</p><h1>${escapeHtml(title)}</h1><span>Only explicitly published knowledge appears here.</span></header><ol class="public-index-list">${entries}</ol>${renderFootnote()}</main></body></html>`;
}

export function renderPublicLandingDocument(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My public context</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-landing"><section class="billboard"><p class="landing-kicker">My public context</p><h1>A public billboard<br>for what I choose to share.</h1><p class="landing-lede">This is the front door to who I am, what I’m thinking about, and what I’m building.</p><a class="landing-cta" href="/p/about/intro">Explore my knowledge base <span aria-hidden="true">→</span></a></section><footer class="landing-footer">I publish this with <a href="${CONTEXT_USE_URL}">context-use</a>, a self-hostable knowledge base that stays private until I choose otherwise.</footer></main></body></html>`;
}

export const publicPageStyles = `body{margin:0;background:#f7f7f4;color:#20201d;font:17px/1.65 ui-serif,Georgia,serif}.public-page{max-width:760px;margin:8vh auto;padding:0 24px}h1,h2,h3{line-height:1.2}a{color:#315a4a}.private-reference{color:#777;font-style:italic}pre{overflow:auto;padding:16px;background:#ecece7;border-radius:8px}img,video{max-width:100%;height:auto}video,audio{width:100%}.knowledge-navigation{display:flex;align-items:center;gap:.55rem;margin-bottom:3rem;color:#858078;font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif}.knowledge-navigation a{color:#64605a;text-decoration:none}.knowledge-navigation a:hover{text-decoration:underline}.public-index-header{margin-bottom:2.5rem}.public-index-header p{margin:0 0 .65rem;color:#99602d;font:700 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase}.public-index-header h1{margin:0 0 .6rem;font-size:clamp(2.4rem,7vw,4.5rem);font-weight:500;letter-spacing:-.04em}.public-index-header span{color:#716d66;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}.public-index-list{margin:0;padding-left:1.7rem}.public-index-list li{padding:.32rem 0 .32rem .25rem}.public-index-list a{font-style:italic;text-decoration-style:dotted;text-underline-offset:.18em}.public-index-list span{margin-left:.35em}.context-use-footnote{margin-top:4rem;padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#66665f;font:13px/1.55 ui-sans-serif,system-ui,sans-serif}.context-use-footnote p{margin:.3rem 0}.context-use-footnote a{font-weight:600}.public-landing{box-sizing:border-box;display:flex;flex-direction:column;max-width:1240px;min-height:100vh;margin:0 auto;padding:clamp(2rem,6vw,5.5rem)}.billboard{margin:auto 0}.landing-kicker{margin:0 0 1.25rem;color:#99602d;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase}.billboard h1{max-width:950px;margin:0;font-size:clamp(3.2rem,7.5vw,7rem);font-weight:500;letter-spacing:-.055em;line-height:.91}.landing-lede{max-width:650px;margin:2rem 0;color:#55554f;font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.5}.landing-cta{display:inline-flex;gap:.75rem;align-items:center;padding:.85rem 1.15rem;border:1px solid #20201d;border-radius:999px;color:#20201d;font:700 14px/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap}.landing-cta:hover{background:#20201d;color:#f7f7f4}.landing-footer{margin-top:clamp(3rem,8vw,7rem);padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#66665f;font:13px/1.55 ui-sans-serif,system-ui,sans-serif}.landing-footer a{font-weight:700}@media(max-width:800px){.public-landing{min-height:auto}.billboard{padding:8vh 0 2vh}.public-page{margin:5vh auto}.public-index-list span{display:block;margin-left:0}}`;

export { IMAGE_LAYOUT_STYLES };
