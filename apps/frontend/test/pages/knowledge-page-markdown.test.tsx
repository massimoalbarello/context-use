import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  KnowledgePageMarkdown,
  knowledgeHeadingId,
} from '../../src/components/pages/knowledge-page-markdown';

describe('knowledge page Markdown', () => {
  test('derives readable anchors for linked page sections', () => {
    expect(knowledgeHeadingId('The Feedback Loop')).toBe('the-feedback-loop');
    expect(knowledgeHeadingId('Evidence, action & learning')).toBe('evidence-action-learning');
    expect(knowledgeHeadingId(['The ', <em key="feedback">Feedback</em>, ' Loop'])).toBe(
      'the-feedback-loop',
    );
  });

  test('can leave the title to the surrounding resource header', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown markdown={'# Header page\n\nThe body remains visible.'} hideTitle />,
    );

    expect(html).not.toContain('<h1');
    expect(html).toContain('<p>The body remains visible.</p>');
  });
});
