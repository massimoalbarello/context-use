import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { AssetPreviewFallback } from '../components/assets/asset-preview-fallback';
import { PdfPreviewLoading } from '../components/assets/pdf-preview-loading';
import { publicPdfQueryOptions } from '../queries/public-asset-preview';

export const Route = createFileRoute('/pdf-preview/$publicId')({
  component: PublicPdfPreview,
});

const PdfPreview = lazy(async () => {
  const { createPdfPreview } = await import('../components/assets/pdf-preview');
  return { default: createPdfPreview() };
});

function PublicPdfPreview() {
  const dark = useSyncExternalStore(subscribeToTheme, isDarkTheme, () => false);
  return (
    <main className={`${dark ? 'dark' : ''} flex min-h-dvh flex-col bg-muted text-foreground`}>
      <PublicPdfContent />
    </main>
  );
}

function subscribeToTheme(onChange: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isDarkTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function PublicPdfContent() {
  const { publicId } = Route.useParams();
  const content = useQuery(publicPdfQueryOptions(publicId));
  if (content.error) {
    return <AssetPreviewFallback message={content.error.message} />;
  }
  return content.data ? (
    <Suspense fallback={<PdfPreviewLoading />}>
      <PdfPreview bytes={content.data} name="PDF" className="h-dvh" />
    </Suspense>
  ) : (
    <PdfPreviewLoading />
  );
}
