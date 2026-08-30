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

  test('renders the title as part of the Markdown document', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown markdown={'# Header page\n\nThe body remains visible.'} />,
    );

    expect(html).toContain('<h1>Header page</h1>');
    expect(html).toContain('<p>The body remains visible.</p>');
  });
});
