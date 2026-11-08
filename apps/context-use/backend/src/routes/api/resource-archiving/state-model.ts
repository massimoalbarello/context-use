import { t } from 'elysia';
import { RESOURCE_STATUSES } from '#backend/models/resource-archiving/model.ts';

export const ResourceStatusSchema = t.UnionEnum(RESOURCE_STATUSES, { default: undefined });
export const ResourceReadQuerySchema = t.Object({ includeArchived: t.Optional(t.Boolean()) });
export const ArchivedAtSchema = t.Nullable(t.Date());
