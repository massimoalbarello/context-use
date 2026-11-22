import { cn } from '@repo/ui/class-names';
import type { Components } from 'react-markdown';

export const markdownBodyComponents: Components = {
  p: ({ children }) => <p className="my-5 text-[1.05rem] leading-8">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-5 list-disc pl-6 text-[1.05rem] leading-8">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-5 list-decimal pl-6 text-[1.05rem] leading-8">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-5 border-border border-l-4 pl-5 text-[1.05rem] text-muted-foreground leading-8">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => (
    <code className={cn('rounded bg-muted px-1.5 py-0.5 font-mono text-sm', className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-foreground p-4 text-background [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
};
