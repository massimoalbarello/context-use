import { tables } from '@truto/turndown-plugin-gfm';
import EmailReplyParser from 'email-reply-parser';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import type { Attachment } from './mime.ts';

const textConverter = new TurndownService();
export function markdownText(value: string) {
  return textConverter
    .escape(value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    .replaceAll('\n', ' ');
}
const quotedText = (value: string) =>
  value
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*\|?[\s|:-]+\|?\s*$/gm, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/[*_`#|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
function alreadyQuoted(input: { previous: string[]; text: string }) {
  return (
    input.text.length > 0 && input.previous.some((body) => ` ${body} `.includes(` ${input.text} `))
  );
}
type EmailDocument = ReturnType<typeof parseHTML>['document'];
const MAX_HEADING_LEVEL = 6;

function removeHidden(document: EmailDocument) {
  for (const element of document.querySelectorAll(
    'script,style,head,meta,link,title,iframe,object,form,svg,.gmail_attr,#divRplyFwdMsg',
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll('[hidden],[aria-hidden="true"],[style]')) {
    if (
      element.hasAttribute('hidden') ||
      element.getAttribute('aria-hidden') === 'true' ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)/i.test(
        element.getAttribute('style') ?? '',
      )
    ) {
      element.remove();
    }
  }
}
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
  for (const image of input.document.querySelectorAll('img')) {
    const cid = image.getAttribute('src')?.replace(/^cid:/i, '');
    const asset = input.attachments.find((item) => item.contentId && item.contentId === cid);
    if (asset) {
      image.setAttribute('src', asset.file);
    } else {
      // External images often track opens; retain meaningful alternative text without fetching.
      image.replaceWith(input.document.createTextNode(image.getAttribute('alt') ?? ''));
    }
  }
  for (const link of input.document.querySelectorAll('a[href]')) {
    if (!/^(?:https?:|mailto:)/i.test(link.getAttribute('href') ?? '')) {
      link.replaceWith(...link.childNodes);
    }
  }
}
function htmlMarkdown(input: { html: string; attachments: Attachment[] }) {
  const { document } = parseHTML(`<html><body>${input.html}</body></html>`);
  removeHidden(document);
  flattenLayoutTables(document);
  for (const quote of document.querySelectorAll('.gmail_quote,.yahoo_quoted,.protonmail_quote')) {
    const block = document.createElement('blockquote');
    block.append(...quote.childNodes);
    quote.replaceWith(block);
  }
  rewriteMedia({ document, attachments: input.attachments });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  converter.use(tables);
  converter.addRule('messageHeadings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    // biome-ignore lint/complexity/useMaxParams: Turndown supplies the content and DOM node.
    replacement: (content, node) =>
      `\n\n${'#'.repeat(Math.min(Number(node.nodeName.slice(1)) + 2, MAX_HEADING_LEVEL))} ${content}\n\n`,
  });
  return converter.turndown(document.body.innerHTML);
}
// Outlook embeds these envelope fields as prose in forwarded messages.
function forwardedField(labels: string) {
  return String.raw`(?:\*\*)?(?:${labels})(?:\*\*)?:(?:\*\*)?[ \t]*([^\n]+)`;
}
const forwardedEnvelope = new RegExp(
  '^' +
    [
      forwardedField('From|Da'),
      forwardedField('Sent|Inviato'),
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
  const html = input.html.trim() && htmlMarkdown(input);
  const converted =
    html ||
    input.plain
      .split('\n')
      .map((line) => {
        const prefix = /^[ \t]*(?:>[ \t]*)+/.exec(line)?.[0] ?? '';
        return prefix + markdownText(line.slice(prefix.length));
      })
      .join('\n');
  const markdown = converted.replace(forwardedEnvelope, 'Forwarded from $1 · $5');
  if (!input.previous.length || !/^\s*>/m.test(markdown)) {
    return { body: markdown.trim(), original: input.plain || markdown };
  }
  const previous = input.previous.map(quotedText);
  // Only remove quoted content already present in this conversation. Forwarded material and
  // fresh quotations still belong to their message, as do signatures and inline answers.
  const body = new EmailReplyParser()
    .read(markdown)
    .getFragments()
    .map((fragment) => {
      const content = fragment.getContent();
      if (!fragment.isQuoted()) {
        return content;
      }
      const lines = content.split('\n');
      const kept = lines.filter((line) => !alreadyQuoted({ previous, text: quotedText(line) }));
      if (kept.length === lines.length) {
        return content;
      }
      // The parser groups the attribution with the quoted lines it introduces.
      const quote = kept.filter((line) => /^\s*>/.test(line) || !line.trimEnd().endsWith(':'));
      return quote.some((line) => quotedText(line)) ? quote.join('\n') : '';
    })
    .join('\n')
    .trim();
  return { body, original: input.plain || markdown };
}
