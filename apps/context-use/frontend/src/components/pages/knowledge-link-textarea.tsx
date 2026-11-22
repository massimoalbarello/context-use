import { Button } from '@repo/ui/button';
import { cn } from '@repo/ui/class-names';
import { Popover, PopoverContent } from '@repo/ui/popover';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import getCaretCoordinates from 'textarea-caret';
import type { KnowledgeSuggestion } from '../../queries/knowledge-suggestions';
import { AssetCardContent } from '../assets/asset-link';
import { EntityCardContent } from '../entities/entity-link';
import { resourceCardVariants } from '../knowledge/resource-list';
import { RecordCardContent } from '../records/record-link';
import { Badge } from '../ui/badge';
import {
  type ActiveKnowledgeLink,
  findActiveKnowledgeLink,
  insertKnowledgeLink,
  type KnowledgeLinkTarget,
} from './knowledge-link';
import { KnowledgePageCardContent } from './knowledge-page-card-content';
import type { MarkdownInputProps } from './page-form';
import { PageMarkdownTextarea } from './page-markdown-textarea';

function suggestionId(suggestion: KnowledgeSuggestion): string {
  if (suggestion.kind === 'entity') {
    return `entity-${suggestion.entity.readableId}`;
  }
  if (suggestion.kind === 'record') {
    return `record-${suggestion.record.readableId}`;
  }
  return suggestion.kind === 'page'
    ? `page-${suggestion.page.readableId}`
    : `asset-${suggestion.asset.readableId}`;
}

const SUGGESTION_LABELS = {
  entity: 'Entity',
  page: 'Page',
  asset: 'Asset',
  record: 'Record',
} as const;

type PickerBounds = Pick<DOMRect, 'top' | 'bottom'>;

export function scrollPickerOptionIntoView(options: {
  menu: { scrollTop: number; getBoundingClientRect: () => PickerBounds };
  option: { getBoundingClientRect: () => PickerBounds };
}) {
  const menuBounds = options.menu.getBoundingClientRect();
  const optionBounds = options.option.getBoundingClientRect();
  if (optionBounds.top < menuBounds.top) {
    options.menu.scrollTop -= menuBounds.top - optionBounds.top;
  } else if (optionBounds.bottom > menuBounds.bottom) {
    options.menu.scrollTop += optionBounds.bottom - menuBounds.bottom;
  }
}

function pickerStatus({
  loading,
  error,
  count,
  truncated,
  totalMatches,
}: {
  loading: boolean;
  error: Error | null;
  count: number;
  truncated: boolean;
  totalMatches: number;
}): string {
  if (loading) {
    return 'Searching all resources…';
  }
  if (error) {
    return 'Couldn’t search resources. Try again.';
  }
  if (count === 0) {
    return 'No matching resources. Try another search.';
  }
  if (truncated) {
    return `Showing ${count} of ${totalMatches} matches. Keep typing to narrow your search.`;
  }
  return `${count} matching ${count === 1 ? 'resource' : 'resources'}.`;
}

