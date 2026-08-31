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

    expect(html).toContain('>Header page</h1>');
    expect(html).toContain('>The body remains visible.</p>');
  });

  test('renders asset embeds and attachments through authenticated content routes', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown
        markdown={
          '# Evidence\n\n![Quarterly chart](context-use://asset/quarterly-chart)\n\n[Download model](context-use://asset/financial-model)'
        }
      />,
    );

    expect(html).toContain('src="/api/assets/quarterly-chart/content"');
    expect(html).toContain('href="/api/assets/financial-model/content"');
  });
});
