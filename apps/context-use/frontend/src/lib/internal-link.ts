type InternalLink =
  | { kind: 'entity'; readableId: string }
  | { kind: 'page'; readableId: string; fragment: string | undefined }
  | { kind: 'asset'; readableId: string }
  | { kind: 'record'; readableId: string };

export function internalLink(href: string): InternalLink | null {
  const match =
    /^context-use:\/\/(entity|page|asset|record)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:#([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(
      href,
    );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  if (match[1] === 'record' && !match[3]) {
    return { kind: 'record', readableId: match[2] };
  }
  if (match[1] !== 'page' && match[3]) {
    return null;
  }
  if (match[1] === 'entity') {
    return { kind: 'entity', readableId: match[2] };
  }
  return match[1] === 'page'
    ? { kind: 'page', readableId: match[2], fragment: match[3] }
    : { kind: 'asset', readableId: match[2] };
}
