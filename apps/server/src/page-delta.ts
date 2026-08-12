import { diffLines, type Change } from "diff";

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

export type MarkdownChange = {
  before: string;
  after: string;
};

function lineDiff(oldMarkdown: string, newMarkdown: string): Promise<Change[]> {
  return new Promise((resolve) => {
    diffLines(oldMarkdown, newMarkdown, { callback: resolve });
  });
}

export async function markdownChanges(
  oldMarkdown: string,
  newMarkdown: string,
): Promise<MarkdownChange[]> {
  const parts = await lineDiff(oldMarkdown, newMarkdown);
  const changes: MarkdownChange[] = [];
  let current: MarkdownChange | undefined;

  const finishCurrent = () => {
    if (!current) return;
    changes.push(current);
    current = undefined;
  };

  for (const part of parts) {
    if (!part.added && !part.removed) {
      finishCurrent();
      continue;
    }

    current ??= {
      before: "",
      after: "",
    };

    if (part.removed) {
      current.before += part.value;
    } else {
      current.after += part.value;
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
