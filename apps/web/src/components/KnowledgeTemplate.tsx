import {
  summarizeTemplateResult,
  type TemplateAction,
  type TemplateResult,
} from "@context-use/shared";
import { useState } from "react";
import { api } from "../api.ts";
import { ActionDialog } from "./ActionDialog.tsx";

function actionSymbol(action: TemplateAction): string {
  if (action.action === "conflict") return "!";
  if (action.action.startsWith("create")) return "+";
  return "~";
}

export function TemplatePlan({ result }: { result: TemplateResult }) {
  const summary = summarizeTemplateResult(result);
  const visibleActions = result.actions.filter(({ action }) => action !== "unchanged");

  if (!visibleActions.length) {
    return <div className="template-current"><span aria-hidden="true">✓</span><div><strong>Template is current</strong><small>Your knowledge base matches the default template bundled with this release.</small></div></div>;
  }

  return <div className="template-plan">
    <div className="template-summary" aria-label="Template plan summary">
      <span><strong>{summary.changes}</strong> change{summary.changes === 1 ? "" : "s"}</span>
      <span className={summary.conflicts ? "has-conflicts" : ""}><strong>{summary.conflicts}</strong> conflict{summary.conflicts === 1 ? "" : "s"}</span>
      {summary.replacements > 0 && <span className="has-replacements"><strong>{summary.replacements}</strong> local replacement{summary.replacements === 1 ? "" : "s"}</span>}
    </div>
    <ul className="template-actions">
      {visibleActions.map((action, index) => <li className={action.action === "conflict" ? "conflict" : action.replaces_local ? "replacement" : ""} key={`${action.action}:${action.path}:${index}`}>
        <span className="template-action-symbol" aria-hidden="true">{actionSymbol(action)}</span>
        <div><code>{action.path || "/"}</code><span>{action.detail}</span></div>
      </li>)}
    </ul>
  </div>;
}

export function KnowledgeTemplateSettings({
  onKnowledgeChanged,
}: {
  onKnowledgeChanged: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<TemplateResult | null>(null);
  const [forceTemplate, setForceTemplate] = useState(false);
  const [plannedForce, setPlannedForce] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [message, setMessage] = useState("");

  const loadPlan = async (force: boolean) => {
    setChecking(true);
    setCheckError("");
    setMessage("");
    try {
      const suffix = force ? "?force_template=true" : "";
      setPlan(await api<TemplateResult>(`/api/dashboard/knowledge-template/plan${suffix}`));
      setPlannedForce(force);
    } catch (error) {
      setPlan(null);
      setCheckError(error instanceof Error ? error.message : "Could not check the knowledge template");
    } finally {
      setChecking(false);
    }
  };

  const checkForUpdates = async () => {
    setForceTemplate(false);
    await loadPlan(false);
  };

  const changeForceTemplate = async (force: boolean) => {
    setForceTemplate(force);
    await loadPlan(force);
  };

  const applyTemplate = async () => {
    if (!plan) return;
    setApplying(true);
    setApplyError("");
    try {
      const result = await api<TemplateResult>("/api/dashboard/knowledge-template/apply", {
        method: "POST",
        body: JSON.stringify({ force_template: forceTemplate }),
      });
      const summary = summarizeTemplateResult(result);
      setConfirming(false);
      setForceTemplate(false);
      setPlannedForce(false);
      setMessage(`Applied ${summary.changes} template change${summary.changes === 1 ? "" : "s"}.${summary.conflicts ? ` Preserved ${summary.conflicts} conflict${summary.conflicts === 1 ? "" : "s"}.` : ""}`);
      await onKnowledgeChanged().catch(() => undefined);
      try {
        setPlan(await api<TemplateResult>("/api/dashboard/knowledge-template/plan"));
      } catch {
        setPlan(null);
        setCheckError("The template was applied, but its current status could not be rechecked.");
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Could not apply the knowledge template");
    } finally {
      setApplying(false);
    }
  };

  const summary = plan ? summarizeTemplateResult(plan) : null;
  const hasWork = Boolean(summary && (summary.changes || summary.conflicts));
  const planMatchesChoice = plannedForce === forceTemplate;

  return <section className="template-settings">
    <h2>Knowledge template</h2>
    <p>Compare your knowledge base with the latest default template included in this Context Use release. Local edits are reported as conflicts and preserved unless you explicitly choose to replace eligible customizations.</p>
    <button className="primary" disabled={checking || applying} onClick={() => void checkForUpdates()}>{checking && !plan ? "Checking…" : "Check for template updates"}</button>
    {checkError && <p className="error" role="alert">{checkError}</p>}
    {message && <p className="template-message" role="status">{message}</p>}
    {plan && <div className={`template-result${checking ? " checking" : ""}`} aria-busy={checking}>
      <TemplatePlan result={plan} />
      {(summary!.conflicts > 0 || forceTemplate) && <label className="template-force-option">
        <input type="checkbox" checked={forceTemplate} disabled={checking || applying} onChange={(event) => void changeForceTemplate(event.currentTarget.checked)} />
        <span><strong>Replace eligible local customizations</strong><small>Preview and overwrite changed directory metadata, active guides, and managed template pages. Archived, published, structurally invalid, and create-only content remains protected.</small></span>
      </label>}
      {hasWork && <div className="template-controls">
        <button className={forceTemplate ? "danger" : "primary"} disabled={checking || applying || !summary!.changes || !planMatchesChoice} onClick={() => { setApplyError(""); setConfirming(true); }}>
          {forceTemplate ? "Force template update" : "Apply safe changes"}
        </button>
        {checking && <span>Refreshing preview…</span>}
      </div>}
    </div>}
    {confirming && plan && <ActionDialog
      eyebrow="Knowledge template"
      title={forceTemplate ? "Force this template update?" : "Apply this template update?"}
      description={forceTemplate
        ? `Apply ${summary!.changes} changes, including ${summary!.replacements} eligible local replacement${summary!.replacements === 1 ? "" : "s"}. Content protected by ${summary!.conflicts} remaining conflict${summary!.conflicts === 1 ? "" : "s"} will be preserved.`
        : `Apply ${summary!.changes} safe template change${summary!.changes === 1 ? "" : "s"}. ${summary!.conflicts} local conflict${summary!.conflicts === 1 ? "" : "s"} will be preserved.`}
      confirmLabel={forceTemplate ? "Force update" : "Apply changes"}
      workingLabel="Applying template…"
      confirmTone={forceTemplate ? "danger" : "primary"}
      working={applying}
      error={applyError}
      onCancel={() => { setApplyError(""); setConfirming(false); }}
      onConfirm={() => void applyTemplate()}
    />}
  </section>;
}
