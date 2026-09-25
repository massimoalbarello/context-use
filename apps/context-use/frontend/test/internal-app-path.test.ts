import { describe, expect, test } from 'bun:test';
import { internalAppPath } from '../src/lib/internal-app-path';

describe('internalAppPath', () => {
  test('preserves an application path with its query and fragment', () => {
    expect(internalAppPath('/app/pages/context-portability?view=links#sources')).toBe(
      '/app/pages/context-portability?view=links#sources',
    );
  });

  test.each([
    'https://example.com/pages',
    '//example.com/pages',
    '/\\example.com/pages',
    'javascript:alert(1)',
    'pages/context-portability',
    '',
    undefined,
  ])('rejects a redirect outside the application: %s', (value) => {
    expect(internalAppPath(value)).toBeUndefined();
  });
});
