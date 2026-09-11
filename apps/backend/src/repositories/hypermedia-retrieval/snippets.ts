import { SQL } from 'bun';
import { MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH } from '#models/hypermedia-retrieval/model.ts';

const MATCH_START = '\u{e000}';
const MATCH_END = '\u{e001}';
const MATCH_EXCERPT_TOKENS = 32;
export const BODY_SNIPPET_COLUMN = 3;

export interface SnippetDocument {
  readableId: string;
  label: string;
  summary: string;
  body: string;
  metadata: string;
  column: -1 | typeof BODY_SNIPPET_COLUMN;
}

/** Only selected documents pass through this private, short-lived in-memory index. */
export async function searchSnippets({
  schema,
  expression,
  documents,
}: {
  schema: string;
  expression: string;
  documents: AsyncIterable<SnippetDocument>;
}): Promise<Array<string | null>> {
  const scratch = new SQL({ adapter: 'sqlite', filename: ':memory:' });
  try {
    // Reuse the installed definition so columns, tokenizer and prefix rules cannot drift.
    // Only content retention changes, and only inside this disposable memory database.
    await scratch.unsafe(
      schema.replace(/content\s*=\s*'',/u, '').replace(/contentless_delete\s*=\s*1,/u, ''),
    );
    const excerpts: Array<string | null> = [];
    for await (const document of documents) {
      const clean = (text: string) => text.replaceAll(MATCH_START, ' ').replaceAll(MATCH_END, ' ');
      await scratch`
        insert into "hypermedia_search_fts" ("rowid", "readable_id", "label", "summary", "body", "metadata")
        values (1, ${clean(document.readableId)}, ${clean(document.label)}, ${clean(document.summary)},
          ${clean(document.body)}, ${clean(document.metadata)})
      `;
      const rows = await scratch<Array<{ excerpt: string }>>`
        select snippet("hypermedia_search_fts", ${document.column}, ${MATCH_START}, ${MATCH_END}, ' … ',
          ${MATCH_EXCERPT_TOKENS}) as "excerpt"
        from "hypermedia_search_fts" where "hypermedia_search_fts" match ${expression}
      `;
      if (!rows[0]) {
        throw new Error('Search content does not match its indexed revision');
      }
      excerpts.push(matchExcerpt(rows[0].excerpt));
      // Bound memory to one selected document, not the entire top K or corpus.
      await scratch`delete from "hypermedia_search_fts"`;
    }
    return excerpts;
  } finally {
    await scratch.close();
  }
}

function matchExcerpt(raw: string): string | null {
  if (!raw.includes(MATCH_START)) {
    return null;
  }
  const text = raw.replaceAll(MATCH_START, '').replaceAll(MATCH_END, '').trim();
  if (text.length <= MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH) {
    return text;
  }
  const contextBeforeMatch = 80;
  const start = Math.max(0, raw.indexOf(MATCH_START) - contextBeforeMatch);
  const prefix = start > 0 ? '… ' : '';
  const length = MAX_HYPERMEDIA_MATCH_EXCERPT_LENGTH - prefix.length - 1;
  return `${prefix}${text.slice(start, start + length).trim()}…`;
}
