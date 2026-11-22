import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DuplicateResourceNameError } from '../../lib/api-error';
import { knowledgeSuggestionsQueryOptions } from '../../queries/knowledge-suggestions';
import { FieldDescription } from '../ui/field';
import { KnowledgeLinkTextarea } from './knowledge-link-textarea';
import { type MarkdownInputProps, PageForm, type PageFormLayout } from './page-form';

export type { KnowledgePageFormValues } from './page-form';

function MarkdownInput(props: MarkdownInputProps) {
  const [query, setQuery] = useState<string | null>(null);
  const suggestions = useQuery(knowledgeSuggestionsQueryOptions(query ?? ''));
  return (
    <>
      <span className="sr-only">Knowledge page content</span>
      <KnowledgeLinkTextarea
        {...props}
        suggestions={suggestions.data?.suggestions ?? []}
        loading={suggestions.isPending}
        error={suggestions.error}
        totalMatches={suggestions.data?.totalMatches ?? 0}
        truncated={suggestions.data?.truncated ?? false}
        onRetry={() => void suggestions.refetch()}
        onQueryChange={setQuery}
      />
      <FieldDescription>
        Keep one coherent idea here. Type @ to mention an entity, reference a page or record, or use
        an asset; use H2 or lower headings for linkable sections.
      </FieldDescription>
    </>
  );
}

type WebPageFormProps = PageFormLayout & { error: Error | null };

export function KnowledgePageForm({ error, ...props }: WebPageFormProps) {
  return (
    <PageForm
      {...props}
      error={error?.message}
      duplicateTitle={!!props.submitLabel && error instanceof DuplicateResourceNameError}
      markdownInput={(input) => <MarkdownInput {...input} />}
    />
  );
}
