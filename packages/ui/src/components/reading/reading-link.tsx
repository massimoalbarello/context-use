import { ArrowUpRight } from 'lucide-react';
import type { ComponentProps } from 'react';

export function isExternalLink({ href, origin }: { href?: string; origin?: string }): boolean {
  if (!href || href.startsWith('#')) {
    return false;
  }
  try {
    const url = new URL(href, origin);
    return (
      url.protocol === 'mailto:' ||
      ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin !== origin)
    );
  } catch {
    return false;
  }
}

export function ReadingLink({
  origin,
  href,
  children,
  target,
  rel,
  title,
  ...props
}: ComponentProps<'a'> & { origin?: string }) {
  const external = isExternalLink({ href, origin });
  return (
    <a
      {...props}
      href={href}
      target={external ? '_blank' : target}
      rel={external ? 'noopener noreferrer' : rel}
      title={external ? (title ? `${title} (opens in a new tab)` : 'Opens in a new tab') : title}
    >
      {children}
      {external && (
        <>
          <ArrowUpRight
            className="ml-[0.15em] inline size-[0.8em] align-baseline"
            aria-hidden="true"
          />
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </a>
  );
}
