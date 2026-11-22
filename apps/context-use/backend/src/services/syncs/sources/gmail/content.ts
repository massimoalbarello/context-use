import { tables } from '@truto/turndown-plugin-gfm';
import { parseHTML } from 'linkedom';
import { fromMarkdown } from 'mdast-util-from-markdown';
import TurndownService from 'turndown';
import { markdownLinks } from '#backend/models/markdown/links.ts';
import { cidReference, cleanEmailHtml, withoutSignature } from './cleanup.ts';
import { quoteKey, withoutThreadHistory } from './quotes.ts';

export type Attachment = { name: string; file: string; contentId: string };

const textConverter = new TurndownService();
export function markdownText(value: string) {
  return textConverter
    .escape(value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    .replaceAll('\n', ' ');
}
type EmailDocument = ReturnType<typeof parseHTML>['document'];
const MAX_HEADING_LEVEL = 6;

function flattenLayoutTables(document: EmailDocument) {
  for (const table of document.querySelectorAll('table')) {
    // Newsletter templates often use unmarked, nested tables or rows of spacer cells.
    if (!table.matches('[role="presentation"],[role="none"]') && !table.querySelector('table')) {
      const dataRows = [...table.querySelectorAll('tr')].filter(
        (row) =>
          [...row.children].filter((cell) => cell.matches('th,td') && cell.textContent?.trim())
            .length >= 2,
      );
      if (dataRows.length >= 2) {
        continue;
      }
    }
    const content = document.createElement('div');
    for (const cell of table.querySelectorAll('caption,td,th')) {
      if (cell.closest('table') === table) {
        const block = document.createElement('div');
        block.append(...cell.childNodes);
        content.append(block);
      }
    }
    table.replaceWith(content);
  }
}
function decorativeLink(input: { link: Element; descriptive: boolean }) {
  return (
    !cidReference(input.link.getAttribute('href')) &&
    !input.link.textContent?.trim() &&
    input.link.querySelectorAll('img').length === 1 &&
    (!input.descriptive || URL.parse(input.link.getAttribute('href') ?? '')?.pathname === '/')
  );
}
function imageAlt(image: Element) {
  const alt = image.getAttribute('alt')?.trim() ?? '';
  return !/\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(alt) &&
    !/^(?:image|photo|picture|immagine)(?:\s*\d+)?$|\b(?:logo|banner|spacer|signature)\b/i.test(alt)
    ? alt
    : '';
}
function rewriteImages(input: { document: EmailDocument; byCid: Map<string, Attachment> }) {
  const images = [...input.document.querySelectorAll('img')];
  const photoOnly = images.length === 1 && !input.document.body.textContent?.trim();
  for (const image of images) {
    const cid = cidReference(image.getAttribute('src'));
    const asset = input.byCid.get(cid);
    const alt = imageAlt(image);
    const anchor = image.closest('a[href]');
    // Template art often has an empty alt, the original filename, or the company's homepage.
    const descriptive = Boolean(alt);
    const photo =
      photoOnly &&
      !/^(?:image\d*|logo|banner|signature|Attachment [\d.]+)\b/i.test(asset?.name ?? '');
    if (asset && (descriptive || photo) && !anchor) {
      image.setAttribute('src', asset.file);
    } else if (anchor && decorativeLink({ link: anchor, descriptive })) {
      anchor.remove();
    } else {
      image.replaceWith(input.document.createTextNode(alt));
    }
  }
}
function rewriteLinks(input: { document: EmailDocument; byCid: Map<string, Attachment> }) {
  for (const link of input.document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    const cid = cidReference(href);
    const asset = input.byCid.get(cid);
    if (asset) {
      link.setAttribute('href', asset.file);
      if (!link.textContent?.trim()) {
        link.textContent = asset.name;
      }
    } else if (!/^(?:https?:|mailto:)/i.test(href ?? '')) {
      link.replaceWith(...link.childNodes);
    }
  }
}
function htmlMarkdown(input: { html: string; attachments: Attachment[] }) {
  const { document } = parseHTML(`<html><body>${input.html}</body></html>`);
  const { referencedContentIds, signatureText } = cleanEmailHtml(document);
  flattenLayoutTables(document);
  for (const quote of document.querySelectorAll('.gmail_quote,.yahoo_quoted,.protonmail_quote')) {
    const block = document.createElement('blockquote');
    block.append(...quote.childNodes);
    quote.replaceWith(block);
  }
  const byCid = new Map(
    input.attachments.filter((asset) => asset.contentId).map((asset) => [asset.contentId, asset]),
  );
  rewriteImages({ document, byCid });
  rewriteLinks({ document, byCid });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  converter.use(tables);
  converter.addRule('messageHeadings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    // biome-ignore lint/complexity/useMaxParams: Turndown supplies the content and DOM node.
    replacement: (content, node) =>
      `\n\n${'#'.repeat(Math.min(Number(node.nodeName.slice(1)) + 2, MAX_HEADING_LEVEL))} ${content}\n\n`,
  });
  return {
    markdown: converter.turndown(document.body.innerHTML),
    referencedContentIds,
    signatureText,
  };
}
// Outlook embeds these envelope fields as prose in forwarded messages.
function forwardedField(labels: string) {
  return String.raw`(?:\*\*)?(?:${labels})(?:\*\*)?:(?:\*\*)?[ \t]*([^\n]+)`;
}
const forwardedEnvelope = new RegExp(
  '^' +
    [
      forwardedField('From|Da'),
      forwardedField('Sent|Date|Inviato|Data'),
      forwardedField('To|A'),
      `(?:${forwardedField('Cc')}\\n+)?${forwardedField('Subject|Oggetto')}`,
    ].join('\\n+'),
  'gim',
);

