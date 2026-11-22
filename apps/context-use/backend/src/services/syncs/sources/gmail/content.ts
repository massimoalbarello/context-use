import { tables } from '@truto/turndown-plugin-gfm';
import EmailReplyParser from 'email-reply-parser';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import type { Attachment } from './mime.ts';

export function markdownText(value: string) {
  return new TurndownService()
    .escape(value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
    .replaceAll('\n', ' ');
}
const quotedText = (value: string) =>
  value
    .replace(/^\s*(?:>\s*)+/gm, '')
    .replace(/^\s*\|?[\s|:-]+\|?\s*$/gm, '')
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
  for (const table of [...document.querySelectorAll('table[role="presentation"]')].reverse()) {
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
function removePrevious(input: { document: EmailDocument; previous: string[] }) {
  const previous = input.previous.map(quotedText);
  const converter = new TurndownService();
  converter.use(tables);
  // Remove copies of preceding messages, preserving answers inserted inside quote containers.
  for (const quote of input.document.querySelectorAll(
    'blockquote,.gmail_quote,.yahoo_quoted,.protonmail_quote',
  )) {
    for (const element of [...quote.querySelectorAll('p,div,li'), quote].reverse()) {
      if (!element.isConnected) {
        continue;
      }
      const text = quotedText(converter.turndown(element.outerHTML));
      if (alreadyQuoted({ previous, text })) {
        element.remove();
      }
    }
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
function htmlMarkdown(input: { html: string; attachments: Attachment[]; previous: string[] }) {
  const { document } = parseHTML(`<html><body>${input.html}</body></html>`);
  removeHidden(document);
  flattenLayoutTables(document);
  removePrevious({ document, previous: input.previous });
  rewriteMedia({ document, attachments: input.attachments });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  converter.use(tables);
  converter.addRule('emailQuotes', {
    filter: 'blockquote',
    replacement: (content) => `\n\n${content}\n\n`,
  });
  converter.addRule('messageHeadings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    // biome-ignore lint/complexity/useMaxParams: Turndown supplies the content and DOM node.
    replacement: (content, node) =>
      `\n\n${'#'.repeat(Math.min(Number(node.nodeName.slice(1)) + 2, MAX_HEADING_LEVEL))} ${content}\n\n`,
  });
  return converter.turndown(document.body.innerHTML);
}
export function readableBody(input: {
  html: string;
  plain: string;
  attachments: Attachment[];
  previous: string[];
}) {
  const converter = new TurndownService();
  converter.use(tables);
  const markdown = input.html.trim()
    ? htmlMarkdown(input)
    : input.plain
        .split('\n')
        .map((line) =>
          /^\s*>/.test(line)
            ? line
            : converter.escape(
                line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
              ),
        )
        .join('\n');
  const previous = input.previous.map(quotedText);
  // Only remove quoted content already present in this conversation. Forwarded material and
  // fresh quotations still belong to their message, as do signatures and inline answers.
  const body = new EmailReplyParser()
    .read(markdown)
    .getFragments()
    .map((fragment) => {
      const content = fragment.getContent();
      if (!fragment.isQuoted() || !previous.length) {
        return content;
      }
      return content
        .split('\n')
        .filter((line) => {
          const text = quotedText(line);
          if (!text) {
            return true;
          }
          // The parser marks localized attribution lines as quoted, too.
          const attribution = !/^\s*>/.test(line) && text.endsWith(':');
          return !attribution && !alreadyQuoted({ previous, text });
        })
        .join('\n');
    })
    .join('\n')
    .trim();
  return { body, original: input.plain || converter.turndown(input.html) };
}
