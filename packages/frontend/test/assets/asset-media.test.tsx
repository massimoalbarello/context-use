import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssetMedia } from '../../src/components/assets/asset-media';

test('renders MP4 assets as playable video from the authenticated content route', () => {
  const html = renderToStaticMarkup(
    <AssetMedia
      asset={{
        readableId: 'factory-recording',
        name: 'Factory recording',
        mediaType: 'video/mp4',
      }}
      className="preview"
    />,
  );

  expect(html).toContain('<video');
  expect(html).toContain('controls=""');
  expect(html).toContain('preload="metadata"');
  expect(html).toContain('src="/api/assets/factory-recording/content"');
  expect(html).toContain('aria-label="Factory recording"');
});
