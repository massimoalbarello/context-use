export type KnowledgeCollection = 'entities' | 'pages' | 'assets' | 'records';
export const MAIN_KNOWLEDGE_PATH = '/app/map' as const;

export function knowledgeResourceFromPath(
  pathname: string,
): { collection: KnowledgeCollection; readableId: string } | null {
  const match = /^\/app\/(entities|pages|assets|records)\/([^/]+)\/?$/.exec(pathname);
  const collection = match?.[1];
  const encodedReadableId = match?.[2];
  if (!collection || !encodedReadableId || encodedReadableId === 'new') {
    return null;
  }

  try {
    return {
      collection: collection as KnowledgeCollection,
      readableId: decodeURIComponent(encodedReadableId),
    };
  } catch {
    return null;
  }
}
