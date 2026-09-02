import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { KnowledgePageRevisions } from '../../src/components/pages/knowledge-page-revisions';
import type { KnowledgePage } from '../../src/queries/pages';

test('revision history shows the snapshotted readable author name', () => {
  const timestamp = new Date('2026-09-01T12:00:00.000Z');
  const page = {
    revisionNumber: 2,
    revisions: [
      {
        revisionNumber: 2,
        title: 'Updated notes',
        temporalCoverage: '2025-03/..',
        author: { kind: 'mcp_client', name: 'Research agent' },
        createdAt: timestamp,
      },
      {
        revisionNumber: 1,
        title: 'Initial notes',
        temporalCoverage: null,
        author: { kind: 'owner', name: 'Alex Morgan' },
        createdAt: timestamp,
      },
    ],
  } satisfies Pick<KnowledgePage, 'revisionNumber' | 'revisions'>;

  const html = renderToStaticMarkup(<KnowledgePageRevisions page={page} />);

  expect(html).toContain('Created by Research agent');
  expect(html).toContain('Created by Alex Morgan');
  expect(html).toContain('Since March 2025 · ongoing');
  expect(html).toContain('General knowledge');
});
