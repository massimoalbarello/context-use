import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  entityMentionFrom,
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

  test('resolves assigned images into entity mention chips', () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const mention = entityMentionFrom({
      readableId: 'alex-morgan',
      name: 'Alex Morgan',
      mentions: [
        {
          readableId: 'alex-morgan',
          name: 'Alex Morgan',
          image: {
            readableId: 'alex-morgan-image',
            name: 'Alex Morgan image',
            mediaType: 'image/png',
            extension: 'png',
            sizeBytes: 42,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        },
      ],
    });

    expect(mention).toEqual(
      expect.objectContaining({
        image: expect.objectContaining({
          readableId: 'alex-morgan-image',
        }),
      }),
    );
  });

  test('can replace internal links with embedded resource-selection controls', () => {
    const html = renderToStaticMarkup(
      <KnowledgePageMarkdown
        markdown={
          '# Launch\n\n[Alex](context-use://entity/alex-morgan) reviews the [plan](context-use://page/launch-plan) and [metrics](context-use://asset/rollout-metrics).\n\n![Dashboard](context-use://asset/dashboard)'
        }
        onSelectResource={() => undefined}
      />,
    );

    expect(html).toContain('<button');
    expect(html).toContain('>plan</button>');
    expect(html).toContain('>metrics</button>');
    expect(html).toContain('aria-label="Open Dashboard preview"');
    expect(html).not.toContain('href="/entities/alex-morgan"');
    expect(html).not.toContain('href="/pages/launch-plan"');
    expect(html).not.toContain('href="/api/assets/rollout-metrics/content"');
  });
});
