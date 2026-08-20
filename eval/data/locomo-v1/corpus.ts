import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assembleCorpus, CONVERSATION_WORKING_SET_BYTE_BUDGET, type Corpus } from "../../runner/corpus/types.ts";
import type { LocomoConversation } from "./dataset.ts";

export const LOCOMO_CASE_FILE = "locomo-case.json";

const publicCaseSchema = z.object({
  schema_version: z.literal(1),
  corpus_id: z.string().min(1),
  source_revision: z.string().regex(/^[a-f0-9]{40}$/),
  speaker_a: z.string().min(1),
  speaker_b: z.string().min(1),
  sessions: z.array(z.object({
    number: z.number().int().min(1),
    date_time: z.string().min(1),
    batch: z.string().min(1),
    turns: z.array(z.object({
      speaker: z.string().min(1),
      text: z.string(),
      image_caption: z.string().optional(),
    }).strict()).min(1),
  }).strict()).min(1),
}).strict();

export type PublicLocomoCase = z.infer<typeof publicCaseSchema>;

/**
 * One session as the source record an agent actually reads.
 *
 * A session, not a turn: a turn is A-mem's memory unit because its memory is a note store,
 * whereas the unit here is what one source produces, and LoCoMo's own unit is the dated
 * session. The production working-set planner may divide an exceptionally large rendered
 * session at turn boundaries, but the logical source remains this one dated session rather
 * than 20–35 independent one-line records.
 *
 * Image turns carry their BLIP caption inline, because some questions are answerable only
 * from a shared image. Upstream's own prompt path appends the caption whenever the turn has
 * one, so this does too — A-mem instead requires an `img_url` alongside it, which drops the
 * 39 caption-only turns in the pinned file.
 */
function renderSession(
  entry: PublicLocomoCase,
  session: PublicLocomoCase["sessions"][number],
): string {
  const lines = [
    `# Conversation between ${entry.speaker_a} and ${entry.speaker_b}`,
    "",
    `**Session date:** ${session.date_time}`,
  ];
  for (const turn of session.turns) {
    const caption = turn.image_caption ? `[Image: ${turn.image_caption}]` : "";
    const body = [caption, turn.text.trim()].filter(Boolean).join(" ");
    lines.push("", `### ${turn.speaker} — ${session.date_time}`, "", body);
  }
  return `${lines.join("\n").trim()}\n`;
}

/**
 * Materializes the agent-facing half of one conversation.
 *
 * Everything sealed is sealed by omission rather than by removal: the questions, their
 * reference answers, their categories and their evidence dialogue ids never enter this
 * shape at all, so there is no field for them to leak through. Dialogue ids are dropped
 * from the turns for the same reason — they are the key `evidence` is written in.
 */
export function publicLocomoCase(
  conversation: LocomoConversation,
  sourceRevision: string,
  sessionsPerBatch: number,
): PublicLocomoCase {
  if (!Number.isSafeInteger(sessionsPerBatch) || sessionsPerBatch < 1 || sessionsPerBatch > 100) {
    throw new Error("sessionsPerBatch must be between 1 and 100");
  }
  const header = {
    schema_version: 1 as const,
    corpus_id: `locomo-v1-${conversation.sampleId}`,
    source_revision: sourceRevision,
    speaker_a: conversation.speakerA,
    speaker_b: conversation.speakerB,
  };
  let batchIndex = 1;
  let batchSessions = 0;
  let batchBytes = 0;
  const sessions = conversation.sessions.map((session) => {
    const materialized = {
      number: session.number,
      date_time: session.dateTime,
      batch: `batch-${String(batchIndex).padStart(2, "0")}`,
      turns: session.turns.map((turn) => ({
        speaker: turn.speaker,
        text: turn.text,
        ...(turn.imageCaption ? { image_caption: turn.imageCaption } : {}),
      })),
    };
    const sourceBytes = Buffer.byteLength(JSON.stringify({
      action: "added",
      markdown: renderSession({ ...header, sessions: [materialized] }, materialized),
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
  return publicCaseSchema.parse({ ...header, sessions });
}

export function loadLocomoCaseCorpus(directory: string): Corpus {
  const parsed = publicCaseSchema.parse(JSON.parse(
    readFileSync(join(directory, LOCOMO_CASE_FILE), "utf8"),
  ));
  return assembleCorpus(parsed.corpus_id, "CC BY-NC 4.0", parsed.sessions.map((session) => {
    const slug = `session-${String(session.number).padStart(2, "0")}`;
    return {
      slug,
      type: "conversation-session" as const,
      batch: session.batch,
      markdown: renderSession(parsed, session),
      action: "added" as const,
      itemSlugs: [slug],
    };
  }));
}
