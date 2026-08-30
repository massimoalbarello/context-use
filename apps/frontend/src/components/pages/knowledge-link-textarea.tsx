import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { EntitySummary } from '../../queries/entities';
import type { KnowledgePageSummary } from '../../queries/pages';
import { EntityCardContent } from '../entities/entity-link';
import { resourceCardVariants } from '../knowledge/resource-list';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  type ActiveKnowledgeLink,
  findActiveKnowledgeLink,
  insertKnowledgeLink,
  type KnowledgeLinkTarget,
} from './knowledge-link';
import { KnowledgePageCardContent } from './knowledge-page-link';

type KnowledgeSuggestion =
  | { kind: 'entity'; entity: EntitySummary }
  | { kind: 'page'; page: KnowledgePageSummary };

function suggestionId(suggestion: KnowledgeSuggestion): string {
  return suggestion.kind === 'entity'
    ? `entity-${suggestion.entity.id}`
    : `page-${suggestion.page.id}`;
}

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

export function KnowledgeLinkTextarea({
  id,
  name,
  value,
  entities,
  pages,
  invalid,
  onBlur,
  onChange,
  onQueryChange,
}: {
  id: string;
  name: string;
  value: string;
  entities: EntitySummary[];
  pages: KnowledgePageSummary[];
  invalid: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  onQueryChange: (query: string | null) => void;
}) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [link, setLink] = useState<ActiveKnowledgeLink | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions: KnowledgeSuggestion[] = link
    ? [
        ...entities.map((entity) => ({ kind: 'entity' as const, entity })),
        ...pages.map((page) => ({ kind: 'page' as const, page })),
      ]
    : [];
  const suggestionsOpen = suggestions.length > 0;
  const activeSuggestion = suggestions[activeIndex] ?? suggestions[0];
  const activeOptionId = activeSuggestion
    ? `${listId}-${suggestionId(activeSuggestion)}`
    : undefined;

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
    const target: KnowledgeLinkTarget =
      suggestion.kind === 'entity'
        ? { kind: 'entity', entity: suggestion.entity }
        : { kind: 'page', page: suggestion.page };
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
    <div className="relative">
      <Textarea
        ref={textareaRef}
        id={id}
        name={name}
        rows={12}
        value={value}
        onBlur={() => {
          onBlur();
          setLink(null);
          onQueryChange(null);
        }}
        onChange={(event) => {
          const markdown = event.target.value;
          onChange(markdown);
          updateLink({ markdown, cursor: event.target.selectionStart });
        }}
        onFocus={(event) =>
          updateLink({ markdown: value, cursor: event.currentTarget.selectionStart })
        }
        onSelect={(event) =>
          updateLink({ markdown: value, cursor: event.currentTarget.selectionStart })
        }
        onKeyDown={(event) => {
          if (!suggestionsOpen) {
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setLink(null);
            onQueryChange(null);
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            if (activeSuggestion) {
              selectSuggestion(activeSuggestion);
            }
          }
        }}
        aria-autocomplete="list"
        aria-controls={suggestionsOpen ? listId : undefined}
        aria-expanded={suggestionsOpen}
        aria-activedescendant={activeOptionId}
        aria-haspopup="listbox"
        aria-invalid={invalid}
        role="combobox"
        spellCheck
        className="block min-h-64 resize-y font-mono leading-relaxed md:min-h-72"
      />
      {suggestionsOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-3 left-3 z-10 grid max-h-72 w-[calc(100%-1.5rem)] max-w-xl gap-1 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          id={listId}
          role="listbox"
          aria-label="Knowledge"
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
                ) : (
                  <KnowledgePageCardContent page={suggestion.page} />
                )}
                <Badge
                  variant="outline"
                  className="h-6 shrink-0 px-2 text-[0.65rem] uppercase tracking-wider"
                >
                  {suggestion.kind === 'entity' ? 'Entity' : 'Page'}
                </Badge>
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
