import { describe, expect, test } from 'bun:test';
import {
  findActiveEntityMention,
  insertEntityMention,
} from '../../src/components/pages/entity-mention';

describe('entity mentions', () => {
  test('finds a mention being typed at the cursor', () => {
    expect(findActiveEntityMention({ markdown: 'Discuss this with @mass', cursor: 23 })).toEqual({
      start: 18,
      end: 23,
      query: 'mass',
    });
  });

  test('does not treat an email address as a mention', () => {
    const markdown = 'Email massimo@example.com';
    expect(findActiveEntityMention({ markdown, cursor: markdown.length })).toBeNull();
  });

  test('replaces only the active query and preserves surrounding Markdown', () => {
    const markdown = 'Discuss this with @mass tomorrow.';
    const mention = findActiveEntityMention({ markdown, cursor: 23 });
    if (!mention) {
      throw new Error('Expected an active mention');
    }

    expect(
      insertEntityMention({
        markdown,
        mention,
        entity: { name: 'Massimo Albarello', readableId: 'massimo-albarello' },
      }),
    ).toEqual({
      markdown:
        'Discuss this with [Massimo Albarello](context-use://entity/massimo-albarello) tomorrow.',
      cursor: 77,
    });
  });
});
