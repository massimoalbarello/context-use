import type { KnowledgePageIntervalFilter } from '#backend/models/knowledge-pages/model.ts';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export type PageIntervalFilterValue = KnowledgePageIntervalFilter | 'all';

export function PageIntervalFilter({
  value,
  onValueChange,
}: {
  value: PageIntervalFilterValue;
  onValueChange: (value: PageIntervalFilterValue) => void;
}) {
  return (
    <div className="grid gap-2">
      <p id="page-interval-label" className="font-medium text-xs">
        Interval
      </p>
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList className="grid w-full grid-cols-3" aria-labelledby="page-interval-label">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="without">Without</TabsTrigger>
          <TabsTrigger value="with">With</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
