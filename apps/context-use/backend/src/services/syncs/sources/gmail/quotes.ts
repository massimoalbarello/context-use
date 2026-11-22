import EmailReplyParser from 'email-reply-parser';

// Replied-to HTML can be rewrapped, restyled, or carry new MIME IDs for the same inline images.
export function quoteKey(value: string) {
  return value
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
    .replace(/open-sync-asset:[\w-]+/g, 'inline-asset')
    .replace(/^[ \t]*\|?[\s|:-]+\|?[ \t]*$/gm, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/[*_`#|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mail clients also add links to ordinary text (for example, a street address).
function linkLabels(markdown: string) {
  return markdown.replace(/\[([^\]]+)\]\((?:https?:|mailto:)[^\s)]*\)/gi, '$1');
}
type PreviousBody = { markdown: string; text: string };

const attribution = /^(?:Forwarded from .+ · .+|On .+ wrote:|Il giorno .+ ha scritto:)$/im;
const historySection = new RegExp(`(?=${attribution.source})`, attribution.flags);
const envelopeField = /^(?:From|Da|To|A|Cc|Sent|Inviato|Subject|Oggetto):\s/i;
const quotedLine = /^[ \t]*>/;

function pruneQuote(input: { content: string; previous: PreviousBody[] }) {
  let inEnvelope = false;
  const lines = input.content.split('\n').map((line) => {
    const key = quoteKey(line);
    if (key) {
      inEnvelope = /^(?:From|Da):\s/i.test(key) || (inEnvelope && envelopeField.test(key));
    }
    const text = linkLabels(key);
    const repeated =
      Boolean(key) &&
      input.previous.some(
        (earlier) =>
          earlier.markdown.includes(` ${key} `) ||
          (key === text ? earlier.text : earlier.markdown).includes(` ${text} `),
      );
    return {
      line,
      key,
      repeated,
      metadata: inEnvelope || attribution.test(key),
      media: line.includes('open-sync-asset:'),
    };
  });
  // Different screenshots can share an empty alt label. Require surrounding copied text.
  const copiedText = lines.some((item) => item.repeated && !item.media && !item.metadata);
  const retained = lines.filter((item) => !item.repeated || (item.media && !copiedText));
  if (retained.length === lines.length) {
    return input.content;
  }
  const text = retained.filter((item) => !item.metadata);
  return text.some(({ key }) => key)
    ? text
        .map(({ line }) => line)
        .join('\n')
        .trim()
    : '';
}

function cleanSection(input: { section: string; previous: PreviousBody[] }) {
  const lines = input.section.trim().split('\n');
  const heading = attribution.test(lines[0]!) ? lines.shift() : undefined;
  const text = lines.join('\n').trim();
  if (heading && !quotedLine.test(text)) {
    // Outlook and some plaintext clients append a complete earlier email without quote markers.
    const remainder = pruneQuote({ content: text, previous: input.previous });
    return remainder ? `${heading}\n\n${remainder}` : '';
  }
  if (!/^[ \t]*>/m.test(text)) {
    return input.section.trim();
  }
  const parts = new EmailReplyParser()
    .read(text)
    .getFragments()
    .map((fragment) => {
      const original = fragment.getContent();
      const kept = fragment.isQuoted()
        ? pruneQuote({ content: original, previous: input.previous })
        : original;
      return { kept, changed: kept !== original };
    });
  if (!parts.some((part) => part.changed)) {
    return input.section.trim();
  }
  const body = parts
    .map((part) => part.kept)
    .join('\n')
    .trim();
  return heading && parts[0]?.kept.trim() ? `${heading}\n\n${body}` : body;
}

export function withoutThreadHistory(input: { markdown: string; previous: string[] }) {
  if (
    !input.previous.length ||
    (!/^[ \t]*>/m.test(input.markdown) && !attribution.test(input.markdown))
  ) {
    return input.markdown.trim();
  }
  const previous = input.previous.map((message) => {
    const markdown = ` ${quoteKey(message)} `;
    return { markdown, text: linkLabels(markdown) };
  });
  return input.markdown
    .split(historySection)
    .map((section) => cleanSection({ section, previous }))
    .filter(Boolean)
    .join('\n\n');
}
