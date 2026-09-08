import { describe, expect, test } from 'bun:test';
import {
  InvalidKnowledgePageMarkdownError,
  parseKnowledgePageMarkdown,
} from '#models/knowledge-pages/markdown.ts';
import {
  MAX_KNOWLEDGE_PAGE_BYTES,
  MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH,
  MAX_KNOWLEDGE_PAGE_TITLE_LENGTH,
} from '#models/knowledge-pages/model.ts';

const LONG_EXCERPT_REPEAT_COUNT = 12;

describe('knowledge page Markdown', () => {
  test('extracts visible text and labelled direct internal links', () => {
    const parsed = parseKnowledgePageMarkdown(`# A small connected idea

[Luca](context-use://entity/luca-bianchi) applies the loop from the
[**growth playbook**](context-use://page/growth-playbook#feedback-loop).

## Feedback loop

![Quarterly chart](context-use://asset/quarterly-chart)

[Download the chart](context-use://asset/quarterly-chart)

The observation changes the next action.`);

    expect(parsed).toEqual({
      title: 'A small connected idea',
      excerpt: 'Luca applies the loop from the growth playbook.',
      searchableText:
        'Feedback loop Quarterly chart Download the chart The observation changes the next action.',
      links: {
        entityReadableIds: ['luca-bianchi'],
        pageReferences: [{ readableId: 'growth-playbook', fragment: 'feedback-loop' }],
        assetUsages: [
          { readableId: 'quarterly-chart', presentation: 'embed' },
          { readableId: 'quarterly-chart', presentation: 'attachment' },
        ],
      },
    });
  });

  test('projects formatting, headings, nested lists, block quotes, and CommonMark pipe prose', () => {
    const parsed = parseKnowledgePageMarkdown(`# Visible Markdown

An *ordinary* summary with **strong text** and an [external label](https://example.test).

## Details

- First item
  - Nested item
- Second item

> Quoted **prose**

Inline code \`private-code\` is omitted.

| Pipe-shaped | CommonMark prose |`);

    expect(parsed.excerpt).toBe('An ordinary summary with strong text and an external label.');
    expect(parsed.searchableText).toBe(
      'Details First item Nested item Second item Quoted prose Inline code is omitted. | Pipe-shaped | CommonMark prose |',
    );
  });

  test('resolves full, collapsed, and shortcut references with CommonMark identifiers', () => {
    const parsed = parseKnowledgePageMarkdown(`# Reference links

The references stay readable.

[Luca][Person] follows [Roadmap][] with [Evidence].

![Chart][chart]

[Person]: context-use://entity/luca-bianchi
[Roadmap]: context-use://page/product-roadmap#next-step
[Evidence]: context-use://asset/research-notes
[chart]: context-use://asset/quarterly-chart`);

    expect(parsed.searchableText).toBe('Luca follows Roadmap with Evidence. Chart');
    expect(parsed.links).toEqual({
      entityReadableIds: ['luca-bianchi'],
      pageReferences: [{ readableId: 'product-roadmap', fragment: 'next-step' }],
      assetUsages: [
        { readableId: 'research-notes', presentation: 'attachment' },
        { readableId: 'quarterly-chart', presentation: 'embed' },
      ],
    });
  });

  test('deduplicates typed relationships while retaining distinct asset presentations', () => {
    const parsed = parseKnowledgePageMarkdown(`# Repeated relationships

Repeated links remain readable.

[Luca](context-use://entity/luca) and [Luca again](context-use://entity/luca).
[Plan](context-use://page/plan#today) and [the same plan](context-use://page/plan#today).
![Chart](context-use://asset/chart) ![Chart again](context-use://asset/chart)
[Chart file](context-use://asset/chart) [Chart download](context-use://asset/chart)`);

    expect(parsed.links).toEqual({
      entityReadableIds: ['luca'],
      pageReferences: [{ readableId: 'plan', fragment: 'today' }],
      assetUsages: [
        { readableId: 'chart', presentation: 'embed' },
        { readableId: 'chart', presentation: 'attachment' },
      ],
    });
  });

  test('rejects bare addresses, autolinks, address labels, and hidden address fields', () => {
    const invalidBodies = [
      'context-use://page/growth-playbook',
      '<context-use://page/growth-playbook>',
      '[context-use://page/growth-playbook](context-use://page/growth-playbook)',
      '[External](https://example.test "context-use://page/hidden")',
      '![context-use://asset/chart](https://example.test/chart.png)',
      '[External](https://example.test/context-use://page/hidden)',
    ];

    for (const body of invalidBodies) {
      expect(() => parseKnowledgePageMarkdown(`# Broken internal address\n\n${body}`)).toThrow(
        'labelled Markdown links',
      );
    }
  });

  test('rejects unused internal definitions and internal addresses in definition titles', () => {
    expect(() =>
      parseKnowledgePageMarkdown(`# Unused definition

Visible prose.

[target]: context-use://page/hidden`),
    ).toThrow('labelled Markdown links');

    expect(() =>
      parseKnowledgePageMarkdown(`# Hidden definition title

[Visible][target]

[target]: https://example.test "context-use://page/hidden"`),
    ).toThrow('labelled Markdown links');
  });

  test('validates resource kinds, readable IDs, fragments, and embed syntax', () => {
    const invalidBodies = [
      '[Entity](context-use://entity/NOT-readable)',
      '[Asset](context-use://asset/chart#section)',
      '[Page](context-use://page/plan#NOT-readable)',
      '![Entity](context-use://entity/luca)',
      '![Page](context-use://page/plan)',
      '[Unknown](context-use://object/unknown)',
    ];

    for (const body of invalidBodies) {
      expect(() => parseKnowledgePageMarkdown(`# Invalid internal link\n\n${body}`)).toThrow(
        InvalidKnowledgePageMarkdownError,
      );
    }
  });

  test('ignores fenced, indented, and inline code as relationships and readable text', () => {
    const parsed = parseKnowledgePageMarkdown(`# Link syntax

The examples are documented below.

Inline \`[Inline](context-use://page/inline-example)\` stays hidden.

\`\`\`markdown
[Luca](context-use://entity/luca-bianchi)
\`\`\`

    [Hidden](context-use://asset/hidden-code-link)

Then use the documented form.`);

    expect(parsed.links).toEqual({ entityReadableIds: [], pageReferences: [], assetUsages: [] });
    expect(parsed.searchableText).toBe('Inline stays hidden. Then use the documented form.');
  });

  test('excludes HTML from readable text and rejects internal addresses inside HTML', () => {
    const parsed = parseKnowledgePageMarkdown(`# HTML projection

Visible summary.

<div>hidden HTML block</div>

Visible conclusion.`);

    expect(parsed.searchableText).toBe('Visible conclusion.');
    expect(() =>
      parseKnowledgePageMarkdown(`# HTML address

Visible summary.

<div>context-use://page/hidden</div>`),
    ).toThrow('labelled Markdown links');
    expect(() =>
      parseKnowledgePageMarkdown(`# Inline HTML address

Visible <span>context-use://page/hidden</span> prose.`),
    ).toThrow('labelled Markdown links');
  });

  test('selects the first meaningful non-heading block as the excerpt source', () => {
    const parsed = parseKnowledgePageMarkdown(`# Meaningful prose

## Details

---

\`\`\`
hidden code
\`\`\`

<div>hidden HTML</div>

> First **readable** quote.

Following prose.`);

    expect(parsed.excerpt).toBe('First readable quote.');
    expect(parsed.searchableText).toBe('Details Following prose.');
  });

  test('counts image alt text as readable content but rejects non-readable bodies', () => {
    expect(
      parseKnowledgePageMarkdown('# Image page\n\n![Quarterly chart](chart.png)'),
    ).toMatchObject({
      excerpt: 'Quarterly chart',
      searchableText: '',
    });

    const nonReadableBodies = [
      '## Heading only',
      '---',
      '```\nhidden code\n```',
      '<div>hidden HTML</div>',
      '![](chart.png "Tooltip")',
    ];
    for (const body of nonReadableBodies) {
      expect(() => parseKnowledgePageMarkdown(`# Empty body\n\n${body}`)).toThrow(
        'readable content',
      );
    }
  });

  test('excludes a complete excerpt block from searchable text', () => {
    const parsed = parseKnowledgePageMarkdown(`# Separate excerpt

This summary is stored separately.

## Details

The searchable body remains.`);

    expect(parsed.excerpt).toBe('This summary is stored separately.');
    expect(parsed.searchableText).toBe('Details The searchable body remains.');
  });

  test('preserves the exact unrepresented tail of a truncated excerpt source', () => {
    const source = `${'Early context stays in the excerpt. '.repeat(
      LONG_EXCERPT_REPEAT_COUNT,
    )}The unrepresented tail remains searchable.`.trim();
    const parsed = parseKnowledgePageMarkdown(`# Long introduction

${source}`);
    const representedExcerpt = parsed.excerpt.slice(0, -1);

    expect(parsed.excerpt.endsWith('…')).toBe(true);
    expect(parsed.excerpt.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH);
    expect(parsed.searchableText).toBe(source.slice(representedExcerpt.length).trimStart());
    expect(parsed.searchableText).toContain('The unrepresented tail remains searchable.');
  });

  test('bounds UTF-8 size and requires exactly one leading bounded H1', () => {
    expect(() => parseKnowledgePageMarkdown('')).toThrow(InvalidKnowledgePageMarkdownError);
    expect(() =>
      parseKnowledgePageMarkdown(`# Too large\n\n${'é'.repeat(MAX_KNOWLEDGE_PAGE_BYTES)}`),
    ).toThrow(`${MAX_KNOWLEDGE_PAGE_BYTES} bytes`);
    expect(() => parseKnowledgePageMarkdown('No title\n\nReadable body.')).toThrow(
      'start with one H1',
    );
    expect(() =>
      parseKnowledgePageMarkdown(`# ${'x'.repeat(MAX_KNOWLEDGE_PAGE_TITLE_LENGTH + 1)}\n\nBody.`),
    ).toThrow('start with one H1');
    expect(() => parseKnowledgePageMarkdown('# First\n\nText\n\n# Second')).toThrow('one H1 title');
  });
});
