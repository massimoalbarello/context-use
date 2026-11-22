import type { ComponentProps } from 'react';
export function AssetImage({ alt, ...props }: ComponentProps<'img'> & { alt: string }) {
  return <img alt={alt} decoding="async" style={{ aspectRatio: 'auto 16 / 9' }} {...props} />;
}
