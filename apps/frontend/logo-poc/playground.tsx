import { useEffect, useRef, useState } from 'react';
import logoUrl from '../src/assets/context-use.svg';
import type { Palette } from './palettes';
import { createRenderer } from './renderer';

export function Playground({ palette }: { palette: Palette }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = createRenderer({ canvas, palette, onStatus: setStatus });
    return renderer.dispose;
  }, [palette]);

  return (
    <main className="playground" data-status={status}>
      <canvas
        ref={canvasRef}
        aria-label={`Animated Context Use logo. White light radiates from the vertical strokes; ${palette.description} light radiates from the horizontal bars.`}
      />
      {status !== 'ready' && (
        <div className="fallback">
          <span style={{ maskImage: `url("${logoUrl}")` }} />
          <p role="status">{status === 'loading' ? 'Lighting up…' : status}</p>
        </div>
      )}
      <header>
        context use<span>{palette.label.toLowerCase()} light study</span>
      </header>
    </main>
  );
}
