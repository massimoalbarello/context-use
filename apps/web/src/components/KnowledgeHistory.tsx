import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { KnowledgePageChange, KnowledgePageChangeBatch } from "../types.ts";

const ACTION_LABELS: Record<KnowledgePageChange["change_kind"], string> = {
  created: "Created",
  updated: "Updated",
  archived: "Archived",
  deleted: "Deleted",
};

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
      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(change.changed_at))}
    </time>
  </article>;
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

  return <main className="content-page knowledge-history-page">
    <header>
      <div><span className="eyebrow">Knowledge ledger</span><h1>Change history</h1></div>
    </header>
    <section className="knowledge-history-intro">
      <p>Context-use records page changes automatically. This durable history keeps paths and commit metadata, never page bodies or diffs.</p>
    </section>
    <section className="knowledge-change-list" aria-live="polite">
      {!loading && !error && changes.length === 0 && <p className="knowledge-history-empty">No page changes have been recorded yet.</p>}
      {changes.map((change) => <KnowledgeChangeRow key={change.cursor} change={change} onOpenPage={onOpenPage} />)}
    </section>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {nextCursor && <button className="knowledge-history-more" disabled={loading} onClick={() => void load(nextCursor)}>
      {loading ? "Loading…" : "Load older changes"}
    </button>}
    {loading && changes.length === 0 && <p className="knowledge-history-empty">Loading change history…</p>}
  </main>;
}
