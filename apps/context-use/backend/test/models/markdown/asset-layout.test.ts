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
