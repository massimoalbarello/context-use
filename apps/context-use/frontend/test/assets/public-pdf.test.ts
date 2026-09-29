import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { publicPdfQueryOptions } from '../../src/queries/public-asset-preview';

test('PDF previews fetch only the public endpoint without owner credentials', async () => {
  const client = new QueryClient();
  const bytes = new TextEncoder().encode('%PDF-1.7');
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
  );
  try {
    expect(await client.fetchQuery(publicPdfQueryOptions('public-id'))).toEqual(bytes);
    expect(fetch).toHaveBeenCalledWith('/public/assets/public-id', {
      signal: expect.any(AbortSignal),
      credentials: 'omit',
    });
    await expect(client.fetchQuery(publicPdfQueryOptions('../private'))).rejects.toThrow(
      'unavailable',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    client.clear();
    fetch.mockRestore();
  }
});

test.each([
  { status: 404, mediaType: 'application/json', message: 'Could not load this file.' },
  { status: 200, mediaType: 'text/html', message: 'This file is not a PDF.' },
])(
  'PDF previews reject unavailable or non-PDF responses: $status $mediaType',
  async ({ status, mediaType, message }) => {
    const client = new QueryClient();
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unavailable', { status, headers: { 'content-type': mediaType } }),
    );
    try {
      await expect(client.fetchQuery(publicPdfQueryOptions('public-id'))).rejects.toThrow(message);
    } finally {
      client.clear();
      fetch.mockRestore();
    }
  },
);
