import { ListFilter } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useId, useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export function KnowledgeFilterPopover({
  title,
  filtered,
  children,
  side = 'bottom',
  align = 'end',
}: {
  title: string;
  filtered: boolean;
  children: ReactNode;
  side?: ComponentProps<typeof PopoverContent>['side'];
  align?: ComponentProps<typeof PopoverContent>['align'];
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  useEffect(() => {
    function openKeywordFilter(event: KeyboardEvent) {
      if (
        event.key.toLocaleLowerCase() !== 'k' ||
        !event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener('keydown', openKeywordFilter);
    return () => window.removeEventListener('keydown', openKeywordFilter);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            variant={filtered ? 'secondary' : 'outline'}
            aria-label={title}
            title={title}
          />
        }
      >
        <ListFilter aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="max-h-[min(var(--available-height),calc(100dvh-1rem))] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto p-3"
      >
        <section aria-labelledby={headingId}>
          <h2 id={headingId} className="font-medium text-sm">
            {title}
          </h2>
          <div className="mt-3 grid gap-3">{children}</div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
