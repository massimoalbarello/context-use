import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
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
    inputRef.current?.focus({ preventScroll: true });
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
      className="@container relative flex min-w-0 flex-1 items-center"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {placeholder}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 @min-[10rem]:block hidden size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        id={inputId}
        className={cn(
          'h-10 @min-[10rem]:pl-9 pl-2.5 [&::-webkit-search-cancel-button]:appearance-none',
          (draft || value) && 'pr-9',
        )}
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
      {(draft || value) && (
        <Button
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
          aria-label="Clear search"
          type="button"
          size="icon"
          variant="ghost"
          onClick={clearSearch}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}
