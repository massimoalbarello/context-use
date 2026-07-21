import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import { automationRunDisplayStatus } from "../automation-run-status.ts";
import type { AutomationRun, CronSchedule } from "../types.ts";

const WORKER_PROMPT = `Check Context Use for scheduled work. Call claim_due_run. If it returns a run, follow its instructions using the supplied input. Continue until claim_due_run returns null.`;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function parseInput(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Input must be a JSON object");
  return parsed as Record<string, unknown>;
}

function automationKeyFromName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

const COLLAPSED_RUN_OUTCOME_CHARACTERS = 180;
const COLLAPSED_RUN_OUTCOME_LINES = 3;
const COMPLETED_RUN_PAGE_SIZE = 10;

type CompletedRunPage = {
  items: AutomationRun[];
  next_cursor: string | null;
  totals: { succeeded: number; failed: number };
};

function completedRunsUrl(cursor?: string): string {
  const parameters = new URLSearchParams({ limit: String(COMPLETED_RUN_PAGE_SIZE) });
  if (cursor) parameters.set("cursor", cursor);
  return `/api/dashboard/automations/runs/completed?${parameters}`;
}

export function appendUniqueRuns(current: AutomationRun[], older: AutomationRun[]): AutomationRun[] {
  const seen = new Set(current.map((run) => run.id));
  return [...current, ...older.filter((run) => !seen.has(run.id))];
}

function prependUniqueRuns(current: AutomationRun[], newer: AutomationRun[]): AutomationRun[] {
  const newerIds = new Set(newer.map((run) => run.id));
  return [...newer, ...current.filter((run) => !newerIds.has(run.id))];
}

export function isLongRunOutcome(value: string): boolean {
  return value.length > COLLAPSED_RUN_OUTCOME_CHARACTERS
    || value.split(/\r?\n/).length > COLLAPSED_RUN_OUTCOME_LINES;
}

function RunOutcome({ run }: { run: AutomationRun }) {
  const [expanded, setExpanded] = useState(false);
  const value = run.result_summary ?? run.error_message ?? "—";
  const isLong = isLongRunOutcome(value);
  const contentId = `run-outcome-${run.id}`;

  return <td className="run-outcome">
    <div
      id={contentId}
      className={`run-outcome-text${isLong && !expanded ? " is-collapsed" : ""}`}
    >{value}</div>
    {isLong && <button
      type="button"
      className="run-outcome-toggle"
      aria-controls={contentId}
      aria-expanded={expanded}
      onClick={() => setExpanded((current) => !current)}
    >{expanded ? "Collapse" : "Expand"}</button>}
  </td>;
}

