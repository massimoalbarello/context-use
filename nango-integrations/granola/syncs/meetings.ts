import { createSync } from "nango";

import { PipelineRecordSchema, type PipelineRecord } from "../../pipeline-record.js";
import { GranolaMcpClient } from "../mcp/client.js";

const MODEL = "GranolaMeeting" as const;
const GET_BATCH_SIZE = 10;

type ListedMeeting = {
  id: string;
  title: string;
  date: string;
  participants: string[];
  attendeeLabels: string[];
};

const sync = createSync({
  description: "Sync Granola-generated meeting summaries available through Granola MCP",
  version: "1.0.0",
  endpoints: [{ method: "POST", path: "/syncs/meetings", group: "Meetings" }],
  frequency: "every hour",
  autoStart: true,
  models: { GranolaMeeting: PipelineRecordSchema },

  exec: async (nango) => {
    const mcp = new GranolaMcpClient(nango);
    const listed = parseMeetings(await mcp.callTool("list_meetings", { time_range: "last_30_days" }));

    for (const batch of chunk(listed, GET_BATCH_SIZE)) {
      const details = parseMeetings(
        await mcp.callTool("get_meetings", { meeting_ids: batch.map((meeting) => meeting.id) }),
      );
      const listedById = new Map(batch.map((meeting) => [meeting.id, meeting]));
      const records = details.flatMap((detail) => {
        const summary = detail.summary?.trim();
        if (!summary || summary === "No summary") return [];
        const base = listedById.get(detail.id);
        return [buildRecord({
          ...base,
          ...detail,
          participants: detail.participants.length > 0 ? detail.participants : base?.participants ?? [],
          attendeeLabels: detail.attendeeLabels.length > 0 ? detail.attendeeLabels : base?.attendeeLabels ?? [],
        }, summary)];
      });
      if (records.length > 0) await nango.batchSave(records, MODEL);
    }
  },
});

function buildRecord(meeting: ListedMeeting, summary: string): PipelineRecord {
  const timestamp = toIso(meeting.date);
  const lines = [
    `# ${meeting.title || "Untitled meeting"}`,
    "",
    `- Date: ${meeting.date}`,
    `- Granola: https://notes.granola.ai/d/${encodeURIComponent(meeting.id)}`,
  ];
  if (meeting.attendeeLabels.length > 0) lines.push(`- Attendees: ${meeting.attendeeLabels.join(", ")}`);
  lines.push("", "## Summary", "", summary);

  return PipelineRecordSchema.parse({
    id: meeting.id,
    created_at: timestamp,
    updated_at: timestamp,
    participants: unique(meeting.participants),
    body: lines.join("\n").trim(),
  });
}

function parseMeetings(xml: string): Array<ListedMeeting & { summary?: string }> {
  const meetings: Array<ListedMeeting & { summary?: string }> = [];
  const meetingPattern = /<meeting\s+([^>]*)>([\s\S]*?)<\/meeting>/g;
  let match: RegExpExecArray | null;
  while ((match = meetingPattern.exec(xml)) !== null) {
    const attributes = match[1] ?? "";
    const content = match[2] ?? "";
    const id = attribute(attributes, "id");
    if (!id) continue;
    const participantBlock = element(content, "known_participants") ?? "";
    const attendees = parseParticipants(participantBlock);
    const summary = element(content, "summary");
    meetings.push({
      id,
      title: decodeXml(attribute(attributes, "title")),
      date: decodeXml(attribute(attributes, "date")),
      participants: unique(attendees.map((attendee) => attendee.identifier)),
      attendeeLabels: unique(attendees.map((attendee) => attendee.label)),
      ...(summary === undefined ? {} : { summary: decodeXml(stripCdata(summary)).trim() }),
    });
  }
  return meetings;
}

function attribute(attributes: string, name: string): string {
  return attributes.match(new RegExp(`${name}=["']([^"']*)["']`))?.[1] ?? "";
}

function element(content: string, name: string): string | undefined {
  return content.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1];
}

function parseParticipants(raw: string): Array<{ identifier: string; label: string }> {
  const decoded = decodeXml(raw).replace(/\s+/g, " ").trim();
  if (!decoded) return [];
  return decoded.split(/>\s*,\s*/).map((entry, index, entries) => {
    const complete = index < entries.length - 1 ? `${entry}>` : entry;
    const email = complete.match(/<([^>]+@[^>]+)>/)?.[1]?.trim();
    const name = complete
      .replace(/\s*<[^>]+>\s*$/, "")
      .replace(/\s*\(note creator\)\s*/i, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      identifier: email || name,
      label: email ? `${name || email} <${email}>` : name,
    };
  }).filter((attendee) => attendee.identifier && attendee.label);
}

function stripCdata(value: string): string {
  const match = value.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  return match?.[1] ?? value;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function toIso(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Granola MCP returned an invalid meeting date: ${value}`);
  return new Date(parsed).toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

export type NangoSyncLocal = Parameters<(typeof sync)["exec"]>[0];
export default sync;
