import { type ReactNode, useEffect, useRef, useState } from 'react';

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
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
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
