import { useEffect, useRef, useState } from 'react';
import logoUrl from '../src/assets/context-use.svg';
import { createRenderer } from './renderer';

export function Playground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = createRenderer({ canvas, onStatus: setStatus });
    return renderer.dispose;
  }, []);

  return (
    <main className="playground" data-status={status}>
      <canvas
        ref={canvasRef}
        aria-label="Illuminated Context Use logo. Drag horizontally or vertically to draw colored light. Reload to start over."
      />
      {status !== 'ready' && (
        <div className="fallback">
          <span style={{ maskImage: `url("${logoUrl}")` }} />
          <p role="status">{status === 'loading' ? 'Lighting up…' : status}</p>
        </div>
      )}
      <header>
        context use<span>light playground</span>
      </header>
      {status === 'ready' && (
        <p className="hint">
          Drag to draw light<span>Reload to start over</span>
        </p>
      )}
    </main>
  );
}
