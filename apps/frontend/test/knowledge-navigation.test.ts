import { describe, expect, test } from 'bun:test';
import {
  clearRememberedKnowledgeResources,
  knowledgeResourceFromPath,
  readRememberedKnowledgeResource,
  writeRememberedKnowledgeResource,
} from '../src/lib/knowledge-navigation';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (...args: [string, string]) => {
      values.set(...args);
    },
  };
}

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
    expect(knowledgeResourceFromPath('/pages/new')).toBeNull();
    expect(knowledgeResourceFromPath('/pages')).toBeNull();
  });

  test('keeps the last entity, page, and asset together for one owner', () => {
    const storage = memoryStorage();

    writeRememberedKnowledgeResource({
      storage,
      ownerEntityReadableId: 'owner',
      collection: 'pages',
      readableId: 'context-portability',
    });
    writeRememberedKnowledgeResource({
      storage,
      ownerEntityReadableId: 'owner',
      collection: 'entities',
      readableId: 'luca',
    });
    writeRememberedKnowledgeResource({
      storage,
      ownerEntityReadableId: 'owner',
      collection: 'assets',
      readableId: 'quarterly-chart',
    });

    expect(
      readRememberedKnowledgeResource({
        storage,
        ownerEntityReadableId: 'owner',
        collection: 'assets',
      }),
    ).toBe('quarterly-chart');
    expect(
      readRememberedKnowledgeResource({
        storage,
        ownerEntityReadableId: 'owner',
        collection: 'pages',
      }),
    ).toBe('context-portability');
    expect(
      readRememberedKnowledgeResource({
        storage,
        ownerEntityReadableId: 'owner',
        collection: 'entities',
      }),
    ).toBe('luca');
    expect(
      readRememberedKnowledgeResource({
        storage,
        ownerEntityReadableId: 'another-owner',
        collection: 'pages',
      }),
    ).toBeUndefined();
  });

  test('clears remembered resources across authentication transitions', () => {
    const storage = memoryStorage();
    writeRememberedKnowledgeResource({
      storage,
      ownerEntityReadableId: 'shared-owner-name',
      collection: 'pages',
      readableId: 'private-project',
    });
    storage.setItem('unrelated-session-state', 'preserved');

    clearRememberedKnowledgeResources(storage);

    expect(
      readRememberedKnowledgeResource({
        storage,
        ownerEntityReadableId: 'shared-owner-name',
        collection: 'pages',
      }),
    ).toBeUndefined();
    expect(storage.getItem('unrelated-session-state')).toBe('preserved');
  });
});
