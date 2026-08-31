import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceArchiveButton } from '../../src/components/knowledge/resource-archive-button';

test('a resource with inbound usages cannot invoke archive', () => {
  const html = renderToStaticMarkup(
    <ResourceArchiveButton blocked pending={false} onClick={() => undefined} />,
  );

  expect(html).toContain('disabled=""');
  expect(html).toContain('Remove every active inbound relationship before archiving.');
  expect(html).toContain('>Archive</button>');
});
