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
    <span className="reading-entity">
      <span className="reading-entity-avatar" aria-hidden="true">
        {avatar ?? (imageUrl ? <img src={imageUrl} alt="" /> : entityInitial(name))}
      </span>
      <span>{children ?? name}</span>
    </span>
  );
}
