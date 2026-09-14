import { cn } from '@repo/ui/class-names';
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect, useRef } from 'react';

export function ResourceScrollArea({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  const location = useRouterState({ select: (state) => state.location });

  useEffect(() => {
    const element = area.current;
    const { hash } = location;
    if (!element || !hash) {
      return;
    }
    function revealSection() {
      const target = element?.querySelector<HTMLElement>(`#${CSS.escape(hash)}`);
      if (!target?.checkVisibility()) {
        return false;
      }
      target.scrollIntoView({ block: 'start' });
      return true;
    }
    if (revealSection()) {
      return;
    }
    const observer = new MutationObserver(() => {
      if (revealSection()) {
        observer.disconnect();
      }
    });
    observer.observe(element, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [location]);

  return (
    <div ref={area} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}>
      {children}
    </div>
  );
}
