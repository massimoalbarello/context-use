/**
 * Production transport boundaries for conversation-shaped source records.
 *
 * Small conversations remain one record. Large ones are divided at complete dialogue turns;
 * later excerpts repeat a short tail from the preceding excerpt in a visibly separate context
 * section. The repeated turns help resolve local references but are not new activity.
 */

export const CONVERSATION_SEGMENT_TARGET_BYTES = 24_000;
export const CONVERSATION_UNSPLIT_LIMIT_BYTES = 32_000;
export const CONVERSATION_OVERLAP_TURNS = 2;
export const CONVERSATION_OVERLAP_BYTE_LIMIT = 4_000;
export const CONVERSATION_TURN_MARKER = "<!-- context-use:conversation-turn -->";

const PRIOR_CONTEXT_HEADING = "## Context from immediately before this excerpt";
const CURRENT_EXCERPT_HEADING = "## Conversation to process";
const PRIOR_CONTEXT_NOTE = [
  "> These messages were already processed and are repeated only to clarify references in",
  "> the conversation below.",
].join("\n");

export type ConversationTurnStyle = "agent" | "dated-speaker";

export type ConversationSegment = {
  markdown: string;
  index: number;
  count: number;
};

export type SegmentConversationOptions = {
  turnStyle?: ConversationTurnStyle;
  targetBytes?: number;
  unsplitLimitBytes?: number;
  overlapTurns?: number;
  overlapByteLimit?: number;
};

function bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isTurnHeading(line: string, style: ConversationTurnStyle): boolean {
  if (style === "agent") return /^### (?:User|Assistant)(?: — .+)?$/.test(line);
  return /^### .+ — .+$/.test(line);
}

function conversationParts(
  markdown: string,
  style: ConversationTurnStyle,
): { preamble: string; turns: string[] } | null {
  const lines = markdown.trimEnd().split(/\r?\n/);
  const markedStarts = lines.flatMap((line, index) => line === CONVERSATION_TURN_MARKER ? [index] : []);
  // Current agent-sync records carry unambiguous markers because message bodies can contain
  // arbitrary Markdown headings. Heading recognition keeps already-synced records and the
  // named-speaker eval corpus compatible.
  const starts = markedStarts.length >= 2
    ? markedStarts
    : lines.flatMap((line, index) => isTurnHeading(line, style) ? [index] : []);
  if (starts.length < 2) return null;
  const preamble = lines.slice(0, starts[0]).join("\n").trimEnd();
  const turns = starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length).join("\n").trim());
  return { preamble, turns };
}

/**
 * Splits ordered turns into the fewest approximately balanced groups around the target.
 * Turn boundaries are indivisible: a single over-target turn remains whole.
 */
function balancedTurnGroups(turns: string[], targetBytes: number): string[][] {
  const sizes = turns.map(bytes);
  const groupCount = Math.min(turns.length, Math.max(2, Math.ceil(
    sizes.reduce((total, size) => total + size, 0) / targetBytes,
  )));
  const groups: string[][] = [];
  let start = 0;
  let remainingBytes = sizes.reduce((total, size) => total + size, 0);

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupsLeft = groupCount - groupIndex;
    if (groupsLeft === 1) {
      groups.push(turns.slice(start));
      break;
    }
    const maximumEnd = turns.length - (groupsLeft - 1);
    const ideal = remainingBytes / groupsLeft;
    let end = start;
    let groupBytes = 0;
    while (end < maximumEnd) {
      const nextBytes = sizes[end]!;
      if (end > start && Math.abs(groupBytes - ideal) <= Math.abs(groupBytes + nextBytes - ideal)) break;
      groupBytes += nextBytes;
      end += 1;
    }
    if (end === start) {
      groupBytes = sizes[end]!;
      end += 1;
    }
    groups.push(turns.slice(start, end));
    start = end;
    remainingBytes -= groupBytes;
  }
  return groups;
}

function priorContext(
  priorTurns: string[],
  overlapTurns: number,
  overlapByteLimit: number,
): string[] {
  const result: string[] = [];
  let total = 0;
  for (let index = priorTurns.length - 1; index >= 0 && result.length < overlapTurns; index -= 1) {
    const turn = priorTurns[index]!;
    const turnBytes = bytes(turn);
    if (total + turnBytes > overlapByteLimit) break;
    result.unshift(turn);
    total += turnBytes;
  }
  return result;
}

/**
 * Plans the Markdown records delivered to the distiller for one logical conversation.
 * Unsplit input is returned byte-for-byte so ordinary source records keep their canonical form.
 */
export function segmentConversationMarkdown(
  markdown: string,
  options: SegmentConversationOptions = {},
): ConversationSegment[] {
  const targetBytes = options.targetBytes ?? CONVERSATION_SEGMENT_TARGET_BYTES;
  const unsplitLimitBytes = options.unsplitLimitBytes ?? CONVERSATION_UNSPLIT_LIMIT_BYTES;
  const overlapTurns = options.overlapTurns ?? CONVERSATION_OVERLAP_TURNS;
  const overlapByteLimit = options.overlapByteLimit ?? CONVERSATION_OVERLAP_BYTE_LIMIT;
  const turnStyle = options.turnStyle ?? "agent";
  for (const [name, value] of Object.entries({ targetBytes, unsplitLimitBytes, overlapByteLimit })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
  if (!Number.isSafeInteger(overlapTurns) || overlapTurns < 0) {
    throw new Error("overlapTurns must be a non-negative integer");
  }
  if (bytes(markdown) <= unsplitLimitBytes) return [{ markdown, index: 0, count: 1 }];

  const parts = conversationParts(markdown, turnStyle);
  if (!parts) return [{ markdown, index: 0, count: 1 }];
  const groups = balancedTurnGroups(parts.turns, targetBytes);
  if (groups.length === 1) return [{ markdown, index: 0, count: 1 }];

  const segments = groups.map((group, index) => {
    const sections = [parts.preamble];
    if (index > 0) {
      const overlap = priorContext(groups[index - 1]!, overlapTurns, overlapByteLimit);
      if (overlap.length > 0) {
        sections.push(PRIOR_CONTEXT_HEADING, PRIOR_CONTEXT_NOTE, overlap.join("\n\n"));
      }
    }
    sections.push(CURRENT_EXCERPT_HEADING, group.join("\n\n"));
    return `${sections.filter(Boolean).join("\n\n").trim()}\n`;
  });
  return segments.map((segment, index) => ({ markdown: segment, index, count: segments.length }));
}
