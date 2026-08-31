import { describe, expect, test } from 'bun:test';
import {
  InvalidKnowledgePageMarkdownError,
  parseKnowledgePageMarkdown,
} from '#models/knowledge-pages/markdown.ts';
import { MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH } from '#models/knowledge-pages/model.ts';

const LONG_EXCERPT_REPEAT_COUNT = 12;

describe('knowledge page Markdown', () => {
  test('extracts labelled entity mentions and page references', () => {
    const parsed = parseKnowledgePageMarkdown(`# A small connected idea

[Luca](context-use://entity/luca-bianchi) applies the loop from the
[growth playbook](context-use://page/growth-playbook#feedback-loop).

## Feedback loop

The observation changes the next action.`);

    expect(parsed).toEqual({
      title: 'A small connected idea',
      excerpt: 'Luca applies the loop from the growth playbook.',
      links: {
        entityReadableIds: ['luca-bianchi'],
        pageReferences: [{ readableId: 'growth-playbook', fragment: 'feedback-loop' }],
        assetUsages: [],
      },
    });
  });

  test('requires one leading H1 and content below it', () => {
    expect(() => parseKnowledgePageMarkdown('# Only a title')).toThrow(
      InvalidKnowledgePageMarkdownError,
    );
    expect(() => parseKnowledgePageMarkdown('# First\n\nText\n\n# Second')).toThrow('one H1 title');
  });

  test('does not treat examples inside code as links', () => {
    const parsed = parseKnowledgePageMarkdown(`# Link syntax

Use this syntax:

\`\`\`markdown
[Luca](context-use://entity/luca-bianchi)
\`\`\``);

    expect(parsed.links).toEqual({ entityReadableIds: [], pageReferences: [], assetUsages: [] });
  });

  test('derives a bounded plain-text excerpt from the first meaningful body text', () => {
    const parsed = parseKnowledgePageMarkdown(`# Context portability

## Why it matters

**Portable knowledge** keeps [readable labels](context-use://page/growth-playbook) while moving
 between systems. ${'Further evidence makes the account clearer. '.repeat(
   LONG_EXCERPT_REPEAT_COUNT,
 )}`);

    expect(parsed.excerpt.startsWith('Portable knowledge keeps readable labels')).toBe(true);
    expect(parsed.excerpt.endsWith('…')).toBe(true);
    expect(parsed.excerpt.length).toBeLessThanOrEqual(MAX_KNOWLEDGE_PAGE_EXCERPT_LENGTH);
    expect(parsed.excerpt).not.toContain('**');
    expect(parsed.excerpt).not.toContain('context-use://');
  });

  test('rejects opaque or unlabelled internal addresses', () => {
    expect(() =>
      parseKnowledgePageMarkdown('# Broken link\n\ncontext-use://page/growth-playbook'),
    ).toThrow('labelled Markdown links');
  });

  test('distinguishes embedded assets from attachments', () => {
    const parsed = parseKnowledgePageMarkdown(`# Evidence

![Chart](context-use://asset/quarterly-chart)

[Download data](context-use://asset/quarterly-chart)`);

    expect(parsed.links.assetUsages).toEqual([
      { readableId: 'quarterly-chart', presentation: 'embed' },
      { readableId: 'quarterly-chart', presentation: 'attachment' },
    ]);
  });

  test('rejects fragments on assets and image syntax for non-assets', () => {
    expect(() =>
      parseKnowledgePageMarkdown(
        '# Broken asset\n\n[Chart](context-use://asset/quarterly-chart#section)',
      ),
    ).toThrow('Page link fragments');
    expect(() =>
      parseKnowledgePageMarkdown('# Broken page\n\n![Page](context-use://page/quarterly-chart)'),
    ).toThrow('Only assets');
  });
});
