import { describe, expect, test } from 'bun:test';
import {
  InvalidKnowledgePageMarkdownError,
  parseKnowledgePageMarkdown,
} from '#pages/knowledge-page-markdown.ts';

describe('knowledge page Markdown', () => {
  test('extracts labelled entity mentions and page references', () => {
    const parsed = parseKnowledgePageMarkdown(`# A small connected idea

[Luca](context-use://entity/luca-bianchi) applies the loop from the
[growth playbook](context-use://page/growth-playbook#feedback-loop).

## Feedback loop

The observation changes the next action.`);

    expect(parsed).toEqual({
      title: 'A small connected idea',
      links: {
        entityReadableIds: ['luca-bianchi'],
        pageReferences: [{ readableId: 'growth-playbook', fragment: 'feedback-loop' }],
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

    expect(parsed.links).toEqual({ entityReadableIds: [], pageReferences: [] });
  });

  test('rejects opaque or unlabelled internal addresses', () => {
    expect(() =>
      parseKnowledgePageMarkdown('# Broken link\n\ncontext-use://page/growth-playbook'),
    ).toThrow('labelled Markdown links');
  });
});
