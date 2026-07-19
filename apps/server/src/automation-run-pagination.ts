import { AutomationValidationError, type CompletedAutomationRunCursor } from "@context-use/database";
import { z } from "zod";

const cursorSchema = z.object({
  completed_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

export function encodeCompletedRunCursor(cursor: CompletedAutomationRunCursor): string {
  return Buffer.from(JSON.stringify({
    completed_at: cursor.completedAt.toISOString(),
    id: cursor.id,
  })).toString("base64url");
}

export function decodeCompletedRunCursor(value: string): CompletedAutomationRunCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return { completedAt: new Date(parsed.completed_at), id: parsed.id };
  } catch {
    throw new AutomationValidationError("Completed-run cursor is invalid");
  }
}
