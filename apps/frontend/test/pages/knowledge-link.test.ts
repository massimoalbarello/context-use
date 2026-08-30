import { describe, expect, test } from 'bun:test';
import {
  findActiveKnowledgeLink,
  insertKnowledgeLink,
} from '../../src/components/pages/knowledge-link';
import { scrollPickerOptionIntoView } from '../../src/components/pages/knowledge-link-textarea';

describe('knowledge links', () => {
  test('finds a knowledge search being typed at the cursor', () => {
    expect(findActiveKnowledgeLink({ markdown: 'Discuss this with @mass', cursor: 23 })).toEqual({
      start: 18,
      end: 23,
      query: 'mass',
    });
  });

  test('does not treat an email address as a knowledge search', () => {
    const markdown = 'Email massimo@example.com';
    expect(findActiveKnowledgeLink({ markdown, cursor: markdown.length })).toBeNull();
  });

  test('inserts an entity as a canonical mention', () => {
    const markdown = 'Discuss this with @mass tomorrow.';
    const link = findActiveKnowledgeLink({ markdown, cursor: 23 });
    if (!link) {
      throw new Error('Expected an active knowledge link');
    }

    expect(
      insertKnowledgeLink({
        markdown,
        link,
        target: {
          kind: 'entity',
          entity: { name: 'Massimo Albarello', readableId: 'massimo-albarello' },
        },
      }),
    ).toEqual({
      markdown:
        'Discuss this with [Massimo Albarello](context-use://entity/massimo-albarello) tomorrow.',
      cursor: 77,
    });
  });

  test('inserts a page as a canonical reference', () => {
    const markdown = 'This builds on @omnia today.';
    const link = findActiveKnowledgeLink({ markdown, cursor: 21 });
    if (!link) {
      throw new Error('Expected an active knowledge link');
    }

    expect(
      insertKnowledgeLink({
        markdown,
        link,
        target: {
          kind: 'page',
          page: { title: 'Omnia Team', readableId: 'omnia-team' },
        },
      }),
    ).toEqual({
      markdown: 'This builds on [Omnia Team](context-use://page/omnia-team) today.',
      cursor: 58,
    });
  });
});

describe('knowledge picker scrolling', () => {
  test('reveals the selected option in either direction without moving visible options', () => {
    const menuBounds = { top: 200, bottom: 500 };
    const belowMenu = { top: 460, bottom: 560 };
    const aboveMenu = { top: 150, bottom: 250 };
    const insideMenu = { top: 250, bottom: 350 };
    const initialScrollTop = 100;
    const menu = {
      scrollTop: initialScrollTop,
      getBoundingClientRect: () => menuBounds,
    };

    scrollPickerOptionIntoView({
      menu,
      option: { getBoundingClientRect: () => belowMenu },
    });
    const afterScrollingDown = initialScrollTop + belowMenu.bottom - menuBounds.bottom;
    expect(menu.scrollTop).toBe(afterScrollingDown);

    scrollPickerOptionIntoView({
      menu,
      option: { getBoundingClientRect: () => aboveMenu },
    });
    const afterScrollingUp = afterScrollingDown - (menuBounds.top - aboveMenu.top);
    expect(menu.scrollTop).toBe(afterScrollingUp);

    scrollPickerOptionIntoView({
      menu,
      option: { getBoundingClientRect: () => insideMenu },
    });
    expect(menu.scrollTop).toBe(afterScrollingUp);
  });
});