export function KnowledgeLinkTextarea({
  id,
  name,
  value,
  suggestions: results,
  loading,
  error,
  totalMatches,
  truncated,
  onRetry,
  invalid,
  onBlur,
  onChange,
  onQueryChange,
}: MarkdownInputProps & {
  suggestions: KnowledgeSuggestion[];
  loading: boolean;
  error: Error | null;
  totalMatches: number;
  truncated: boolean;
  onRetry: () => void;
  onQueryChange: (query: string | null) => void;
}) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<ActiveKnowledgeLink | null>(null);
  const [scrollOffset, setScrollOffset] = useState({ left: 0, top: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestionsOpen = Boolean(link?.query.trim());
  const suggestions = suggestionsOpen && !loading && !error ? results : [];
  const activeSuggestion = suggestions[activeIndex] ?? suggestions[0];
  const activeOptionId = activeSuggestion
    ? `${listId}-${suggestionId(activeSuggestion)}`
    : undefined;
  const caretAnchor = useMemo(() => {
    const textarea = textareaRef.current;
    if (!textarea || !link) {
      return null;
    }
    return {
      contextElement: textarea,
      getBoundingClientRect() {
        const bounds = textarea.getBoundingClientRect();
        const caret = getCaretCoordinates(textarea, link.end);
        return new DOMRect(
          bounds.left + caret.left - scrollOffset.left,
          bounds.top + caret.top - scrollOffset.top,
          0,
          caret.height,
        );
      },
    };
  }, [link, scrollOffset]);

  useEffect(() => {
    const menu = menuRef.current;
    const option = activeOptionId ? document.getElementById(activeOptionId) : null;
    if (menu && option) {
      scrollPickerOptionIntoView({ menu, option });
    }
  }, [activeOptionId]);

  function updateLink({ markdown, cursor }: { markdown: string; cursor: number }) {
    const nextLink = findActiveKnowledgeLink({ markdown, cursor });
    setLink(nextLink);
    onQueryChange(nextLink?.query ?? null);
    setActiveIndex(0);
  }

  function selectSuggestion(suggestion: KnowledgeSuggestion) {
    if (!link) {
      return;
    }
    const target: KnowledgeLinkTarget = suggestion;
    const insertion = insertKnowledgeLink({ markdown: value, link, target });
    onChange(insertion.markdown);
    setLink(null);
    onQueryChange(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  return (
    <fieldset
      className="relative min-w-0"
      aria-label="Knowledge editor"
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !popupRef.current?.contains(event.relatedTarget)
        ) {
          setLink(null);
          onQueryChange(null);
        }
      }}
    >
      <PageMarkdownTextarea
        ref={textareaRef}
        id={id}
        name={name}
        value={value}
        onBlur={onBlur}
        onScroll={(event) =>
          setScrollOffset({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          })
        }
        onChange={(event) => {
          const { value: markdown, selectionStart: cursor } = event.currentTarget;
          onChange(markdown);
          updateLink({ markdown, cursor });
        }}
        onFocus={(event) =>
          updateLink({
            markdown: event.currentTarget.value,
            cursor: event.currentTarget.selectionStart,
          })
        }
        onSelect={(event) =>
          updateLink({
            markdown: event.currentTarget.value,
            cursor: event.currentTarget.selectionStart,
          })
        }
        onKeyDown={(event) => {
          if (!suggestionsOpen) {
            return;
          }
          switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
              event.preventDefault();
              const count = Math.max(1, suggestions.length);
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              setActiveIndex((index) => (index + direction + count) % count);
              break;
            }
            case 'Escape':
              event.preventDefault();
              setLink(null);
              onQueryChange(null);
              break;
            case 'Enter':
            case 'Tab':
              if (activeSuggestion) {
                event.preventDefault();
                selectSuggestion(activeSuggestion);
              } else if (event.key === 'Tab' && !event.shiftKey && error) {
                event.preventDefault();
                retryRef.current?.focus();
              }
              break;
          }
        }}
        aria-autocomplete="list"
        aria-label="Knowledge page content"
        aria-controls={suggestionsOpen ? listId : undefined}
        aria-expanded={suggestionsOpen}
        aria-activedescendant={activeOptionId}
        aria-haspopup="listbox"
        aria-invalid={invalid}
        role="combobox"
      />
      <Popover
        open={suggestionsOpen}
        // biome-ignore lint/complexity/useMaxParams: Base UI provides the open state and event details separately.
        onOpenChange={(open, details) => {
          if (details.event.target === textareaRef.current) {
            details.cancel();
          } else if (!open) {
            setLink(null);
            onQueryChange(null);
          }
        }}
      >
        <PopoverContent
          ref={popupRef}
          anchor={caretAnchor}
          align="start"
          positionMethod="fixed"
          initialFocus={false}
          finalFocus={false}
          role="presentation"
          className="flex max-h-(--available-height) w-xl max-w-(--available-width) flex-col p-1"
        >
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-muted-foreground text-xs">
            <p role="status">
              {pickerStatus({
                loading,
                error,
                count: suggestions.length,
                truncated,
                totalMatches,
              })}
            </p>
            {error && (
              <Button
                ref={retryRef}
                type="button"
                variant="ghost"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  textareaRef.current?.focus();
                  onRetry();
                }}
              >
                Try again
              </Button>
            )}
          </div>
          <div
            ref={menuRef}
            className="grid max-h-64 min-h-0 gap-1 overflow-y-auto"
            id={listId}
            role="listbox"
            aria-label="Knowledge"
            aria-busy={loading}
          >
            {suggestions.map((suggestion) => {
              const optionId = suggestionId(suggestion);
              return (
                <Button
                  variant="ghost"
                  className={cn(resourceCardVariants(), 'w-full justify-between text-sm')}
                  id={`${listId}-${optionId}`}
                  key={optionId}
                  type="button"
                  role="option"
                  aria-selected={optionId === (activeSuggestion && suggestionId(activeSuggestion))}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {suggestion.kind === 'entity' ? (
                    <EntityCardContent entity={suggestion.entity} />
                  ) : suggestion.kind === 'page' ? (
                    <KnowledgePageCardContent page={suggestion.page} />
                  ) : suggestion.kind === 'record' ? (
                    <RecordCardContent record={suggestion.record} />
                  ) : (
                    <AssetCardContent asset={suggestion.asset} />
                  )}
                  <Badge
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-[0.65rem] uppercase tracking-wider"
                  >
                    {SUGGESTION_LABELS[suggestion.kind]}
                  </Badge>
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </fieldset>
  );
}
