import { expect, spyOn, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { AssetFileActions } from '../../src/components/assets/asset-file-actions';
import { AssetMedia } from '../../src/components/assets/asset-media';
import { assetDocumentQueryOptions, MAX_DOCUMENT_PREVIEW_BYTES } from '../../src/queries/assets';

const asset = { readableId: 'sample-file', name: 'Sample file', mediaType: 'text/plain' };

function preview({
  mediaType,
  response = new Response('Hello'),
}: {
  mediaType: string;
  response?: Response;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(response);
  const view = render(
    <QueryClientProvider client={client}>
      <AssetMedia asset={{ ...asset, mediaType }} className="preview" />
      <AssetFileActions readableId={asset.readableId} />
    </QueryClientProvider>,
  );
  return {
    view,
    client,
    dispose() {
      cleanup();
      client.clear();
      fetch.mockRestore();
    },
  };
}

test('text is visible and markup stays inert', async () => {
  const { view, dispose, client } = preview({
    mediaType: 'text/plain',
    response: new Response('<script>alert(1)</script>\nChecklist'),
  });
  try {
    expect(await view.findByText('<script>alert(1)</script> Checklist')).toBeTruthy();
    expect(view.container.querySelector('script')).toBeNull();
    const bytes = await client.fetchQuery(assetDocumentQueryOptions(asset.readableId));
    expect(bytes.buffer.resizable).toBe(false);
    expect(new TextDecoder().decode(bytes)).toBe('<script>alert(1)</script>\nChecklist');
    expect(view.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/assets/sample-file/content?download=true',
    );
  } finally {
    dispose();
  }
});

test('CSV previews preserve quoted commas and multiline cells', async () => {
  const { view, dispose } = preview({
    mediaType: 'text/csv',
    response: new Response('name,note\n"Phone, first","Line one\nLine two"'),
  });
  try {
    expect(await view.findByRole('table', { name: 'Sample file' })).toBeTruthy();
    expect(view.getByRole('cell', { name: 'Phone, first' })).toBeTruthy();
    expect(view.getByRole('cell', { name: /Line one\s+Line two/ })).toBeTruthy();
  } finally {
    dispose();
  }
});

test('unsupported documents and failed requests offer a usable download fallback', async () => {
  for (const mediaType of [
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]) {
    const { view, dispose } = preview({
      mediaType,
      response: new Response('Unavailable', { status: 404 }),
    });
    try {
      expect(
        await view.findByText('Download the file to open it in a compatible app.'),
      ).toBeTruthy();
      expect(view.getByRole('link', { name: 'Download' })).toBeTruthy();
    } finally {
      dispose();
    }
  }
});

test('broken images have a visible fallback and selecting another asset resets it', () => {
  const { view, dispose } = preview({ mediaType: 'image/png' });
  try {
    fireEvent.error(view.getByRole('img', { name: 'Sample file' }));
    expect(view.getByText('This file could not be previewed.')).toBeTruthy();
    view.rerender(
      <AssetMedia
        asset={{ ...asset, readableId: 'another-image', mediaType: 'image/png' }}
        className="preview"
      />,
    );
    expect(view.getByRole('img', { name: 'Sample file' })).toBeTruthy();
  } finally {
    dispose();
  }
});

test('video playback failures stay actionable', () => {
  const { view, dispose } = preview({ mediaType: 'video/mp4' });
  try {
    const video = view.getByLabelText('Sample file');
    expect(video.getAttribute('src')).toBe('/api/assets/sample-file/content');
    expect(video.hasAttribute('controls')).toBe(true);
    fireEvent.error(video);
    expect(view.getByText('This file could not be previewed.')).toBeTruthy();
    expect(view.getByRole('link', { name: 'Download' })).toBeTruthy();
  } finally {
    dispose();
  }
});

test('oversized document responses stop at the preview limit and retain download access', async () => {
  const { view, dispose } = preview({
    mediaType: 'text/plain',
    response: new Response(new Uint8Array(MAX_DOCUMENT_PREVIEW_BYTES + 1)),
  });
  try {
    expect(await view.findByText('This file is too large to preview.')).toBeTruthy();
    expect(view.getByRole('link', { name: 'Download' })).toBeTruthy();
  } finally {
    dispose();
  }
});
