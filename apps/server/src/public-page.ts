import { IMAGE_LAYOUT_STYLES } from "@context-use/shared";
import { INTRO_PATH, introductionName, publicSiteName } from "./public-discovery.ts";

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

type Introduction = {
  title: string;
  summary: string;
} | null;

type PublicDocumentMetadata = {
  siteOrigin?: string | undefined;
  summary?: string | null | undefined;
  introduction?: Introduction | undefined;
  indexable?: boolean | undefined;
  canonicalPath?: string | undefined;
  profileLinks?: string[] | undefined;
};

function normalizedOrigin(value: string): string {
  return new URL(value).origin;
}

function absoluteUrl(siteOrigin: string, path: string): string {
  return new URL(path, `${normalizedOrigin(siteOrigin)}/`).href;
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function isoDate(value?: string | Date): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function renderDocumentMetadata(input: {
  title: string;
  description: string;
  canonicalPath: string;
  kind: "landing" | "index" | "page";
  publicPath?: string | undefined;
  lastEditedAt?: string | Date | undefined;
  metadata: PublicDocumentMetadata;
}): string {
  const siteOrigin = normalizedOrigin(input.metadata.siteOrigin ?? "http://localhost:3000");
  const canonicalUrl = absoluteUrl(siteOrigin, input.canonicalPath);
  const profileName = introductionName(input.metadata.introduction);
  const isProfile = input.publicPath === INTRO_PATH;
  const pageTitle = isProfile && profileName ? `${profileName} — Biography` : input.title;
  const siteName = publicSiteName(siteOrigin, input.metadata.introduction);
  const documentTitle = input.kind === "landing"
    ? siteName
    : isProfile
      ? pageTitle
      : `${pageTitle} | ${siteName}`;
  const websiteId = `${siteOrigin}/#website`;
  const pageId = `${canonicalUrl}#page`;
  const personId = `${absoluteUrl(siteOrigin, `/p/${INTRO_PATH}`)}#person`;
  const dateModified = isoDate(input.lastEditedAt);
  const graph: Record<string, unknown>[] = [{
    "@type": "WebSite",
    "@id": websiteId,
    url: `${siteOrigin}/`,
    name: siteName,
    description: input.kind === "landing" ? input.description : undefined,
    inLanguage: "en",
    ...(profileName ? { about: { "@id": personId } } : {}),
  }];
  if (input.kind !== "landing") {
    graph.push({
      "@type": isProfile ? "ProfilePage" : input.kind === "index" ? "CollectionPage" : "WebPage",
      "@id": pageId,
      url: canonicalUrl,
      name: pageTitle,
      ...(input.kind === "page" ? { headline: pageTitle } : {}),
      description: input.description,
      inLanguage: "en",
      isPartOf: { "@id": websiteId },
      ...(dateModified ? { dateModified } : {}),
      ...(isProfile && profileName ? { mainEntity: { "@id": personId } } : {}),
    });
  }
  if (profileName && (input.kind === "landing" || isProfile)) {
    graph.push({
      "@type": "Person",
      "@id": personId,
      name: profileName,
      url: absoluteUrl(siteOrigin, `/p/${INTRO_PATH}`),
      description: input.metadata.introduction?.summary,
      ...(input.metadata.profileLinks?.length ? { sameAs: input.metadata.profileLinks } : {}),
    });
  }
  const robots = input.metadata.indexable === false
    ? "noindex,nofollow"
    : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";
  const openGraphType = isProfile ? "profile" : input.kind === "page" ? "article" : "website";
  return [
    `<title>${escapeHtml(documentTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(input.description)}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    '<link rel="sitemap" type="application/xml" href="/sitemap.xml">',
    '<link rel="alternate" type="text/plain" href="/llms.txt" title="AI-readable site index">',
    `<meta property="og:type" content="${openGraphType}">`,
    `<meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(input.description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(pageTitle)}">`,
    `<meta name="twitter:description" content="${escapeHtml(input.description)}">`,
    `<script type="application/ld+json">${jsonForHtml({ "@context": "https://schema.org", "@graph": graph })}</script>`,
  ].join("");
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
  metadata: PublicDocumentMetadata = {},
): string {
  const navigation = publicPath === undefined ? "" : renderKnowledgeNavigation(publicPath, title);
  const markdownAlternate = publicPath === undefined
    ? ""
    : `<link rel="alternate" type="text/markdown" href="/p/${escapeHtml(publicPath)}.md" title="${escapeHtml(title)} as Markdown">`;
  const description = metadata.summary?.trim() || `Published knowledge from ${publicSiteName(metadata.siteOrigin ?? "http://localhost:3000", metadata.introduction)}.`;
  const profileName = publicPath === INTRO_PATH ? introductionName(metadata.introduction ?? { title, summary: description }) : null;
  const heading = profileName ?? title;
  const pageHeader = `<header class="public-page-header"><h1>${escapeHtml(heading)}</h1>${metadata.summary?.trim() ? `<p>${escapeHtml(metadata.summary.trim())}</p>` : ""}</header>`;
  const documentMetadata = renderDocumentMetadata({
    title,
    description,
    canonicalPath: metadata.canonicalPath ?? (publicPath === undefined ? "/" : `/p/${publicPath}`),
    kind: "page",
    publicPath,
    lastEditedAt,
    metadata,
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${documentMetadata}${markdownAlternate}<link rel="stylesheet" href="/public.css"><link rel="stylesheet" href="/content.css"></head><body><main class="public-page">${navigation}${pageHeader}<article>${content}</article>${renderFootnote(publicPath, lastEditedAt)}</main></body></html>`;
}

export function renderPublicIndexDocument(index: {
  path: string;
  title: string;
  summary?: string | null | undefined;
  default_page_path: string | null;
  entries: PublicIndexEntry[];
  siteOrigin?: string | undefined;
  introduction?: Introduction | undefined;
}): string {
  const title = index.title;
  const navigation = renderKnowledgeNavigation(index.path, title);
  const entries = index.entries.map((entry) => {
    const entryTitle = entry.title ?? humanizePath(entry.path);
    const description = entry.summary?.trim() || (entry.kind === "page" ? "Published page." : "Published folder.");
    const href = entry.kind === "page"
      ? publicPageHref(entry.path)!
      : publicPageHref(entry.default_page_path) ?? indexHref(entry.path);
    return `<li><a href="${href}">${escapeHtml(entryTitle)}</a><span>— ${escapeHtml(description)}</span></li>`;
  }).join("");
  const description = index.summary?.trim() || `${title}: browse the published knowledge in this section.`;
  const documentMetadata = renderDocumentMetadata({
    title,
    description,
    canonicalPath: index.path ? `/p/${index.path}/` : "/p/",
    kind: "index",
    metadata: { siteOrigin: index.siteOrigin, introduction: index.introduction },
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${documentMetadata}<link rel="stylesheet" href="/public.css"></head><body><main class="public-page public-index">${navigation}<header class="public-index-header"><h1>${escapeHtml(title)}</h1>${index.summary?.trim() ? `<p>${escapeHtml(index.summary.trim())}</p>` : ""}</header><ol class="public-index-list">${entries}</ol>${renderFootnote()}</main></body></html>`;
}

export function renderPublicLandingDocument(options: {
  siteOrigin?: string | undefined;
  introduction?: Introduction | undefined;
  profileLinks?: string[] | undefined;
} = {}): string {
  const profileName = introductionName(options.introduction);
  const description = options.introduction?.summary?.trim()
    || "The front door to who I am, what I’m thinking about, and what I’m building.";
  const heading = profileName
    ? `${escapeHtml(profileName)}’s public context.`
    : "A public billboard<br>for what I choose to share.";
  const primaryHref = `/p/${INTRO_PATH}`;
  const primaryLabel = options.introduction ? "Read my biography" : "Explore my knowledge base";
  const browseAll = options.introduction
    ? '<a class="landing-secondary" href="/p/">Browse all published knowledge</a>'
    : "";
  const documentMetadata = renderDocumentMetadata({
    title: profileName ? `${profileName} — Public knowledge` : "My public context",
    description,
    canonicalPath: "/",
    kind: "landing",
    metadata: {
      siteOrigin: options.siteOrigin,
      introduction: options.introduction,
      profileLinks: options.profileLinks,
    },
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">${documentMetadata}<link rel="stylesheet" href="/public.css"></head><body><main class="public-landing"><section class="billboard"><p class="landing-kicker">Public knowledge</p><h1>${heading}</h1><p class="landing-lede">${escapeHtml(description)}</p><div class="landing-actions"><a class="landing-cta" href="${primaryHref}">${primaryLabel} <span aria-hidden="true">→</span></a>${browseAll}</div></section><footer class="landing-footer"><p class="landing-credit">self-hosted with ❤️ using <a class="external-link" href="${CONTEXT_USE_URL}" target="_blank" rel="noopener noreferrer" title="External link (opens in a new tab)">context-use</a>.</p><p class="landing-utilities">A self-hostable knowledge base that stays private until I choose otherwise. <a href="/llms.txt" type="text/plain">AI-readable site index</a>.</p></footer></main></body></html>`;
}

export const publicPageStyles = `body{margin:0;background:#f7f7f4;color:#20201d;font:17px/1.65 ui-serif,Georgia,serif}.public-page{max-width:760px;margin:8vh auto;padding:0 24px}h1,h2,h3{line-height:1.2}.public-page-header{margin-bottom:2.75rem}.public-page-header h1{margin:0;font-size:clamp(2.6rem,7vw,4.75rem);font-weight:500;letter-spacing:-.04em}.public-page-header p,.public-index-header p{max-width:680px;margin:1rem 0 0;color:#66625c;font-size:1.08rem;line-height:1.55}.public-page article :is(h1,h2,h3,h4,h5,h6)[id]{scroll-margin-top:1.5rem}a{color:#315a4a}.public-page article a,.context-use-footnote a{text-underline-offset:.16em}.external-link{text-decoration-style:dotted}.external-link::after{display:inline-block;margin-left:.16em;font:650 .68em/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;vertical-align:.25em;content:"↗"}.private-reference{color:#777;font-style:italic}pre{overflow:auto;padding:16px;background:#ecece7;border-radius:8px}img,video{max-width:100%;height:auto}video,audio{width:100%}.knowledge-navigation{margin-bottom:3rem;color:#858078;font:600 13px/1.4 ui-sans-serif,system-ui,sans-serif}.knowledge-navigation ol{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem 0;margin:0;padding:0;list-style:none}.breadcrumb-separator{margin:0 .55rem;color:#aaa59d}.knowledge-navigation a{color:#64605a;text-decoration:none}.knowledge-navigation a:hover{text-decoration:underline}.knowledge-navigation [aria-current="page"]{color:#858078}.public-index-header{margin-bottom:2.5rem}.public-index-header h1{margin:0;font-size:clamp(2.4rem,7vw,4.5rem);font-weight:500;letter-spacing:-.04em}.public-index-list{margin:0;padding-left:1.7rem}.public-index-list li{padding:.32rem 0 .32rem .25rem}.public-index-list a{font-style:italic;text-decoration-style:dotted;text-underline-offset:.18em}.public-index-list span{margin-left:.35em}.context-use-footnote{margin-top:4rem;padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#7b7a73;font:12px/1.55 ui-sans-serif,system-ui,sans-serif}.context-use-footnote p{margin:0}.context-use-credit{color:#3f3f3a;font-size:15px}.context-use-credit a{font-weight:750}.context-use-footnote .context-use-utilities{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .6rem;margin-top:.45rem}.context-use-utilities a{color:#66665f;font-weight:550}.footer-separator{color:#aaa8a0}.public-landing{box-sizing:border-box;display:flex;flex-direction:column;max-width:1240px;min-height:100vh;margin:0 auto;padding:clamp(2rem,6vw,5.5rem)}.billboard{margin:auto 0}.landing-kicker{margin:0 0 1.25rem;color:#99602d;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase}.billboard h1{max-width:950px;margin:0;font-size:clamp(3.2rem,7.5vw,7rem);font-weight:500;letter-spacing:-.055em;line-height:.91}.landing-lede{max-width:650px;margin:2rem 0;color:#55554f;font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.5}.landing-actions{display:flex;flex-wrap:wrap;align-items:center;gap:1rem 1.25rem}.landing-cta{display:inline-flex;gap:.75rem;align-items:center;padding:.85rem 1.15rem;border:1px solid #20201d;border-radius:999px;color:#20201d;font:700 14px/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap}.landing-cta:hover{background:#20201d;color:#f7f7f4}.landing-secondary{color:#55554f;font:650 14px/1.4 ui-sans-serif,system-ui,sans-serif;text-underline-offset:.2em}.landing-footer{margin-top:clamp(3rem,8vw,7rem);padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#77766f;font:12px/1.55 ui-sans-serif,system-ui,sans-serif}.landing-footer p{margin:0}.landing-credit{color:#3f3f3a;font-size:15px}.landing-credit a{font-weight:750}.landing-footer .landing-utilities{margin-top:.45rem}.landing-utilities a{color:#66665f;font-weight:550}@media(max-width:800px){.public-landing{min-height:auto}.billboard{padding:8vh 0 2vh}.public-page{margin:5vh auto}.public-index-list span{display:block;margin-left:0}}`;

export { IMAGE_LAYOUT_STYLES };
