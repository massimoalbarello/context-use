import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { KnowledgePageChange, KnowledgePageChangeBatch } from "../types.ts";

const ACTION_LABELS: Record<KnowledgePageChange["change_kind"], string> = {
  created: "Created",
  updated: "Updated",
  archived: "Archived",
  deleted: "Deleted",
};

export type KnowledgeChangeDayGroup = {
  key: string;
  date: Date;
  changes: KnowledgePageChange[];
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareCursorDescending(left: string, right: string): number {
  const leftSequence = left.slice(left.lastIndexOf(".") + 1);
  const rightSequence = right.slice(right.lastIndexOf(".") + 1);
  return rightSequence.length - leftSequence.length || rightSequence.localeCompare(leftSequence);
}

export function groupKnowledgeChanges(changes: KnowledgePageChange[]): KnowledgeChangeDayGroup[] {
  const sorted = [...changes].sort((left, right) => {
    const timeDifference = new Date(right.changed_at).getTime() - new Date(left.changed_at).getTime();
    return timeDifference || compareCursorDescending(left.cursor, right.cursor);
  });
  const groups: KnowledgeChangeDayGroup[] = [];

  for (const change of sorted) {
    const date = new Date(change.changed_at);
    const key = localDateKey(date);
    const current = groups[groups.length - 1];
    if (current?.key === key) {
      current.changes.push(change);
    } else {
      groups.push({ key, date, changes: [change] });
    }
  }

  return groups;
}

function dayHeading(date: Date, today: Date): { label: string; detail: string } {
  const dayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const difference = Math.round((dayNumber(today) - dayNumber(date)) / 86_400_000);
  const fullDate = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);

  if (difference === 0) return { label: "Today", detail: fullDate };
  if (difference === 1) return { label: "Yesterday", detail: fullDate };
  return {
    label: new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(date),
    detail: String(date.getFullYear()),
  };
}

export function KnowledgeChangeRow({
  change,
  onOpenPage,
}: {
  change: KnowledgePageChange;
  onOpenPage: (pageId: string) => void;
}) {
  const actor = change.actor_kind
    ? `${change.actor_kind}${change.actor_subject ? ` · ${change.actor_subject}` : ""}`
    : "context-use";
  return <article className="knowledge-change-row">
    <span className={`change-kind ${change.change_kind}`}>{ACTION_LABELS[change.change_kind]}</span>
    <div className="knowledge-change-main">
      <div className="knowledge-change-heading">
        {change.change_kind === "deleted"
          ? <strong>{change.path}</strong>
          : <button type="button" onClick={() => onOpenPage(change.page_id)}>{change.path}</button>}
        <span>v{change.version_number}</span>
      </div>
      <p>{change.commit_message}</p>
      <span>{change.title} · {actor}</span>
    </div>
    <time dateTime={new Date(change.changed_at).toISOString()}>
      {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(change.changed_at))}
    </time>
  </article>;
}

export function KnowledgeChangeDay({
  group,
  onOpenPage,
  today = new Date(),
}: {
  group: KnowledgeChangeDayGroup;
  onOpenPage: (pageId: string) => void;
  today?: Date;
}) {
  const heading = dayHeading(group.date, today);
  const headingId = `knowledge-change-day-${group.key}`;
  return <section className="knowledge-change-day" aria-labelledby={headingId}>
    <header className="knowledge-change-day-heading">
      <div>
        <h2 id={headingId}>{heading.label}</h2>
        <time dateTime={group.key}>{heading.detail}</time>
      </div>
      <span>{group.changes.length} {group.changes.length === 1 ? "change" : "changes"}</span>
    </header>
    <div className="knowledge-change-day-rows">
      {group.changes.map((change) => <KnowledgeChangeRow key={change.cursor} change={change} onOpenPage={onOpenPage} />)}
    </div>
  </section>;
}

export function KnowledgeHistory({ onOpenPage }: { onOpenPage: (pageId: string) => void }) {
  const [changes, setChanges] = useState<KnowledgePageChange[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (before?: string) => {
    setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams({ limit: "50" });
      if (before) parameters.set("before", before);
      const batch = await api<KnowledgePageChangeBatch>(`/api/dashboard/knowledge-changes?${parameters}`);
      setChanges((current) => before ? [...current, ...batch.changes] : batch.changes);
      setNextCursor(batch.has_more ? batch.next_cursor : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Change history could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const groupedChanges = groupKnowledgeChanges(changes);

  return <main className="content-page knowledge-history-page">
    <header>
      <div><span className="eyebrow">Knowledge ledger</span><h1>Change history</h1></div>
    </header>
    <section className="knowledge-history-intro">
      <p>A chronological record of page changes, including paths and commit metadata. Page bodies and diffs are never stored here.</p>
    </section>
    <section className="knowledge-change-list" aria-live="polite">
      {!loading && !error && changes.length === 0 && <p className="knowledge-history-empty">No page changes have been recorded yet.</p>}
      {groupedChanges.map((group) => <KnowledgeChangeDay key={group.key} group={group} onOpenPage={onOpenPage} />)}
    </section>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {nextCursor && <button className="knowledge-history-more" disabled={loading} onClick={() => void load(nextCursor)}>
      {loading ? "Loading…" : "Load older changes"}
    </button>}
    {loading && changes.length === 0 && <p className="knowledge-history-empty">Loading change history…</p>}
  </main>;
}