function extractBodyAssets(input: { markdown: string; attachments: Attachment[] }) {
  const bodyAssets = new Map<string, string>();
  let body = input.markdown;
  if (input.markdown.includes('open-sync-asset:')) {
    // Identify inline files in the surviving text before moving their links into the message header.
    const byFile = new Map(input.attachments.map((asset) => [asset.file, asset]));
    for (const { node, target } of markdownLinks(fromMarkdown(input.markdown)).reverse()) {
      const asset = byFile.get(target.url);
      if (!asset || !node.position) {
        continue;
      }
      const label =
        node.type === 'link' && node.children.length
          ? input.markdown.slice(
              node.children[0]?.position?.start.offset,
              node.children.at(-1)?.position?.end.offset,
            )
          : '';
      bodyAssets.set(asset.contentId, node.type === 'image' ? node.alt || asset.name : asset.name);
      body =
        body.slice(0, node.position.start.offset) + label + body.slice(node.position.end.offset);
    }
  }
  return { body, bodyAssets };
}

export function readableBody(input: {
  html: string;
  plain: string;
  attachments: Attachment[];
  previous: string[];
}) {
  const html = input.html.trim() ? htmlMarkdown(input) : undefined;
  const plain = input.plain.replaceAll('\r\n', '\n');
  const fallback =
    html?.signatureText && quoteKey(html.signatureText) === quoteKey(plain) ? '' : plain;
  const converted =
    html?.markdown ||
    fallback
      .split('\n')
      .map((line) => {
        const prefix = /^[ \t]*(?:>[ \t]*)+/.exec(line)?.[0] ?? '';
        return prefix + markdownText(line.slice(prefix.length));
      })
      .join('\n');
  const envelopes = Array.from(
    converted.matchAll(forwardedEnvelope),
    (match) => `Forwarded from ${match[1]} · ${match[5]}`,
  );
  const original = converted.replace(forwardedEnvelope, 'Forwarded from $1 · $5');
  const unique = withoutThreadHistory({ markdown: original, previous: input.previous });
  const cleaned = withoutSignature(unique)
    .split('\n')
    .filter((line) => !envelopes.includes(line.trim()))
    .join('\n');
  const referencedContentIds = html?.referencedContentIds ?? new Set<string>();
  const { body, bodyAssets } = extractBodyAssets({
    markdown: cleaned,
    attachments: input.attachments,
  });
  return {
    body: body
      .replace(/^([ \t]*>[ \t]*)+$/gm, '')
      .replace(/^\**(?:\\_){4,}\**$/gm, '')
      .replace(/\n[ \t\u00a0]*\n(?:[ \t\u00a0]*\n)+/g, '\n\n')
      .trim(),
    original,
    referencedContentIds,
    bodyAssets,
  };
}
