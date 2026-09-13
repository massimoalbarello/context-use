import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceArchiveAction } from '../../src/components/knowledge/resource-archive-action';

test('archive action remains available and opens a confirmation dialog', () => {
  const html = renderToStaticMarkup(
    <ResourceArchiveAction
      blocked={false}
      pending={false}
      resource="page"
      onBlocked={() => undefined}
      onConfirm={() => undefined}
    />,
  );

  expect(html).not.toContain('disabled=""');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('>Archive</button>');
});
