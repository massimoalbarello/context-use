import { useId, useRef, useState } from 'react';
import type { EntitySummary } from '../../queries/entities';
import {
  type ActiveEntityMention,
  findActiveEntityMention,
  insertEntityMention,
} from './entity-mention';

const MAX_SUGGESTIONS = 7;

export function EntityMentionTextarea({
  id,
  name,
  value,
  entities,
  invalid,
  onBlur,
  onChange,
}: {
  id: string;
  name: string;
  value: string;
  entities: EntitySummary[];
  invalid: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<ActiveEntityMention | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = mention?.query.trim().toLocaleLowerCase() ?? '';
  const suggestions = mention
    ? entities
        .filter(
          (entity) =>
            !normalizedQuery ||
            entity.name.toLocaleLowerCase().includes(normalizedQuery) ||
            entity.readableId.toLocaleLowerCase().includes(normalizedQuery),
        )
        .slice(0, MAX_SUGGESTIONS)
    : [];
  const suggestionsOpen = suggestions.length > 0;
  const activeEntity = suggestions[activeIndex];

  function updateMention({ markdown, cursor }: { markdown: string; cursor: number }) {
    setMention(findActiveEntityMention({ markdown, cursor }));
    setActiveIndex(0);
  }

  function selectEntity(entity: EntitySummary) {
    if (!mention) {
      return;
    }
    const insertion = insertEntityMention({ markdown: value, mention, entity });
    onChange(insertion.markdown);
    setMention(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  return (
    <div className="mention-editor">
      <textarea
        ref={textareaRef}
        id={id}
        name={name}
        rows={12}
        value={value}
        onBlur={() => {
          onBlur();
          setMention(null);
        }}
        onChange={(event) => {
          const markdown = event.target.value;
          onChange(markdown);
          updateMention({ markdown, cursor: event.target.selectionStart });
        }}
        onFocus={(event) =>
          updateMention({ markdown: value, cursor: event.currentTarget.selectionStart })
        }
        onSelect={(event) =>
          updateMention({ markdown: value, cursor: event.currentTarget.selectionStart })
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
            setMention(null);
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const selectedEntity = suggestions[activeIndex] ?? suggestions[0];
            if (selectedEntity) {
              selectEntity(selectedEntity);
            }
          }
        }}
        aria-autocomplete="list"
        aria-controls={suggestionsOpen ? listId : undefined}
        aria-expanded={suggestionsOpen}
        aria-activedescendant={
          suggestionsOpen ? `${listId}-${suggestions[activeIndex]?.id}` : undefined
        }
        aria-haspopup="listbox"
        aria-invalid={invalid}
        role="combobox"
        spellCheck
        className="knowledge-editor font-mono"
      />
      {suggestionsOpen && (
        <div className="mention-menu" id={listId} role="listbox" aria-label="Entities">
          {suggestions.map((entity) => (
            <button
              id={`${listId}-${entity.id}`}
              key={entity.id}
              type="button"
              role="option"
              aria-selected={entity.id === activeEntity?.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectEntity(entity)}
            >
              <strong>{entity.name}</strong>
              <span>@{entity.readableId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
