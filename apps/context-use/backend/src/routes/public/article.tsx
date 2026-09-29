import { cn } from '@repo/ui/class-names';
import type { ReactNode } from 'react';

export function PublicArticle({ children }: { children: ReactNode }) {
  return (
    <article
      className={cn(
        'wrap-anywhere text-[1.0625rem] leading-[1.8]',
        '[:where(&_h1,&_h2,&_h3,&_h4,&_h5,&_h6)]:scroll-mt-6',
        '[:where(&_h1,&_h2,&_h3,&_h4,&_h5,&_h6)]:leading-[1.25]',
        '[:where(&_h1,&_h2,&_h3,&_h4,&_h5,&_h6)]:tracking-tight',
        '[:where(&_h1)]:mt-0 [:where(&_h1)]:mb-8 [:where(&_h1)]:text-[clamp(2rem,6vw,3rem)]',
        '[:where(&_h2)]:mt-10 [:where(&_h2)]:text-[1.65rem]',
        '[:where(&_h3,&_h4,&_h5,&_h6)]:mt-8',
        '[:where(&_p,&_ul,&_ol)]:my-5',
        '[:where(&_img)]:mx-auto [:where(&_img)]:my-6 [:where(&_img)]:block',
        '[:where(&_img)]:h-auto [:where(&_img)]:max-w-full [:where(&_img)]:rounded-[0.5rem]',
        '[:where(&_blockquote)]:mx-0 [:where(&_blockquote)]:my-6',
        '[:where(&_blockquote)]:border-l-[3px] [:where(&_blockquote)]:border-solid',
        '[:where(&_blockquote)]:border-[#c8c2b7] [:where(&_blockquote)]:pl-5',
        '[:where(&_blockquote)]:text-[#69655d] dark:[:where(&_blockquote)]:text-[#bbb5a9]',
        '[:where(&_code)]:rounded-[0.2rem] [:where(&_code)]:bg-[#eeeae2]',
        '[:where(&_code)]:px-[0.3em] [:where(&_code)]:py-[0.15em] [:where(&_code)]:text-[0.875em]',
        'dark:[:where(&_code)]:bg-[#302e29]',
        '[:where(&_pre)]:overflow-x-auto [:where(&_pre)]:rounded-[0.5rem]',
        '[:where(&_pre)]:bg-[#eeeae2] [:where(&_pre)]:p-5 [:where(&_pre)]:leading-[1.6]',
        'dark:[:where(&_pre)]:bg-[#302e29]',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[:where(&_hr)]:my-8 [:where(&_hr)]:border-0 [:where(&_hr)]:border-t',
        '[:where(&_hr)]:border-[#d7d1c6] [:where(&_hr)]:border-solid',
      )}
    >
      {children}
    </article>
  );
}
