import { z } from 'zod';
import { McpKnowledgePageSummarySchema } from '../pages/model.ts';
import { McpEntitySchema } from './model.ts';
export const McpEntityDetailSchema = McpEntitySchema.extend({
  pages: z.array(McpKnowledgePageSummarySchema),
});
