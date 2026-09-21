import { structuredPatch } from 'diff';

const DIFF_CONTEXT_LINES = 3;
const DIFF_TIMEOUT_MS = 250;
export const MAX_REVISION_DIFF_EDIT_LENGTH = 2_000;

export interface KnowledgePageDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface KnowledgePageDiff {
  from: number;
  to: number;
  hunks: KnowledgePageDiffHunk[];
  additions: number;
  deletions: number;
  temporalCoverage: { from: string | null; to: string | null } | null;
}

export function diffPageMarkdown({ before, after }: { before: string; after: string }) {
  const patch = structuredPatch('page.md', 'page.md', before, after, undefined, undefined, {
    context: DIFF_CONTEXT_LINES,
    timeout: DIFF_TIMEOUT_MS,
    maxEditLength: MAX_REVISION_DIFF_EDIT_LENGTH,
  });
  if (!patch) {
    return null;
  }
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        additions++;
      } else if (line.startsWith('-')) {
        deletions++;
      }
    }
  }
  return { hunks: patch.hunks, additions, deletions };
}
