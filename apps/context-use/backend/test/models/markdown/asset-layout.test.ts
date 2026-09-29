import { expect, test } from 'bun:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as markdownText } from 'mdast-util-to-string';
import { remarkAssetLayout } from '#backend/models/markdown/asset-layout.ts';

test.each(['half', 'third'])(
  'recognizes %s and only supported hints attached to local asset embeds, including references',
  (layout) => {
    const tree = fromMarkdown(`![First](context-use://asset/first){layout=${layout}}
![Second][asset]{size=large align=center}

[asset]: context-use://asset/second

![Third](/public/assets/asset_public){size=small align=right}

![External](https://example.com/image.png){layout=half}

![Unknown](context-use://asset/unknown){onclick=alert(1)}

Ordinary prose {size=large align=center}

\`![Code](context-use://asset/code){layout=half}\`

\`\`\`md
![Example](context-use://asset/example){size=large align=center}
\`\`\``);
    remarkAssetLayout()(tree);
    const first = tree.children[0];
    expect(first?.data?.hName).toBe('div');
    if (first?.type !== 'paragraph') {
      throw new Error('Expected media paragraph');
    }
    expect(first.children[0]?.data?.hProperties?.className).toEqual([
      'markdown-asset',
      `asset-${layout}`,
    ]);
    expect(first.children[2]?.data?.hProperties?.className).toEqual([
      'markdown-asset',
      'asset-large',
      'asset-center',
    ]);
    const text = markdownText(tree);
    expect(text).not.toContain(`First{layout=${layout}}`);
    expect(text).not.toContain('Second{size=large align=center}');
    expect(text).toContain('External{layout=half}');
    expect(text).toContain('Unknown{onclick=alert(1)}');
    expect(text).toContain('Ordinary prose {size=large align=center}');
    expect(text).toContain('![Code](context-use://asset/code){layout=half}');
    expect(text).toContain('![Example](context-use://asset/example){size=large align=center}');
  },
);

test('inline asset labels stay in complete paragraphs and their media follows in source order', () => {
  const tree =
    fromMarkdown(`![The product was nothing more than a proof of concept](context-use://asset/demo){size=large}. It couldn't do much, but **the concept** was fascinating.

Compare ![First][asset] with [![Second](context-use://asset/second)](https://example.com). Both matter.

[asset]: context-use://asset/first`);
  remarkAssetLayout()(tree);
  const paragraphs = tree.children.filter((node) => node.type === 'paragraph');
  expect(paragraphs.map((node) => node.data?.hName ?? 'p')).toEqual(['p', 'div', 'p', 'div']);
  expect(markdownText(paragraphs[0])).toBe(
    "The product was nothing more than a proof of concept. It couldn't do much, but the concept was fascinating.",
  );
  expect(paragraphs[0]?.children.some((node) => node.type === 'strong')).toBe(true);
  expect(markdownText(paragraphs[2])).toBe('Compare First with Second. Both matter.');
  expect(paragraphs[3]?.children.map((node) => markdownText(node))).toEqual(['First', 'Second']);
  expect(paragraphs[3]?.children[1]).toMatchObject({
    type: 'link',
    url: 'https://example.com',
    children: [{ type: 'image', alt: 'Second' }],
  });
});

test('empty labels and formatted embed containers retain the surrounding prose without moving its formatting', () => {
  const tree = fromMarkdown(
    'Before **![label](context-use://asset/first) and bold text**. ![](context-use://asset/second) After.',
  );
  remarkAssetLayout()(tree);
  const [paragraph, media] = tree.children;
  expect(markdownText(paragraph)).toBe('Before label and bold text.  After.');
  if (paragraph?.type !== 'paragraph') {
    throw new Error('Expected prose paragraph');
  }
  expect(paragraph.children[1]).toMatchObject({
    type: 'strong',
    children: [
      { type: 'text', value: 'label' },
      { type: 'text', value: ' and bold text' },
    ],
  });
  expect(markdownText(media)).toBe('label');
});

test('hidden HTML and line breaks do not turn standalone embed labels into prose', () => {
  const tree = fromMarkdown(
    '![Caption](context-use://asset/picture)<!-- hidden -->  \n![Second](context-use://asset/second)',
  );
  remarkAssetLayout()(tree);
  expect(tree.children).toHaveLength(1);
  expect(tree.children[0]?.data?.hName).toBe('div');
});
