import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import type { AutomationRun, AutomationSkill, CronSchedule } from "../types.ts";

const WORKER_PROMPT = `Check Context Use for scheduled work. Call claim_due_run. If it returns a run, follow its SKILL.md using the supplied input. Persist run output only with the automation page tools and the supplied run ID and claim token; those tools confine writes to the returned knowledge path. When finished, call complete_run; if the work cannot be completed, call fail_run. Continue until claim_due_run returns null.`;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function parseInput(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Input must be a JSON object");
  return parsed as Record<string, unknown>;
}

export function Automations() {
  const [skills, setSkills] = useState<AutomationSkill[]>([]);
  const [schedules, setSchedules] = useState<CronSchedule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleSkill, setScheduleSkill] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [scheduleInput, setScheduleInput] = useState("{}");

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const nextRuns = await api<AutomationRun[]>("/api/dashboard/automations/runs");
      const [nextSkills, nextSchedules] = await Promise.all([
        api<AutomationSkill[]>("/api/dashboard/skills"),
        api<CronSchedule[]>("/api/dashboard/automations/schedules"),
      ]);
      setRuns(nextRuns);
      setSkills(nextSkills);
      setSchedules(nextSchedules);
      setScheduleSkill((current) => nextSkills.some((skill) => skill.current_version_id === current)
        ? current
        : nextSkills[0]?.current_version_id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load automations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const activeRuns = useMemo(() => runs.filter((run) => run.status === "ready" || run.status === "claimed"), [runs]);
  const recentRuns = useMemo(() => runs.filter((run) => run.status === "succeeded" || run.status === "failed"), [runs]);
  const selectedSkill = skills.find((skill) => skill.current_version_id === scheduleSkill);

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      const created = await api<CronSchedule>("/api/dashboard/automations/schedules", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleName,
          skill_version_id: scheduleSkill,
          cron_expression: cronExpression,
          timezone,
          input: parseInput(scheduleInput),
          enabled: true,
        }),
      });
      setScheduleName("");
      setScheduleInput("{}");
      setMessage(`Automation created. Generated pages are confined to ${created.knowledge_path}.`);
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create automation");
    }
  };

  const saveSchedule = async (schedule: CronSchedule, changes: Partial<CronSchedule>) => {
    const next = { ...schedule, ...changes };
    await api(`/api/dashboard/automations/schedules/${schedule.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: next.name,
        skill_version_id: next.skill_version_id,
        cron_expression: next.cron_expression,
        timezone: next.timezone,
        input: next.input,
        enabled: next.enabled,
      }),
    });
    await load(true);
  };

  const editSchedule = async (schedule: CronSchedule) => {
    const name = window.prompt("Automation name", schedule.name);
    if (!name) return;
    const expression = window.prompt("Five-field cron expression", schedule.cron_expression);
    if (!expression) return;
    const zone = window.prompt("IANA time zone", schedule.timezone);
    if (!zone) return;
    const input = window.prompt("JSON input", JSON.stringify(schedule.input, null, 2));
    if (input === null) return;
    try {
      await saveSchedule(schedule, { name, cron_expression: expression, timezone: zone, input: parseInput(input) });
      setMessage("Automation updated. Its knowledge folder is unchanged.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automation");
    }
  };

  return <main className="content-page automations-page">
    <header><div><span className="eyebrow">Scheduled agent work</span><h1>Automations</h1><p>Each automation combines a reusable skill with a cron trigger, durable run history, and an isolated generated-knowledge folder.</p></div><button onClick={() => load().catch(() => undefined)}>Refresh</button></header>
    {message && <div className="automation-message">{message}</div>}

    <section className="worker-card">
      <div><span className="eyebrow">Generic worker</span><h2>Worker prompt</h2><p>Schedule this same polling prompt on any connected agent.</p></div>
      <pre>{WORKER_PROMPT}</pre>
      <button onClick={() => navigator.clipboard.writeText(WORKER_PROMPT)
        .then(() => setMessage("Worker prompt copied."))
        .catch(() => setMessage("Could not copy the prompt; select the text manually."))}>Copy prompt</button>
    </section>

    <div className="automation-stats">
      <article><strong>{runs.filter((run) => run.status === "ready").length}</strong><span>Ready</span></article>
      <article><strong>{runs.filter((run) => run.status === "claimed").length}</strong><span>Claimed</span></article>
      <article><strong>{runs.filter((run) => run.status === "succeeded").length}</strong><span>Succeeded</span></article>
      <article><strong>{runs.filter((run) => run.status === "failed").length}</strong><span>Failed</span></article>
    </div>

    <section>
      <div className="section-heading"><div><h2>Ready and claimed runs</h2><p>Due automations appear here until an agent reports their outcome.</p></div></div>
      {loading ? <p>Loading runs…</p> : activeRuns.length === 0 ? <p className="empty-note">Nothing is waiting for an agent.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Automation</th><th>Skill</th><th>Scheduled</th><th>Agent</th></tr></thead><tbody>{activeRuns.map((run) => <tr key={run.id}><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{run.schedule_name}</td><td>{run.skill_name} <small>v{run.skill_version_number}</small></td><td>{formatDate(run.scheduled_for)}</td><td>{run.claimed_by ?? "—"}</td></tr>)}</tbody></table></div>}
    </section>

    <section>
      <div className="section-heading"><div><h2>Automations</h2><p>Cron is the trigger; every row also owns one immutable knowledge location.</p></div></div>
      {schedules.length === 0 ? <p className="empty-note">Create a skill first, then create an automation here.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Automation</th><th>Skill</th><th>Schedule</th><th>Generated knowledge</th><th>Next run</th><th>State</th><th></th></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.name}</strong></td><td>{schedule.skill_name} <small>v{schedule.skill_version_number}</small></td><td><code>{schedule.cron_expression}</code><small>{schedule.timezone}</small></td><td className="knowledge-location"><code>{schedule.knowledge_path}</code><small>{schedule.generated_page_count} page{schedule.generated_page_count === 1 ? "" : "s"}</small></td><td>{formatDate(schedule.next_run_at)}</td><td><span className={`run-status ${schedule.enabled ? "succeeded" : "disabled"}`}>{schedule.enabled ? "enabled" : "paused"}</span></td><td><div className="table-actions"><button onClick={() => editSchedule(schedule)}>Edit</button><button onClick={() => saveSchedule(schedule, { enabled: !schedule.enabled }).catch((error: Error) => setMessage(error.message))}>{schedule.enabled ? "Pause" : "Enable"}</button></div></td></tr>)}</tbody></table></div>}
      <details className="automation-form"><summary>New automation</summary><form onSubmit={createSchedule}>
        <label>Name<input required maxLength={160} value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} placeholder="Morning context review" /></label>
        <label>Skill<select required value={scheduleSkill} onChange={(event) => setScheduleSkill(event.target.value)}><option value="" disabled>Select a skill</option>{skills.map((skill) => <option key={skill.id} value={skill.current_version_id}>{skill.name} · v{skill.version_number}</option>)}</select>{selectedSkill && <small>{selectedSkill.description}</small>}</label>
        <div className="form-row"><label>Cron expression<input required value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} /></label><label>Time zone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div>
        <label>Input JSON<textarea rows={4} value={scheduleInput} onChange={(event) => setScheduleInput(event.target.value)} /></label>
        <p className="form-note">Context Use assigns a stable folder under <code>generated/automations/</code> when this automation is created.</p>
        <button className="primary" disabled={!skills.length}>Create automation</button>
      </form></details>
    </section>

    <section>
      <div className="section-heading"><div><h2>Recent runs</h2><p>Completed outcomes remain in Context Use even when the executing agent changes.</p></div></div>
      {recentRuns.length === 0 ? <p className="empty-note">No completed runs yet.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Automation</th><th>Skill</th><th>Completed</th><th>Outcome</th></tr></thead><tbody>{recentRuns.map((run) => <tr key={run.id}><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{run.schedule_name}</td><td>{run.skill_name} <small>v{run.skill_version_number}</small></td><td>{formatDate(run.completed_at)}</td><td className="run-outcome">{run.result_summary ?? run.error_message ?? "—"}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
