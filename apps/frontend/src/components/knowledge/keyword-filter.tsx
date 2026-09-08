import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export function KeywordFilter({
  inputId,
  value,
  placeholder,
  maxLength,
  autoFocus = false,
  onApply,
}: {
  inputId: string;
  value: string;
  placeholder: string;
  maxLength?: number;
  autoFocus?: boolean;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusKeywordInput(event: KeyboardEvent) {
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
      inputRef.current?.focus();
      inputRef.current?.select();
    }

    window.addEventListener('keydown', focusKeywordInput);
    return () => window.removeEventListener('keydown', focusKeywordInput);
  }, []);

  return (
    <form
      className="grid gap-2 rounded-xl bg-muted/55 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
    >
      <label className="font-medium text-xs" htmlFor={inputId}>
        Keyword
      </label>
      <div className="flex items-center gap-2">
        <span className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            id={inputId}
            className="h-10 pl-9"
            type="search"
            aria-keyshortcuts="Meta+K"
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus={autoFocus}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </span>
        <Button type="submit" size="sm" className="h-10 shrink-0" disabled={draft.trim() === value}>
          Apply
        </Button>
      </div>
      {(draft || value) && (
        <Button
          className="justify-self-end"
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft('');
            onApply('');
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}
