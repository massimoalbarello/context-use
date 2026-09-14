import { describe, expect, test } from 'bun:test';
import { knowledgeResourceFromPath } from '../src/lib/knowledge-navigation';

describe('knowledge navigation', () => {
  test('recognizes detail routes without treating creation as a remembered resource', () => {
    expect(knowledgeResourceFromPath('/pages/context-portability')).toEqual({
      collection: 'pages',
      readableId: 'context-portability',
    });
    expect(knowledgeResourceFromPath('/entities/luca')).toEqual({
      collection: 'entities',
      readableId: 'luca',
    });
    expect(knowledgeResourceFromPath('/assets/quarterly-chart')).toEqual({
      collection: 'assets',
      readableId: 'quarterly-chart',
    });
    expect(knowledgeResourceFromPath('/records/github-pr-42')).toEqual({
      collection: 'records',
      readableId: 'github-pr-42',
    });
    expect(knowledgeResourceFromPath('/pages/new')).toBeNull();
    expect(knowledgeResourceFromPath('/pages')).toBeNull();
  });
});
