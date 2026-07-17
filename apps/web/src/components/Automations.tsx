import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import type { AutomationRun, AutomationSkill, CronSchedule } from "../types.ts";

const WORKER_PROMPT = `Check Context Use for scheduled work. Call claim_due_run. If it returns a run, follow the supplied skill instructions using the supplied input. When finished, call complete_run with the run ID and claim token; if the work cannot be completed, call fail_run with a concise error. Continue until claim_due_run returns null.`;

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
  const [skillName, setSkillName] = useState("");
  const [instructions, setInstructions] = useState("");
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
        api<AutomationSkill[]>("/api/dashboard/automations/skills"),
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

  const createSkill = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/dashboard/automations/skills", {
        method: "POST",
        body: JSON.stringify({ name: skillName, instructions_markdown: instructions, commit_message: "Create automation skill" }),
      });
      setSkillName("");
      setInstructions("");
      setMessage("Skill created and stored in Context Use.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create skill");
    }
  };

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/dashboard/automations/schedules", {
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
      setMessage("Cron schedule created.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create schedule");
    }
  };

  const updateSkill = async (skill: AutomationSkill) => {
    const nextInstructions = window.prompt("Skill instructions for the new version", skill.instructions_markdown);
    if (nextInstructions === null || !nextInstructions.trim()) return;
    const commitMessage = window.prompt("Describe this change", "Update automation skill");
    if (!commitMessage) return;
    try {
      await api(`/api/dashboard/automations/skills/${skill.id}`, {
        method: "PUT",
        body: JSON.stringify({
          instructions_markdown: nextInstructions,
          commit_message: commitMessage,
          expected_version_number: skill.version_number,
        }),
      });
      setMessage("A new immutable skill version was created. Future scheduled runs will use it.");
      await load(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update skill");
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
    const name = window.prompt("Schedule name", schedule.name);
    if (!name) return;
    const expression = window.prompt("Five-field cron expression", schedule.cron_expression);
    if (!expression) return;
    const zone = window.prompt("IANA time zone", schedule.timezone);
    if (!zone) return;
    const input = window.prompt("JSON input", JSON.stringify(schedule.input, null, 2));
    if (input === null) return;
    try {
      await saveSchedule(schedule, { name, cron_expression: expression, timezone: zone, input: parseInput(input) });
      setMessage("Schedule updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update schedule");
    }
  };

  return <main className="content-page automations-page">
    <header><div><span className="eyebrow">Portable agent work</span><h1>Automations</h1><p>Context Use owns the schedules, skills, and run history. Connected agents only claim and execute ready work.</p></div><button onClick={() => load().catch(() => undefined)}>Refresh</button></header>
    {message && <div className="automation-message">{message}</div>}

    <section className="worker-card">
      <div><span className="eyebrow">Generic agent cron</span><h2>Worker prompt</h2><p>Schedule this same prompt on any connected agent, for example every 30 minutes.</p></div>
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
      <div className="section-heading"><div><h2>Ready and claimed runs</h2><p>Due schedules appear here until an agent reports their outcome.</p></div></div>
      {loading ? <p>Loading runs…</p> : activeRuns.length === 0 ? <p className="empty-note">Nothing is waiting for an agent.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Schedule</th><th>Skill</th><th>Scheduled</th><th>Agent</th></tr></thead><tbody>{activeRuns.map((run) => <tr key={run.id}><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{run.schedule_name}</td><td>{run.skill_name} <small>v{run.skill_version_number}</small></td><td>{formatDate(run.scheduled_for)}</td><td>{run.claimed_by ?? "—"}</td></tr>)}</tbody></table></div>}
    </section>

    <section>
      <div className="section-heading"><div><h2>Cron schedules</h2><p>Five-field cron expressions are evaluated in the selected time zone.</p></div></div>
      {schedules.length === 0 ? <p className="empty-note">Create a skill, then attach its first schedule.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Schedule</th><th>Skill</th><th>Cron</th><th>Next run</th><th>State</th><th></th></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.name}</strong></td><td>{schedule.skill_name} <small>v{schedule.skill_version_number}</small></td><td><code>{schedule.cron_expression}</code><small>{schedule.timezone}</small></td><td>{formatDate(schedule.next_run_at)}</td><td><span className={`run-status ${schedule.enabled ? "succeeded" : "disabled"}`}>{schedule.enabled ? "enabled" : "paused"}</span></td><td><div className="table-actions"><button onClick={() => editSchedule(schedule)}>Edit</button><button onClick={() => saveSchedule(schedule, { enabled: !schedule.enabled }).catch((error: Error) => setMessage(error.message))}>{schedule.enabled ? "Pause" : "Enable"}</button></div></td></tr>)}</tbody></table></div>}
      <details className="automation-form"><summary>New cron schedule</summary><form onSubmit={createSchedule}><label>Name<input required maxLength={160} value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} placeholder="Morning context review" /></label><label>Skill<select required value={scheduleSkill} onChange={(event) => setScheduleSkill(event.target.value)}><option value="" disabled>Select a skill</option>{skills.map((skill) => <option key={skill.id} value={skill.current_version_id}>{skill.name} · v{skill.version_number}</option>)}</select></label><div className="form-row"><label>Cron expression<input required value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} /></label><label>Time zone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label></div><label>Input JSON<textarea rows={4} value={scheduleInput} onChange={(event) => setScheduleInput(event.target.value)} /></label><button className="primary" disabled={!skills.length}>Create schedule</button></form></details>
    </section>

    <section>
      <div className="section-heading"><div><h2>Skills</h2><p>Each edit creates an immutable version. Existing runs keep the version they started with.</p></div></div>
      <div className="skill-grid">{skills.map((skill) => <article key={skill.id}><div><strong>{skill.name}</strong><span>Version {skill.version_number} · {skill.schedule_count} schedule{skill.schedule_count === 1 ? "" : "s"}</span></div><p>{skill.instructions_markdown}</p><footer><small>{skill.commit_message}</small><button onClick={() => updateSkill(skill)}>New version</button></footer></article>)}</div>
      <details className="automation-form"><summary>New skill</summary><form onSubmit={createSkill}><label>Name<input required maxLength={160} value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="Review project context" /></label><label>Skill instructions<textarea required rows={10} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the outcome, context to inspect, tools to use, and what should be persisted…" /></label><button className="primary">Create skill</button></form></details>
    </section>

    <section>
      <div className="section-heading"><div><h2>Recent runs</h2><p>Completed outcomes remain in Context Use even when the executing agent changes.</p></div></div>
      {recentRuns.length === 0 ? <p className="empty-note">No completed runs yet.</p> : <div className="automation-table-wrap"><table className="automation-table"><thead><tr><th>Status</th><th>Schedule</th><th>Skill</th><th>Completed</th><th>Outcome</th></tr></thead><tbody>{recentRuns.map((run) => <tr key={run.id}><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{run.schedule_name}</td><td>{run.skill_name} <small>v{run.skill_version_number}</small></td><td>{formatDate(run.completed_at)}</td><td className="run-outcome">{run.result_summary ?? run.error_message ?? "—"}</td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}
