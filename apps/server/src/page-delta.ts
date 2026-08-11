import { diffLines, diffWordsWithSpace, type Change } from "diff";

const INLINE_DIFF_MAX_CHARACTERS = 20_000;

export type PageVersionForDelta = {
  path: string;
  title: string;
  summary: string;
  body_markdown: string;
};

export type PageMetadataChange = {
  field: "path" | "title" | "summary";
  before: string | null;
  after: string;
};

export type MarkdownInlineChange = {
  kind: "removed" | "added";
  value: string;
};

export type MarkdownChange = {
  old_start_line: number;
  old_line_count: number;
  new_start_line: number;
  new_line_count: number;
  before_markdown: string;
  after_markdown: string;
  inline_changes?: MarkdownInlineChange[];
};

function lineDiff(oldMarkdown: string, newMarkdown: string): Promise<Change[]> {
  return new Promise((resolve) => {
    diffLines(oldMarkdown, newMarkdown, { callback: resolve });
  });
}

function inlineChanges(before: string, after: string): MarkdownInlineChange[] | undefined {
  if (!before || !after || before.length + after.length > INLINE_DIFF_MAX_CHARACTERS) {
    return undefined;
  }
  const changes = diffWordsWithSpace(before, after)
    .flatMap((change): MarkdownInlineChange[] => {
      if (change.removed) return [{ kind: "removed", value: change.value }];
      if (change.added) return [{ kind: "added", value: change.value }];
      return [];
    });
  return changes.length ? changes : undefined;
}

export async function markdownChanges(
  oldMarkdown: string,
  newMarkdown: string,
): Promise<MarkdownChange[]> {
  const parts = await lineDiff(oldMarkdown, newMarkdown);
  const changes: MarkdownChange[] = [];
  let oldLine = 1;
  let newLine = 1;
  let current: MarkdownChange | undefined;

  const finishCurrent = () => {
    if (!current) return;
    const refined = inlineChanges(current.before_markdown, current.after_markdown);
    changes.push(refined ? { ...current, inline_changes: refined } : current);
    current = undefined;
  };

  for (const part of parts) {
    if (!part.added && !part.removed) {
      finishCurrent();
      oldLine += part.count;
      newLine += part.count;
      continue;
    }

    current ??= {
      old_start_line: oldLine,
      old_line_count: 0,
      new_start_line: newLine,
      new_line_count: 0,
      before_markdown: "",
      after_markdown: "",
    };

    if (part.removed) {
      current.old_line_count += part.count;
      current.before_markdown += part.value;
      oldLine += part.count;
    } else {
      current.new_line_count += part.count;
      current.after_markdown += part.value;
      newLine += part.count;
    }
  }
  finishCurrent();
  return changes;
}

export async function pageDelta(
  previous: PageVersionForDelta | null,
  current: PageVersionForDelta,
): Promise<{ metadata_changes: PageMetadataChange[]; markdown_changes: MarkdownChange[] }> {
  const metadataChanges: PageMetadataChange[] = [];
  for (const field of ["path", "title", "summary"] as const) {
    const before = previous?.[field] ?? null;
    if (before !== current[field]) {
      metadataChanges.push({ field, before, after: current[field] });
    }
  }
  return {
    metadata_changes: metadataChanges,
    markdown_changes: await markdownChanges(previous?.body_markdown ?? "", current.body_markdown),
  };
}
