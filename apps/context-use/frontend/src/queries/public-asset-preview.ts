import { queryOptions } from '@tanstack/react-query';
import { documentPreviewBytes } from '../lib/document-preview';

export function publicPdfQueryOptions(publicId: string) {
  return queryOptions({
    queryKey: ['public-pdf', publicId],
    queryFn: async ({ signal }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(publicId)) {
        throw new Error('This PDF is unavailable.');
      }
      const response = await fetch(`/public/assets/${encodeURIComponent(publicId)}`, {
        signal,
        credentials: 'omit',
      });
      if (response.ok && response.headers.get('content-type') !== 'application/pdf') {
        throw new Error('This file is not a PDF.');
      }
      return documentPreviewBytes(response);
    },
    retry: false,
  });
}
