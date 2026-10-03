import type { ComponentProps } from 'react';

export function MarkdownTable({ children }: ComponentProps<'table'>) {
  return (
    <section
      className="my-5 max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      aria-label="Table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide tables.
      tabIndex={0}
    >
      <table className="w-full border-collapse text-sm leading-6 [&_td]:min-w-32 [&_td]:border-border [&_td]:border-t [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:min-w-32 [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-3 [&_th]:align-top [&_th]:font-semibold">
        {children}
      </table>
    </section>
  );
}

function alignment(value: unknown) {
  return value === 'right' ? 'text-right' : value === 'center' ? 'text-center' : 'text-left';
}

export function MarkdownTableHeader({ children, style }: ComponentProps<'th'>) {
  return (
    <th scope="col" className={alignment(style?.textAlign)}>
      {children}
    </th>
  );
}

export function MarkdownTableCell({ children, style }: ComponentProps<'td'>) {
  return <td className={alignment(style?.textAlign)}>{children}</td>;
}
