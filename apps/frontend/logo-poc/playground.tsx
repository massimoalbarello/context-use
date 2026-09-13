import { AnimatedContextUseLogo } from '../src/components/brand/animated-context-use-logo';
import { type LogoPalette, PALETTES } from '../src/components/brand/light/palettes';

export function Playground({ palette }: { palette: LogoPalette }) {
  return (
    <main className="playground">
      <AnimatedContextUseLogo className="size-full" palette={palette} />
      <header>
        context use<span>{PALETTES[palette].label.toLowerCase()} light study</span>
      </header>
    </main>
  );
}
