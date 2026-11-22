import type { parseHTML } from 'linkedom';

type EmailDocument = ReturnType<typeof parseHTML>['document'];

// These wrappers identify the signature itself, including in forwarded HTML.
const signatureSelector =
  '.gmail_signature,[data-smartmail="gmail_signature"],.moz-signature,.MsoAutoSig,#Signature,#x_Signature,#AppleMailSignature,.AppleMailSignature,.protonmail_signature_block';

export function cidReference(value: string | null) {
  return value?.trim().match(/^cid:(.+)$/i)?.[1];
}
function inlineContentIds(document: EmailDocument) {
  const ids = new Set<string>();
  for (const element of document.querySelectorAll('img[src],a[href]')) {
    const id = cidReference(element.getAttribute(element.localName === 'img' ? 'src' : 'href'));
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function brandingLink(input: { href: string; alt: string }) {
  const url = URL.parse(input.href);
  if (!url || !/^https?:$/.test(url.protocol)) {
    return false;
  }
  if (url.pathname === '/' && /\blogo\b/i.test(input.alt)) {
    return true;
  }
  const host = url.hostname.replace(/^www\./i, '');
  const profile =
    host === 'linkedin.com'
      ? /^\/(?:in|company)\/[^/]+\/?$/.test(url.pathname)
      : /^(?:facebook|instagram|twitter|x)\.com$/.test(host) && /^\/[\w.-]+\/?$/.test(url.pathname);
  return (
    profile &&
    (!input.alt.trim() ||
      /^(?:(?:follow us on|visit us on)\s+)?(?:facebook|instagram|linkedin|twitter|x)(?:\s+(?:logo|icon))?$/i.test(
        input.alt.trim(),
      ))
  );
}

// Some templates label a row of profile icons with the platform followed by the same company name.
function socialIcon(link: Element) {
  const image = link.querySelector('img');
  const label = /^(facebook|instagram|youtube|linkedin|twitter|x)\s+(.+)$/i.exec(
    image?.getAttribute('alt')?.trim() ?? '',
  );
  const url = URL.parse(link.getAttribute('href') ?? '');
  if (
    !label ||
    !url ||
    !/^https?:$/.test(url.protocol) ||
    link.textContent?.trim() ||
    link.querySelectorAll('img').length !== 1
  ) {
    return;
  }
  const network = label[1]!.toLowerCase();
  if (url.hostname.replace(/^www\./, '') === `${network}.com`) {
    return { network, brand: label[2]!.toLowerCase() };
  }
}
function removeSocialIconRows(document: EmailDocument) {
  const rows = new Map<Element, { link: Element; network: string; brand: string }[]>();
  for (const link of document.querySelectorAll('a[href]')) {
    const icon = socialIcon(link);
    const row = link.closest('p,td,li,div');
    if (icon && row) {
      const icons = rows.get(row) ?? [];
      icons.push({ link, ...icon });
      rows.set(row, icons);
    }
  }
  for (const [row, icons] of rows) {
    if (row.textContent?.trim()) {
      continue;
    }
    for (const icon of icons) {
      if (icons.some((other) => other.brand === icon.brand && other.network !== icon.network)) {
        icon.link.remove();
      }
    }
  }
}

function removeDecorativeImages(document: EmailDocument) {
  for (const image of document.querySelectorAll('img')) {
    const tiny = (dimension: 'width' | 'height') =>
      /^(?:0|1)(?:px)?$/i.test(
        image.style[dimension]?.trim() || image.getAttribute(dimension)?.trim() || '',
      );
    if ((tiny('width') && tiny('height')) || image.matches('[role="presentation"][alt=""]')) {
      image.remove();
      continue;
    }
    const link = image.closest('a[href]');
    if (
      link &&
      !link.textContent?.trim() &&
      link.querySelectorAll('img').length === 1 &&
      brandingLink({ href: link.getAttribute('href') ?? '', alt: image.getAttribute('alt') ?? '' })
    ) {
      link.remove();
    }
  }
}

function removeHidden(document: EmailDocument) {
  for (const element of document.querySelectorAll(
    'script,style,head,meta,link,title,iframe,object,form,svg,.gmail_attr',
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

export function cleanEmailHtml(document: EmailDocument) {
  const discardedContentIds = inlineContentIds(document);
  const signatures = [...document.querySelectorAll<HTMLElement>(signatureSelector)];
  const signatureText = signatures.map((signature) => signature.innerText).join(' ');
  for (const signature of signatures) {
    signature.remove();
  }
  removeHidden(document);
  removeSocialIconRows(document);
  removeDecorativeImages(document);
  for (const id of inlineContentIds(document)) {
    discardedContentIds.delete(id);
  }
  return { discardedContentIds, signatureText };
}

// A conventional signature can precede a reply, forward or postscript in the same MIME part.
const nextSection =
  /(?=^(?:[ \t]*>|On .+ wrote:|From:|Da:|Forwarded from |[- ]*(?:Forwarded message|Original Message|Messaggio inoltrato)[ -]*$|P\.?S\.?[:\s]))/im;
const shortSignOff =
  /(?:^|\n)[ \t]*(?:[Bb]est [Rr]egards|[Kk]ind [Rr]egards|[Rr]egards|[Bb]est [Ww]ishes|[Cc]heers|[Cc]ordiali [Ss]aluti|[Ss]aluti)[,!]?[ \t]*(?:\n\s*|[ \t]+)\p{Lu}[\p{L}’'-]*(?:[ \t]+\p{Lu}[\p{L}’'-]*){0,3}[.!]?\s*$/u;
export function withoutSignature(text: string) {
  return text
    .replaceAll('\r\n', '\n')
    .split(nextSection)
    .map((section) =>
      section
        .replace(/^-- [ \t]*$[\s\S]*/m, '')
        .replace(
          /^(?:Sent from my (?:iPhone|iPad|Android)|Inviato da (?:iPhone|iPad)|Get Outlook for (?:iOS|Android))[.!]?[ \t]*$/gim,
          '',
        )
        .replace(shortSignOff, '\n'),
    )
    .join('')
    .trim();
}
