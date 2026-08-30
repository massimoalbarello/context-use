import { describe, expect, test } from 'bun:test';
import { KnowledgePageLink } from '../../src/components/pages/knowledge-page-link';

describe('knowledge page cards', () => {
  test('open the canonical preview view', () => {
    const link = KnowledgePageLink({
      page: {
        readableId: 'target-page',
        title: 'Target page',
        excerpt: 'The page summary.',
      },
      presentation: 'card',
      active: true,
    });

    expect(link).toMatchObject({
      props: {
        params: { id: 'target-page' },
        search: { view: 'preview' },
        activeOptions: { exact: true, includeSearch: false },
        'data-route-selected': 'true',
        'aria-current': 'page',
      },
    });
  });
});
