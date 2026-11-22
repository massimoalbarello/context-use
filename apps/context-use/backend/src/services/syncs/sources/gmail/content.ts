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
function rewriteMedia(input: { document: EmailDocument; attachments: Attachment[] }) {
  const linked = new Set<Attachment>();
  for (const image of input.document.querySelectorAll('img')) {
    const cid = cidReference(image.getAttribute('src'));
    const asset = input.attachments.find((item) => item.contentId && item.contentId === cid);
    if (asset) {
      linked.add(asset);
      image.setAttribute('src', asset.file);
    } else {
      // External images often track opens; retain meaningful alternative text without fetching.
      image.replaceWith(input.document.createTextNode(image.getAttribute('alt') ?? ''));
    }
  }
  for (const link of input.document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    const cid = cidReference(href);
    const asset = cid && input.attachments.find((item) => item.contentId === cid);
    if (asset) {
      linked.add(asset);
      link.setAttribute('href', asset.file);
    } else if (!/^(?:https?:|mailto:)/i.test(href ?? '')) {
      link.replaceWith(...link.childNodes);
    }
  }
  return linked;
}
function htmlMarkdown(input: { html: string; attachments: Attachment[] }) {
  const { document } = parseHTML(`<html><body>${input.html}</body></html>`);
  const { discardedContentIds, signatureText } = cleanEmailHtml(document);
  flattenLayoutTables(document);
  for (const quote of document.querySelectorAll('.gmail_quote,.yahoo_quoted,.protonmail_quote')) {
    const block = document.createElement('blockquote');
    block.append(...quote.childNodes);
    quote.replaceWith(block);
  }
  const linked = rewriteMedia({ document, attachments: input.attachments });
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
    discardedContentIds,
    signatureText,
    linked,
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

export function readableBody(input: {
  html: string;
  plain: string;
  attachments: Attachment[];
  previous: string[];
}) {
  const html = input.html.trim() ? htmlMarkdown(input) : undefined;
  const discardedContentIds = html?.discardedContentIds ?? new Set<string>();
  const plain = withoutSignature(input.plain);
  const fallback =
    html?.signatureText && quoteKey(html.signatureText) === quoteKey(plain) ? '' : plain;
  const converted =
    (html && withoutSignature(html.markdown)) ||
    fallback
      .split('\n')
      .map((line) => {
        const prefix = /^[ \t]*(?:>[ \t]*)+/.exec(line)?.[0] ?? '';
        return prefix + markdownText(line.slice(prefix.length));
      })
      .join('\n');
  const markdown = converted.replace(forwardedEnvelope, 'Forwarded from $1 · $5');
  const body = withoutThreadHistory({ markdown, previous: input.previous });
  if (html?.linked.size && body !== markdown.trim()) {
    const kept = new Set(markdownLinks(fromMarkdown(body)).map(({ target }) => target.url));
    for (const asset of html.linked) {
      if (!kept.has(asset.file)) {
        discardedContentIds.add(asset.contentId);
      }
    }
  }
  return { body, original: markdown, discardedContentIds };
}
