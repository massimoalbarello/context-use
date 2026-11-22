import type { ComponentProps } from 'react';
import { Textarea } from '../ui/textarea';

export function PageMarkdownTextarea(props: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      rows={12}
      spellCheck
      className="block min-h-64 resize-y font-mono leading-relaxed md:min-h-72"
      {...props}
    />
  );
}
