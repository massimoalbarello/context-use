import { expect, test } from 'bun:test';
import { parseKnowledgePageMarkdown } from '#backend/models/knowledge-pages/markdown.ts';
import { recordAssetUsages } from '#backend/models/records/assets.ts';

test('pages and records discover the same asset links, including reference syntax and images inside links', () => {
  const markdown = `# Shared asset references

[Download][FILE] and ![Image][file] use the same definition.
[Download again](context-use://asset/diagram) is the same attachment.
[![Linked preview](context-use://asset/preview)](https://example.test) embeds another asset.

Inline \`[Example](context-use://asset/inline-example)\` is not a relationship.

\`\`\`markdown
![Example](context-use://asset/code-example)
\`\`\`

[File]: context-use://asset/diagram
[unused]: https://example.test/unused
`;
  const expected: ReturnType<typeof recordAssetUsages> = [
    { readableId: 'diagram', presentation: 'attachment' },
    { readableId: 'diagram', presentation: 'embed' },
    { readableId: 'preview', presentation: 'embed' },
  ];
  expect(parseKnowledgePageMarkdown(markdown).links.assetUsages).toEqual(expected);
  expect(recordAssetUsages(markdown)).toEqual(expected);
});
