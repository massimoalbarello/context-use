const CONTEXT_USE_URL = "https://github.com/massimoalbarello/context-use";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPublicPageDocument(
  title: string,
  content: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-page"><article>${content}</article><footer class="context-use-footnote"><p>Hosted with <span class="context-use-heart" aria-label="love">♥</span> using <a href="${CONTEXT_USE_URL}">context-use</a>.</p><p>Self-hostable · private by default.</p></footer></main></body></html>`;
}

export function renderPublicLandingDocument(publicMcpEndpoint: string): string {
  const mcpEndpoint = escapeHtml(publicMcpEndpoint);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>My public context</title><link rel="stylesheet" href="/public.css"></head><body><main class="public-landing"><section class="billboard"><p class="landing-kicker">My public context</p><h1>A public billboard<br>for people and agents.</h1><p class="landing-lede">This is the front door to what I choose to share—who I am, what I’m thinking about, and what I’m building.</p><a class="landing-cta" href="/p/about">Explore my knowledge base <span aria-hidden="true">→</span></a></section><section class="agent-card"><div><p class="landing-kicker">Agents welcome</p><h2>Read the same context over MCP.</h2><p>No account or API key required.</p></div><code class="landing-endpoint">${mcpEndpoint}</code><p>Want to start a conversation? Call <code>send_message</code> with a message and an email or phone number. It lands in my private inbox.</p></section><footer class="landing-footer">I publish this with <a href="${CONTEXT_USE_URL}">context-use</a>, a self-hostable knowledge base that stays private until I choose otherwise.</footer></main></body></html>`;
}

export const publicPageStyles = `body{margin:0;background:#f7f7f4;color:#20201d;font:17px/1.65 ui-serif,Georgia,serif}.public-page{max-width:760px;margin:8vh auto;padding:0 24px}h1,h2,h3{line-height:1.2}a{color:#315a4a}.private-reference{color:#777;font-style:italic}pre{overflow:auto;padding:16px;background:#ecece7;border-radius:8px}img,video{max-width:100%;height:auto}video,audio{width:100%}.context-use-footnote{margin-top:4rem;padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#66665f;font:13px/1.55 ui-sans-serif,system-ui,sans-serif}.context-use-footnote p{margin:.3rem 0}.context-use-footnote a{font-weight:600}.context-use-heart{color:#a33b4b}.public-landing{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:clamp(2rem,7vw,7rem);max-width:1240px;min-height:100vh;margin:0 auto;padding:clamp(2rem,6vw,5.5rem)}.billboard{align-self:center}.landing-kicker{margin:0 0 1.25rem;color:#99602d;font:700 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase}.billboard h1{max-width:850px;margin:0;font-size:clamp(3.2rem,7.5vw,7rem);font-weight:500;letter-spacing:-.055em;line-height:.91}.landing-lede{max-width:650px;margin:2rem 0;color:#55554f;font-size:clamp(1.15rem,2vw,1.5rem);line-height:1.5}.landing-cta{display:inline-flex;gap:.75rem;align-items:center;padding:.85rem 1.15rem;border:1px solid #20201d;border-radius:999px;color:#20201d;font:700 14px/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;white-space:nowrap}.landing-cta:hover{background:#20201d;color:#f7f7f4}.agent-card{align-self:center;padding:clamp(1.5rem,3vw,2.5rem);border-radius:20px;background:#20201d;color:#e9e9e2;font:15px/1.55 ui-sans-serif,system-ui,sans-serif;box-shadow:0 24px 70px rgba(32,32,29,.18)}.agent-card .landing-kicker{color:#d9a46d}.agent-card h2{margin:0 0 .65rem;color:#fff;font:600 clamp(1.6rem,3vw,2.3rem)/1.1 ui-serif,Georgia,serif}.agent-card p{color:#bdbdb4}.agent-card code{color:#fff}.landing-endpoint{display:block;margin:2rem 0;padding:1rem;border:1px solid #484842;border-radius:10px;background:#161614;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.landing-footer{grid-column:1/-1;align-self:end;padding-top:1.25rem;border-top:1px solid #d9d9d2;color:#66665f;font:13px/1.55 ui-sans-serif,system-ui,sans-serif}.landing-footer a{font-weight:700}@media(max-width:800px){.public-landing{grid-template-columns:1fr;min-height:auto}.billboard{padding:8vh 0 2vh}.agent-card{align-self:auto}.landing-footer{margin-top:1rem}}`;
