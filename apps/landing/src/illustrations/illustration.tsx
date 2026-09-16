import { type ReactNode, useEffect, useRef, useState } from 'react';

const VISIBLE_FRACTION = 0.25;

export function Illustration({
  children,
  description,
  name,
}: {
  children: ReactNode;
  description: string;
  name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    let inView = false;
    const updateVisibility = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= VISIBLE_FRACTION);
        updateVisibility();
      },
      { threshold: VISIBLE_FRACTION },
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`feature-illustration ${name}`}
      role="img"
      aria-label={description}
      data-visible={visible}
    >
      <div className="illustration-canvas" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
