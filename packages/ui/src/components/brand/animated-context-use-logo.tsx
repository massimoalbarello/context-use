import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/class-names';
import { ContextUseLogo } from './context-use-logo';
import { type LogoPalette, PALETTES } from './light/palettes';
import type { RendererStatus } from './light/renderer';

export function AnimatedContextUseLogo({
  className,
  palette = 'sand',
}: {
  className?: string;
  palette?: LogoPalette;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<RendererStatus>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    setStatus('loading');
    if (!navigator.gpu) {
      setStatus('unavailable');
      return;
    }

    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import('./light/renderer')
      .then(({ createRenderer }) => {
        if (!cancelled) {
          dispose = createRenderer({
            canvas,
            palette: PALETTES[palette],
            onStatus: setStatus,
          }).dispose;
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('Context Use logo lighting:', error);
          setStatus('unavailable');
        }
      });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [palette]);

  return (
    <div
      aria-hidden="true"
      data-light-state={status}
      className={cn('relative isolate aspect-square overflow-hidden bg-[#050608]', className)}
    >
      {/* Keep the canvas visible so the first reduced-motion frame can be presented. */}
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 bg-inherit">
          <div className="absolute inset-[24%]">
            <ContextUseLogo className="block size-full text-[#b5b9c5]" />
          </div>
        </div>
      )}
    </div>
  );
}
