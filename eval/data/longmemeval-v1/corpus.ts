import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  assembleCorpus,
  CONVERSATION_WORKING_SET_BYTE_BUDGET,
  type Corpus,
} from "../../runner/corpus/types.ts";
import type { LongMemEvalCase } from "./dataset.ts";
import { CONVERSATION_TURN_MARKER } from "../../../apps/server/src/conversation-working-sets.ts";

export const LONGMEMEVAL_CASE_FILE = "longmemeval-case.json";

const publicCaseSchema = z.object({
  schema_version: z.literal(1),
  corpus_id: z.string().min(1),
  source_revision: z.string().regex(/^[a-f0-9]{40}$/),
  sessions: z.array(z.object({
    id: z.string().min(1),
    date: z.string().min(1),
    batch: z.string().min(1),
    turns: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    }).strict()).min(1),
  }).strict()).min(1),
}).strict();

export type PublicLongMemEvalCase = z.infer<typeof publicCaseSchema>;

function renderSession(session: PublicLongMemEvalCase["sessions"][number]): string {
  const firstUser = session.turns.find((turn) => turn.role === "user")?.content;
  const title = firstUser?.split(/\r?\n/, 1)[0]?.trim().slice(0, 100);
  const lines = [
    `# Agent conversation${title ? `: ${title}` : ""}`,
    "",
    `**Session date:** ${session.date}`,
  ];
  for (const turn of session.turns) {
    const label = turn.role === "user" ? "User" : "Assistant";
    lines.push("", CONVERSATION_TURN_MARKER, `### ${label} — ${session.date}`, "", turn.content.trim());
  }
  return `${lines.join("\n").trim()}\n`;
}

export function publicLongMemEvalCase(
  entry: LongMemEvalCase,
  sourceRevision: string,
  sessionsPerBatch: number,
): PublicLongMemEvalCase {
  if (!Number.isSafeInteger(sessionsPerBatch) || sessionsPerBatch < 1 || sessionsPerBatch > 100) {
    throw new Error("sessionsPerBatch must be between 1 and 100");
  }
  let batchIndex = 1;
  let batchSessions = 0;
  let batchBytes = 0;
  const sessions = entry.sessions.map((session) => {
    const materialized = {
      id: session.id,
      date: session.date,
      batch: `batch-${String(batchIndex).padStart(2, "0")}`,
      turns: session.turns,
    };
    const sourceBytes = Buffer.byteLength(JSON.stringify({
      action: "added",
      markdown: renderSession(materialized),
    }), "utf8") + 1;
    if (batchSessions > 0 && (
      batchSessions >= sessionsPerBatch
      || batchBytes + sourceBytes > CONVERSATION_WORKING_SET_BYTE_BUDGET
    )) {
      batchIndex += 1;
      batchSessions = 0;
      batchBytes = 0;
      materialized.batch = `batch-${String(batchIndex).padStart(2, "0")}`;
    }
    batchSessions += 1;
    batchBytes += sourceBytes;
    return materialized;
  });
  return publicCaseSchema.parse({
    schema_version: 1,
    corpus_id: `longmemeval-v1-${entry.questionId}`,
    source_revision: sourceRevision,
    sessions,
  });
}

export function loadLongMemEvalCaseCorpus(directory: string): Corpus {
  const parsed = publicCaseSchema.parse(JSON.parse(
    readFileSync(join(directory, LONGMEMEVAL_CASE_FILE), "utf8"),
  ));
  return assembleCorpus(parsed.corpus_id, "MIT", parsed.sessions.map((session) => ({
    slug: session.id,
    type: "agent-conversation" as const,
    batch: session.batch,
    markdown: renderSession(session),
    action: "added" as const,
    itemSlugs: [session.id],
  })));
}
