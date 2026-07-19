import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { AgentSkill } from "../types.ts";

export function Skills() {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editCommitMessage, setEditCommitMessage] = useState("Update skill");
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSkills(await api<AgentSkill[]>("/api/dashboard/skills"));
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

  const startEditing = (skill: AgentSkill) => {
    setDeletingSkillId(null);
    setEditingSkillId(skill.id);
    setEditDescription(skill.description);
    setEditInstructions(skill.instructions_markdown);
    setEditCommitMessage("Update skill");
    setMessage("");
  };

  const updateSkill = async (event: React.FormEvent, skill: AgentSkill) => {
    event.preventDefault();
    setSavingSkillId(skill.id);
    setMessage("");
    try {
      await api(`/api/dashboard/skills/${skill.id}`, {
        method: "PUT",
        body: JSON.stringify({
          description: editDescription,
          instructions_markdown: editInstructions,
          commit_message: editCommitMessage,
          expected_version_number: skill.version_number,
        }),
      });
      setEditingSkillId(null);
      setMessage("A new immutable skill version was created. Future runs will use it.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update skill");
    } finally {
      setSavingSkillId(null);
    }
  };

  const deleteSkill = async (skill: AgentSkill) => {
    setSavingSkillId(skill.id);
    setMessage("");
    try {
      await api(`/api/dashboard/skills/${skill.id}`, { method: "DELETE" });
      setDeletingSkillId(null);
      setMessage(`Skill “${skill.name}” deleted.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete skill");
    } finally {
      setSavingSkillId(null);
    }
  };

  return <main className="content-page automations-page skills-page">
    <header><div><span className="eyebrow">Capability library</span><h1>Skills</h1><p>Reusable instructions that give connected agents a dependable way to work with your context.</p></div></header>
    {message && <div className="automation-message">{message}</div>}

    <aside className="skill-standard-note">
      <span className="skill-note-mark" aria-hidden="true">✦</span>
      <div><span className="eyebrow">SKILL.md standard</span><h2>Small on discovery. Detailed on demand.</h2></div>
      <p>Agents scan names and descriptions first, then load complete instructions only when the capability is relevant.</p>
    </aside>

    <section>
      <div className="section-heading"><div><h2>Available skills</h2><p>{skills.length} reusable {skills.length === 1 ? "capability" : "capabilities"} in this workspace.</p></div></div>
      {loading ? <p>Loading skills…</p> : skills.length === 0 ? <p className="empty-note">No skills are available yet.</p> : <div className="skill-grid">{skills.map((skill) => <article className={editingSkillId === skill.id || deletingSkillId === skill.id ? "is-expanded" : ""} key={skill.id}>
        <span className="skill-glyph" aria-hidden="true">✦</span>
        <div><strong>{skill.name}</strong><span>Version {skill.version_number}</span></div>
        <p className="skill-description">{skill.description}</p>
        <details><summary>View SKILL.md</summary><pre>{skill.skill_markdown}</pre></details>
        <footer><small>{skill.commit_message}</small><button onClick={() => startEditing(skill)}>Edit</button><button className="danger-text" onClick={() => { setEditingSkillId(null); setDeletingSkillId(skill.id); setMessage(""); }}>Delete</button></footer>
        {editingSkillId === skill.id && <form className="inline-dashboard-form skill-inline-editor" onSubmit={(event) => updateSkill(event, skill)}>
          <div className="inline-form-heading"><div><strong>Edit {skill.name}</strong><span>Saving creates immutable version {skill.version_number + 1}.</span></div></div>
          <label>Short description<textarea required maxLength={1024} rows={3} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
          <label>Instruction body<textarea required rows={10} value={editInstructions} onChange={(event) => setEditInstructions(event.target.value)} /></label>
          <label>Change note<input required minLength={3} maxLength={240} value={editCommitMessage} onChange={(event) => setEditCommitMessage(event.target.value)} /></label>
          <div className="inline-form-actions"><button type="button" onClick={() => setEditingSkillId(null)}>Cancel</button><button className="primary" disabled={savingSkillId === skill.id}>Save new version</button></div>
        </form>}
        {deletingSkillId === skill.id && <div className="inline-confirmation skill-delete-confirmation">
          <div><strong>Delete {skill.name}?</strong><span>It will disappear from agent discovery. Existing versions are retained.</span></div>
          <div className="inline-form-actions"><button onClick={() => setDeletingSkillId(null)}>Cancel</button><button className="danger" disabled={savingSkillId === skill.id} onClick={() => deleteSkill(skill)}>Delete skill</button></div>
        </div>}
      </article>)}</div>}
      <details className="automation-form"><summary>New skill</summary><form onSubmit={createSkill}>
        <label>Name<input required minLength={1} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={name} onChange={(event) => setName(event.target.value)} placeholder="review-project-context" /><small>Lowercase letters, numbers, and single hyphens; maximum 64 characters.</small></label>
        <label>Short description<textarea required maxLength={1024} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Reviews current project context and records decisions. Use when preparing a periodic project health check." /></label>
        <label>Instruction body<textarea required rows={10} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the reusable workflow, context to inspect, tools to use, and expected result…" /></label>
        <button className="primary">Create skill</button>
      </form></details>
    </section>
  </main>;
}
