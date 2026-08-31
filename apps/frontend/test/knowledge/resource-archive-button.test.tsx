import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceArchiveButton } from '../../src/components/knowledge/resource-archive-button';

test('archive remains actionable so a conflict can be explained after interaction', () => {
  const html = renderToStaticMarkup(
    <ResourceArchiveButton pending={false} onClick={() => undefined} />,
  );

  expect(html).not.toContain('disabled=""');
  expect(html).toContain('>Archive</button>');
});
