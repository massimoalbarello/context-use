import { type ReactNode, useEffect, useRef, useState } from 'react';

export function DeferredAsset({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || visible) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: marker.closest('[data-collection-scroll], [data-resource-scroll]'),
        rootMargin: '160px 0px',
      },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div className={`${className ?? 'markdown-asset'} empty:hidden`} ref={markerRef}>
      {visible ? children : <AssetEmbedPlaceholder />}
    </div>
  );
}
export function AssetEmbedPlaceholder() {
  return (
    <div
      className="flex aspect-video items-center justify-center rounded-xl bg-muted text-muted-foreground text-sm"
      role="status"
    >
      Loading media…
    </div>
  );
}
