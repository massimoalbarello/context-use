import { KeywordFilter } from './keyword-filter';
import { KnowledgeFilterPopover } from './knowledge-filter-popover';

export function CollectionKeywordFilter({
  title,
  query,
  inputId,
  placeholder,
  maxLength,
  onApply,
}: {
  title: string;
  query: string;
  inputId: string;
  placeholder: string;
  maxLength: number;
  onApply: (query: string) => void;
}) {
  return (
    <KnowledgeFilterPopover title={title} filtered={Boolean(query)}>
      <KeywordFilter
        key={query}
        inputId={inputId}
        value={query}
        placeholder={placeholder}
        maxLength={maxLength}
        onApply={onApply}
      />
    </KnowledgeFilterPopover>
  );
}
