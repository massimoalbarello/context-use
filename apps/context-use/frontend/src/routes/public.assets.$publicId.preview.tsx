import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { AssetPreviewFallback } from '../components/assets/asset-preview-fallback';
import { publicPdfQueryOptions } from '../queries/public-asset-preview';

export const Route = createFileRoute('/public/assets/$publicId/preview')({
  component: PublicAssetPreview,
});

const PdfPreview = lazy(async () => {
  const { createPdfPreview } = await import('../components/assets/pdf-preview');
  return { default: createPdfPreview() };
});

function PublicAssetPreview() {
  const { publicId } = Route.useParams();
  const content = useQuery(publicPdfQueryOptions(publicId));
  if (content.error) {
    return <AssetPreviewFallback message={content.error.message} />;
  }
  return content.data ? (
    <Suspense fallback={<p role="status">Loading PDF…</p>}>
      <PdfPreview bytes={content.data} name="PDF" />
    </Suspense>
  ) : (
    <p role="status">Loading PDF…</p>
  );
}
