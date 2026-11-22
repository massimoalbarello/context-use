import type { ComponentProps } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

function MarkdownTable({ children }: ComponentProps<'table'>) {
  return (
    <div className="my-5 max-w-full rounded-lg border border-border">
      <Table className="border-collapse leading-6">{children}</Table>
    </div>
  );
}

function alignment(value: unknown) {
  return value === 'right' ? 'text-right' : value === 'center' ? 'text-center' : 'text-left';
}

function MarkdownTableHeader({ children, style }: ComponentProps<'th'>) {
  return (
    <TableHead
      scope="col"
      className={`min-w-32 whitespace-normal bg-muted/50 px-4 py-3 align-top font-semibold ${alignment(style?.textAlign)}`}
    >
      {children}
    </TableHead>
  );
}

function MarkdownTableCell({ children, style }: ComponentProps<'td'>) {
  return (
    <TableCell
      className={`min-w-32 whitespace-normal px-4 py-3 align-top ${alignment(style?.textAlign)}`}
    >
      {children}
    </TableCell>
  );
}

export const markdownTableComponents = {
  table: MarkdownTable,
  thead: ({ children }: ComponentProps<'thead'>) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }: ComponentProps<'tbody'>) => <TableBody>{children}</TableBody>,
  tr: ({ children }: ComponentProps<'tr'>) => (
    <TableRow className="hover:bg-transparent">{children}</TableRow>
  ),
  th: MarkdownTableHeader,
  td: MarkdownTableCell,
};
