import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { AutomationSkill } from "../types.ts";

export function Skills() {
  const [skills, setSkills] = useState<AutomationSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setSkills(await api<AutomationSkill[]>("/api/dashboard/skills"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load skills");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => undefined); }, []);

  const createSkill = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      await api("/api/dashboard/skills", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          instructions_markdown: instructions,
          commit_message: "Create skill",
        }),
      });
      setName("");
      setDescription("");
      setInstructions("");
      setMessage("Skill created and available for agent discovery.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create skill");
    }
  };

  const updateSkill = async (skill: AutomationSkill) => {
    const nextDescription = window.prompt("Short description: what this skill does and when to use it", skill.description);
    if (nextDescription === null || !nextDescription.trim()) return;
    const nextInstructions = window.prompt("Skill instructions for the new version", skill.instructions_markdown);
    if (nextInstructions === null || !nextInstructions.trim()) return;
    const commitMessage = window.prompt("Describe this change", "Update skill");
    if (!commitMessage) return;
    try {
      await api(`/api/dashboard/skills/${skill.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: nextDescription,
          instructions_markdown: nextInstructions,
          commit_message: commitMessage,
          expected_version_number: skill.version_number,
        }),
      });
      setMessage("A new immutable skill version was created. Future runs will use it.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update skill");
    }
  };

  return <main className="content-page automations-page skills-page">
    <header><div><span className="eyebrow">Capability library</span><h1>Skills</h1><p>Reusable instructions that give connected agents a dependable way to work with your context.</p></div><button onClick={() => load().catch(() => undefined)}>Refresh library</button></header>
    {message && <div className="automation-message">{message}</div>}

    <aside className="skill-standard-note">
      <span className="skill-note-mark" aria-hidden="true">✦</span>
      <div><span className="eyebrow">SKILL.md standard</span><h2>Small on discovery. Detailed on demand.</h2></div>
      <p>Agents scan names and descriptions first, then load complete instructions only when the capability is relevant.</p>
    </aside>

    <section>
      <div className="section-heading"><div><h2>Available skills</h2><p>{skills.length} reusable {skills.length === 1 ? "capability" : "capabilities"} in this workspace.</p></div></div>
      {loading ? <p>Loading skills…</p> : skills.length === 0 ? <p className="empty-note">No skills are available yet.</p> : <div className="skill-grid">{skills.map((skill) => <article key={skill.id}>
        <span className="skill-glyph" aria-hidden="true">✦</span>
        <div><strong>{skill.name}</strong><span>Version {skill.version_number} · {skill.schedule_count} automation{skill.schedule_count === 1 ? "" : "s"}</span></div>
        <p className="skill-description">{skill.description}</p>
        <details><summary>View SKILL.md</summary><pre>{skill.skill_markdown}</pre></details>
        <footer><small>{skill.commit_message}</small><button onClick={() => updateSkill(skill)}>New version</button></footer>
      </article>)}</div>}
      <details className="automation-form"><summary>New skill</summary><form onSubmit={createSkill}>
        <label>Name<input required minLength={1} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={name} onChange={(event) => setName(event.target.value)} placeholder="review-project-context" /><small>Lowercase letters, numbers, and single hyphens; maximum 64 characters.</small></label>
        <label>Short description<textarea required maxLength={1024} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Reviews current project context and records decisions. Use when preparing a periodic project health check." /></label>
        <label>Instruction body<textarea required rows={10} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the workflow, context to inspect, tools to use, and expected result…" /></label>
        <button className="primary">Create skill</button>
      </form></details>
    </section>
  </main>;
}
