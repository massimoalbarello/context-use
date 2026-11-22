import { z } from 'zod';
import { SearchHypermediaOutputSchema } from '../hypermedia-retrieval/model.ts';

export const WIDGET_RESOURCE_TYPES = ['knowledge_page', 'entity', 'asset'] as const;
export const WidgetSearchSchema = SearchHypermediaOutputSchema.extend({
  query: z.string(),
  resourceType: z.enum(WIDGET_RESOURCE_TYPES).optional(),
});
