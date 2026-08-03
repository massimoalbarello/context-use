import { z } from "zod";

/**
 * The provider-agnostic contract consumed by the downstream pipeline.
 *
 * Provider-specific identity and context belong in `body`, not in the JSON
 * envelope. `id` is the sole exception because Nango requires it for record
 * identity and updates.
 */
export const PipelineRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  participants: z.array(z.string().min(1)),
  body: z.string().min(1),
});

export type PipelineRecord = z.infer<typeof PipelineRecordSchema>;
