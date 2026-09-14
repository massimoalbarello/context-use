import { Button } from '@repo/ui/button';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '../ui/input';

export function KeywordFilter({
  inputId,
  value,
  placeholder,
  maxLength,
  onApply,
}: {
  inputId: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [appliedValue, setAppliedValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  if (appliedValue !== value) {
    setAppliedValue(value);
    setDraft(value);
  }

  function clearSearch() {
    setDraft('');
    onApply('');
  }

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
      if (!inputRef.current?.checkVisibility()) {
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
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {placeholder}
      </label>
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
          aria-keyshortcuts="Meta+K Enter Escape"
          enterKeyHint="search"
          placeholder={placeholder}
          maxLength={maxLength}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              clearSearch();
            }
          }}
        />
      </span>
      {(draft || value) && (
        <Button
          className="shrink-0"
          aria-label="Clear search"
          type="button"
          size="sm"
          variant="ghost"
          onClick={clearSearch}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}
