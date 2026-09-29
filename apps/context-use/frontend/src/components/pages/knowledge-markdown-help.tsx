import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@repo/ui/button';
import { ChevronDown } from 'lucide-react';

export function KnowledgeMarkdownHelp() {
  return (
    <Collapsible.Root className="min-w-0 text-muted-foreground text-sm">
      <Collapsible.Trigger render={<Button variant="ghost" size="sm" />} className="group -ml-2">
        Writing and references
        <ChevronDown className="size-4 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div className="grid gap-3 pt-2">
          <p>
            Start with one <code># Page title</code>. Write paragraphs separated by blank lines, and
            use <code>## Section</code> or lower headings for linkable sections. Use{' '}
            <code>**bold**</code>, <code>*emphasis*</code>, and <code>- item</code> for lists.
          </p>
          <p>
            Type @ and choose an existing resource to insert its address. In{' '}
            <code>[visible label](address)</code>, the label stays in your sentence. You can change
            the label without changing the address. Entities are mentioned, pages and records are
            referenced, and assets are attached. External links use the same syntax with an HTTPS
            address.
          </p>
          <p>
            To embed an image, video, or PDF, insert its asset reference in a separate paragraph and
            add <code>!</code> before <code>[</code>. In <code>![description](asset address)</code>,
            the description is alternative text, not a visible sentence or caption. Keep the story
            and any caption outside the brackets; the asset appears where you place the embed.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-foreground text-xs">
            <code>{`The product was a proof of concept. It shaped our next steps.

![Demo showing the prototype](context-use://asset/prototype-demo)`}</code>
          </pre>
          <p>
            Replace the example address using @ to choose your own asset. Keep other file types as
            attachments. Before publishing, publish referenced pages, entities, and assets; records
            stay private and prevent publication of pages that reference them.
          </p>
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
