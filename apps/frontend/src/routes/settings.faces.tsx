import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { FaceSettingsForm } from '../components/faces/face-settings';
import { Button } from '../components/ui/button';
import { FieldError } from '../components/ui/field';
import { useRetryNextImage, useSaveFaceThreshold } from '../lib/hooks/use-faces';
import { faceSettingsQueryOptions } from '../queries/faces';

export const Route = createFileRoute('/settings/faces')({
  loader: ({ context }) => context.queryClient.ensureQueryData(faceSettingsQueryOptions),
  component: FaceSettingsRoute,
});

function FaceSettingsRoute() {
  const { data } = useSuspenseQuery(faceSettingsQueryOptions);
  const save = useSaveFaceThreshold();
  const retry = useRetryNextImage();
  const continuing = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [finished, setFinished] = useState(false);
  useEffect(
    () => () => {
      continuing.current = false;
    },
    [],
  );

  async function retryImages() {
    continuing.current = true;
    setScanning(true);
    setFinished(false);
    let after: string | null = null;
    try {
      while (continuing.current) {
        const result = await retry.mutateAsync(after);
        if (result.next === null) {
          setFinished(true);
          break;
        }
        after = result.next;
      }
    } catch {
      /* The mutation owns its recoverable error. */
    } finally {
      continuing.current = false;
      setScanning(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header className="grid gap-3">
        <h1 className="font-semibold text-3xl tracking-tight">Face recognition</h1>
        <p className="max-w-2xl text-muted-foreground">
          Find people in your images using their entity portraits. Images are analyzed on this
          Context Use instance.
        </p>
      </header>
      <FaceSettingsForm
        key={`${data.model.analysisVersion}/${data.threshold}`}
        settings={data}
        pending={save.isPending}
        error={save.error}
        onSave={(input) => save.mutate(input)}
      />
      {save.isSuccess && (
        <p role="status" className="text-muted-foreground text-sm">
          {save.variables.rematch
            ? 'Threshold saved and automatic matches updated.'
            : 'Threshold saved.'}
        </p>
      )}
      <section className="grid max-w-2xl gap-4" aria-labelledby="retry-images-heading">
        <h2 id="retry-images-heading" className="font-semibold text-xl">
          Process existing images
        </h2>
        <p className="text-muted-foreground text-sm">
          Retry failed or unprocessed images and update images analyzed by an older model. Your
          originals and corrections are preserved. JPEG, PNG, and WebP images up to 20 MB and 16
          megapixels are supported.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" disabled={scanning} onClick={() => void retryImages()}>
            {scanning ? 'Processing images…' : 'Process images'}
          </Button>
          {scanning && (
            <Button
              variant="ghost"
              onClick={() => {
                continuing.current = false;
              }}
            >
              Stop after this image
            </Button>
          )}
        </div>
        {retry.error && <FieldError>{retry.error.message}</FieldError>}
        {finished && (
          <p role="status" className="text-muted-foreground text-sm">
            Image scan complete. Any images that could not be analyzed remain available to retry.
          </p>
        )}
      </section>
    </div>
  );
}
