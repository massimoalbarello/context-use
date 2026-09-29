import type { ReactNode } from 'react';

export function entityInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase() || '?';
}

export function InlineEntity({
  name,
  imageUrl,
  avatar,
  children,
}: {
  name: string;
  imageUrl?: string | null;
  avatar?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <span className="relative mx-0.5 inline-block rounded-full bg-muted py-0.5 pr-2 pl-[2.0625rem] align-baseline font-medium text-foreground transition group-hover/entity:bg-accent">
      <span
        className="absolute top-1/2 left-[0.3125rem] flex size-6 -translate-y-1/2 items-center justify-center rounded-full font-semibold text-muted-foreground text-xs"
        aria-hidden="true"
      >
        {avatar ??
          (imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="m-0 block size-full max-w-none rounded-full object-cover"
            />
          ) : (
            entityInitial(name)
          ))}
      </span>
      <span>{children ?? name}</span>
    </span>
  );
}