export function Automations() {
  const [schedules, setSchedules] = useState<CronSchedule[]>([]);
  const [activeRuns, setActiveRuns] = useState<AutomationRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<AutomationRun[]>([]);
  const [completedRunTotals, setCompletedRunTotals] = useState({ succeeded: 0, failed: 0 });
  const [nextCompletedRunCursor, setNextCompletedRunCursor] = useState<string | null>(null);
  const [loadingOlderRuns, setLoadingOlderRuns] = useState(false);
  const [olderRunsError, setOlderRunsError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [scheduleName, setScheduleName] = useState("");
  const [automationKey, setAutomationKey] = useState("");
  const [automationKeyEdited, setAutomationKeyEdited] = useState(false);
  const [scheduleInstructions, setScheduleInstructions] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [scheduleInput, setScheduleInput] = useState("{}");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleName, setEditScheduleName] = useState("");
  const [editScheduleInstructions, setEditScheduleInstructions] = useState("");
  const [editCommitMessage, setEditCommitMessage] = useState("Update automation instructions");
  const [editCronExpression, setEditCronExpression] = useState("");
  const [editTimezone, setEditTimezone] = useState("");
  const [editScheduleInput, setEditScheduleInput] = useState("{}");
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null);
  const completedRunsInitialized = useRef(false);
  const loadingOlderRunsRef = useRef(false);
  const olderRunsSentinel = useRef<HTMLDivElement>(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextActiveRuns, nextSchedules, nextCompletedRuns] = await Promise.all([
        api<AutomationRun[]>("/api/dashboard/automations/runs/active"),
        api<CronSchedule[]>("/api/dashboard/automations/schedules"),
        api<CompletedRunPage>(completedRunsUrl()),
      ]);
      const preserveLoadedHistory = quiet && completedRunsInitialized.current;
      setActiveRuns(nextActiveRuns);
      setSchedules(nextSchedules);
      setRecentRuns((current) => preserveLoadedHistory
        ? prependUniqueRuns(current, nextCompletedRuns.items)
        : nextCompletedRuns.items);
      setCompletedRunTotals(nextCompletedRuns.totals);
      if (!preserveLoadedHistory) setNextCompletedRunCursor(nextCompletedRuns.next_cursor);
      completedRunsInitialized.current = true;
      if (!quiet) setOlderRunsError("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load automations");
    } finally {
      setLoading(false);
    }
  };

  const loadOlderRuns = useCallback(async () => {
    if (!nextCompletedRunCursor || loadingOlderRunsRef.current) return;
    loadingOlderRunsRef.current = true;
    setLoadingOlderRuns(true);
    setOlderRunsError("");
    try {
      const page = await api<CompletedRunPage>(completedRunsUrl(nextCompletedRunCursor));
      setRecentRuns((current) => appendUniqueRuns(current, page.items));
      setNextCompletedRunCursor(page.next_cursor);
      setCompletedRunTotals(page.totals);
    } catch (error) {
      setOlderRunsError(error instanceof Error ? error.message : "Could not load older runs");
    } finally {
      loadingOlderRunsRef.current = false;
      setLoadingOlderRuns(false);
    }
  }, [nextCompletedRunCursor]);

  useEffect(() => {
    load().catch(() => undefined);
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const sentinel = olderRunsSentinel.current;
    if (!sentinel || !nextCompletedRunCursor || olderRunsError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) loadOlderRuns().catch(() => undefined);
    }, { rootMargin: "240px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderRuns, nextCompletedRunCursor, olderRunsError]);

  const availableRunCount = useMemo(
    () => activeRuns.filter((run) => automationRunDisplayStatus(run) !== "claimed").length,
    [activeRuns],
  );
  const claimedRunCount = activeRuns.length - availableRunCount;

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      const created = await api<CronSchedule>("/api/dashboard/automations/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName,
          automation_key: automationKey,
          instructions_markdown: scheduleInstructions,
          cron_expression: cronExpression,
          timezone,
          input: parseInput(scheduleInput),
          enabled: true,
        }),
      });
      setScheduleName("");
      setAutomationKey("");
      setAutomationKeyEdited(false);
      setScheduleInstructions("");
      setScheduleInput("{}");
      setMessage(`Automation created. Generated pages are confined to ${created.knowledge_path}.`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create automation");
    }
  };

  const saveSchedule = async (schedule: CronSchedule, changes: Partial<CronSchedule>, commitMessage = "Update automation") => {
    const next = { ...schedule, ...changes };
    await api(`/api/dashboard/automations/schedules/${schedule.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: next.name,
        instructions_markdown: next.instructions_markdown,
        commit_message: commitMessage,
        cron_expression: next.cron_expression,
        timezone: next.timezone,
        input: next.input,
        enabled: next.enabled,
        expected_version_number: schedule.automation_version_number,
      }),
    });
    await load(true);
  };

  const startEditing = (schedule: CronSchedule) => {
    setDeletingScheduleId(null);
    setEditingScheduleId(schedule.id);
    setEditScheduleName(schedule.name);
    setEditScheduleInstructions(schedule.instructions_markdown);
    setEditCommitMessage("Update automation instructions");
    setEditCronExpression(schedule.cron_expression);
    setEditTimezone(schedule.timezone);
    setEditScheduleInput(JSON.stringify(schedule.input, null, 2));
    setMessage("");
  };

  const updateSchedule = async (event: React.FormEvent, schedule: CronSchedule) => {
    event.preventDefault();
    setSavingScheduleId(schedule.id);
    setMessage("");
    try {
      await saveSchedule(schedule, {
        name: editScheduleName,
        instructions_markdown: editScheduleInstructions,
        cron_expression: editCronExpression,
        timezone: editTimezone,
        input: parseInput(editScheduleInput),
      }, editCommitMessage);
      setEditingScheduleId(null);
      setMessage("Automation updated. Its knowledge folder is unchanged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automation");
    } finally {
      setSavingScheduleId(null);
    }
  };

  const deleteSchedule = async (schedule: CronSchedule) => {
    setSavingScheduleId(schedule.id);
    setMessage("");
    try {
      await api(`/api/dashboard/automations/schedules/${schedule.id}`, { method: "DELETE" });
      setDeletingScheduleId(null);
      setMessage(`Automation “${schedule.name}” deleted. Pages it created remain available.`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete automation");
    } finally {
      setSavingScheduleId(null);
    }
  };

  return <main className="content-page automations-page">
    <header><div><span className="eyebrow">Scheduled agent work</span><h1>Automations</h1><p>Each automation owns its instructions, cron trigger, durable versioned run history, and isolated semantic knowledge folder.</p></div></header>
    {message && <div className="automation-message">{message}</div>}

    <section className="worker-card">
      <div><span className="eyebrow">Generic worker</span><h2>Worker prompt</h2><p>Schedule this same polling prompt on any connected agent.</p></div>
      <pre>{WORKER_PROMPT}</pre>
      <button onClick={() => navigator.clipboard.writeText(WORKER_PROMPT)
        .then(() => setMessage("Worker prompt copied."))
        .catch(() => setMessage("Could not copy the prompt; select the text manually."))}>Copy prompt</button>
    </section>

    <div className="automation-stats">
      <article><strong>{availableRunCount}</strong><span>Available</span></article>
      <article><strong>{claimedRunCount}</strong><span>Claimed</span></article>
      <article><strong>{completedRunTotals.succeeded}</strong><span>Succeeded</span></article>
      <article><strong>{completedRunTotals.failed}</strong><span>Failed</span></article>
    </div>

    <section>
      <div className="section-heading"><div><h2>Available and claimed runs</h2><p>Expired claims remain available for the next polling agent.</p></div></div>
      {loading ? <p>Loading runs…</p> : activeRuns.length === 0 ? <p className="empty-note">Nothing is waiting for an agent.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Automation</th><th>Instructions</th><th>Scheduled</th><th>Lease expires</th><th>Agent</th></tr></thead><tbody>{activeRuns.map((run) => {
        const displayStatus = automationRunDisplayStatus(run);
        return <tr key={run.id}><td><span className={`run-status ${displayStatus}`}>{displayStatus === "expired" ? "claim expired" : displayStatus}</span>{displayStatus === "expired" && <small>Available for reclaim</small>}</td><td>{run.schedule_name}</td><td>v{run.automation_version_number}</td><td>{formatDate(run.scheduled_for)}</td><td>{formatDate(run.lease_expires_at)}</td><td>{run.claimed_by ?? "—"}</td></tr>;
      })}</tbody></table></div>}
    </section>

    <section>
      <div className="section-heading"><div><h2>Automations</h2><p>Cron is the trigger; every row also owns one immutable knowledge location.</p></div></div>
      {schedules.length === 0 ? <p className="empty-note">No automations yet.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Automation</th><th>Instructions</th><th>Schedule</th><th>Knowledge location</th><th>Next run</th><th>State</th><th></th></tr></thead><tbody>{schedules.map((schedule) => <Fragment key={schedule.id}>
        <tr><td><strong>{schedule.name}</strong></td><td>v{schedule.automation_version_number}</td><td><code>{schedule.cron_expression}</code><small>{schedule.timezone}</small></td><td className="knowledge-location"><code>{schedule.knowledge_path}</code><small>{schedule.generated_page_count} page{schedule.generated_page_count === 1 ? "" : "s"}</small></td><td>{formatDate(schedule.next_run_at)}</td><td><span className={`run-status ${schedule.enabled ? "succeeded" : "disabled"}`}>{schedule.enabled ? "enabled" : "paused"}</span></td><td><div className="table-actions"><button onClick={() => startEditing(schedule)}>Edit</button><button onClick={() => saveSchedule(schedule, { enabled: !schedule.enabled }).then(() => setMessage(schedule.enabled ? "Automation paused." : "Automation enabled.")).catch((error: Error) => setMessage(error.message))}>{schedule.enabled ? "Pause" : "Enable"}</button><button className="danger-text" onClick={() => { setEditingScheduleId(null); setDeletingScheduleId(schedule.id); setMessage(""); }}>Delete</button></div></td></tr>
        {editingScheduleId === schedule.id && <tr className="automation-action-row"><td colSpan={7}><form className="inline-dashboard-form automation-inline-editor" onSubmit={(event) => updateSchedule(event, schedule)}>
          <div className="inline-form-heading"><div><strong>Edit {schedule.name}</strong><span>The generated-knowledge location will not change.</span></div></div>
          <label>Name<input required maxLength={160} value={editScheduleName} onChange={(event) => setEditScheduleName(event.target.value)} /></label>
          <label>Instructions<textarea required rows={10} value={editScheduleInstructions} onChange={(event) => setEditScheduleInstructions(event.target.value)} /><small>Context Use adds claim handling, knowledge persistence, and completion rules only when this automation runs.</small></label>
          <label>Change note<input required minLength={3} maxLength={240} value={editCommitMessage} onChange={(event) => setEditCommitMessage(event.target.value)} /></label>
          <div className="form-row"><label>Cron expression<input required value={editCronExpression} onChange={(event) => setEditCronExpression(event.target.value)} /></label><label>Time zone<input required value={editTimezone} onChange={(event) => setEditTimezone(event.target.value)} /></label></div>
          <label>Input JSON<textarea rows={5} value={editScheduleInput} onChange={(event) => setEditScheduleInput(event.target.value)} /></label>
          <div className="inline-form-actions"><button type="button" onClick={() => setEditingScheduleId(null)}>Cancel</button><button className="primary" disabled={savingScheduleId === schedule.id}>Save changes</button></div>
        </form></td></tr>}
        {deletingScheduleId === schedule.id && <tr className="automation-action-row"><td colSpan={7}><div className="inline-confirmation automation-delete-confirmation">
          <div><strong>Delete {schedule.name}?</strong><span>Future runs will stop. Run records and {schedule.generated_page_count ? `${schedule.generated_page_count} generated ${schedule.generated_page_count === 1 ? "page" : "pages"}` : "its generated-knowledge location"} will be retained.</span></div>
          <div className="inline-form-actions"><button onClick={() => setDeletingScheduleId(null)}>Cancel</button><button className="danger" disabled={savingScheduleId === schedule.id} onClick={() => deleteSchedule(schedule)}>Delete automation</button></div>
        </div></td></tr>}
      </Fragment>)}</tbody></table></div>}
      <details className="automation-form"><summary>New automation</summary><form onSubmit={createSchedule}>
        <label>Name<input required maxLength={160} value={scheduleName} onChange={(event) => {
          const nextName = event.target.value;
          setScheduleName(nextName);
          if (!automationKeyEdited) setAutomationKey(automationKeyFromName(nextName));
        }} placeholder="Morning context review" /></label>
        <label>Knowledge key<input required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={automationKey} onChange={(event) => {
          setAutomationKey(event.target.value);
          setAutomationKeyEdited(true);
        }} placeholder="morning-context-review" /><small>Pages will live under <code>automations/{automationKey || "your-key"}</code>. This key cannot be changed later.</small></label>
        <label>Instructions<textarea required rows={10} value={scheduleInstructions} onChange={(event) => setScheduleInstructions(event.target.value)} placeholder="Describe the scheduled workflow and expected result…" /><small>Context Use adds claim handling, knowledge persistence, and completion rules only when this automation runs.</small></label>
        <div className="form-row"><label>Cron expression<input required value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} /></label><label>Time zone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div>
        <label>Input JSON<textarea rows={4} value={scheduleInput} onChange={(event) => setScheduleInput(event.target.value)} /></label>
        <p className="form-note">The semantic knowledge key is permanent; the automation UUID remains internal provenance metadata.</p>
        <button className="primary">Create automation</button>
      </form></details>
    </section>

    <section>
      <div className="section-heading"><div><h2>Recent runs</h2><p>An outcome is a short completion note or failure reason. Full generated content stays in the automation’s knowledge pages.</p></div></div>
      {loading && recentRuns.length === 0 ? <p className="empty-note">Loading completed runs…</p> : recentRuns.length === 0 ? <p className="empty-note">No completed runs yet.</p> : <>
        <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Automation</th><th>Instructions</th><th>Completed</th><th>Outcome</th></tr></thead><tbody>{recentRuns.map((run) => <tr key={run.id}><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{run.schedule_name}</td><td>v{run.automation_version_number}</td><td>{formatDate(run.completed_at)}</td><RunOutcome run={run} /></tr>)}</tbody></table></div>
        <div className="recent-runs-pagination" ref={olderRunsSentinel} aria-live="polite">
          {nextCompletedRunCursor ? <>
            <span>Showing {recentRuns.length} of {completedRunTotals.succeeded + completedRunTotals.failed} completed runs.</span>
            <button type="button" disabled={loadingOlderRuns} onClick={() => loadOlderRuns().catch(() => undefined)}>
              {loadingOlderRuns ? "Loading older runs…" : olderRunsError ? "Retry loading older runs" : "Load older runs"}
            </button>
            {olderRunsError && <span className="recent-runs-error" role="alert">{olderRunsError}</span>}
          </> : <span>All {recentRuns.length} completed run{recentRuns.length === 1 ? " is" : "s are"} shown.</span>}
        </div>
      </>}
    </section>
  </main>;
}
