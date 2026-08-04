import { z } from "zod";

export const AgentConversationRecordSchema = z.object({
  id: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  participants: z.array(z.string().min(1)),
  body: z.string().min(1),
}).strict();

export type AgentConversationRecord = z.infer<typeof AgentConversationRecordSchema>;
