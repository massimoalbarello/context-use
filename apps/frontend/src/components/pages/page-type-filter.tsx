import type { KnowledgePageKind } from '@repo/backend/page';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export type PageTypeFilterValue = KnowledgePageKind | 'all';

export function PageTypeFilter({
  value,
  onValueChange,
}: {
  value: PageTypeFilterValue;
  onValueChange: (value: PageTypeFilterValue) => void;
}) {
  return (
    <div className="grid gap-2">
      <p id="page-type-label" className="font-medium text-xs">
        Page type
      </p>
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList className="grid w-full grid-cols-3" aria-labelledby="page-type-label">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="semantic">Semantic</TabsTrigger>
          <TabsTrigger value="temporal">Temporal</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
