import type { ReactNode } from 'react';
import { Eyebrow } from './eyebrow';

export function FormShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-5xl items-center gap-10 px-5 py-12 md:grid-cols-[minmax(0,0.85fr)_minmax(24rem,1fr)] md:px-8">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 font-semibold text-4xl tracking-tight">{title}</h1>
        <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{description}</p>
      </div>
      {children}
    </main>
  );
}
