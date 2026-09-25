import { describe, expect, test } from 'bun:test';
import { knowledgeResourceFromPath } from '../src/lib/knowledge-navigation';

describe('knowledge navigation', () => {
  test('recognizes detail routes without treating creation as a remembered resource', () => {
    expect(knowledgeResourceFromPath('/app/pages/context-portability')).toEqual({
      collection: 'pages',
      readableId: 'context-portability',
    });
    expect(knowledgeResourceFromPath('/app/entities/luca')).toEqual({
      collection: 'entities',
      readableId: 'luca',
    });
    expect(knowledgeResourceFromPath('/app/assets/quarterly-chart')).toEqual({
      collection: 'assets',
      readableId: 'quarterly-chart',
    });
    expect(knowledgeResourceFromPath('/app/records/github-pr-42')).toEqual({
      collection: 'records',
      readableId: 'github-pr-42',
    });
    expect(knowledgeResourceFromPath('/app/pages/new')).toBeNull();
    expect(knowledgeResourceFromPath('/app/pages')).toBeNull();
  });
});
