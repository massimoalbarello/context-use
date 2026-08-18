/**
 * Renders a LoCoMo run as a reviewable page: every question with its answer, the gold it
 * was scored against, what it cost, and how each scorer judged it.
 *
 * Gold is read from the pinned dataset rather than from the run, because run artifacts
 * deliberately carry no reference answers. The output is a local file for that reason too.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentToolCalls } from "../agent.ts";
import { selectAndReadLocomoConversations, LOCOMO_CATEGORIES } from "../../data/locomo-v1/dataset.ts";
import { LOCOMO_DATASET_PATH } from "../../data/locomo-v1/manifest.ts";

export function renderLocomoView(runDir: string): string {
  const report = JSON.parse(readFileSync(join(runDir, "report.json"), "utf8"));
  const scorePath = join(runDir, "qa-score.json");
  const score = existsSync(scorePath) ? JSON.parse(readFileSync(scorePath, "utf8")) : null;
  const scoreById = new Map<string, any>((score?.questions ?? []).map((q: any) => [q.questionId, q]));

  const gold = new Map<string, string>();
  for (const conv of report.conversations) {
    const [c] = selectAndReadLocomoConversations(LOCOMO_DATASET_PATH, { conversationId: conv.sampleId });
    for (const q of c!.questions) gold.set(q.id, q.referenceAnswer);
  }

  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const pct = (v: number | undefined) => v === undefined ? "—" : `${(v * 100).toFixed(0)}%`;
  const bare = (t: string) => t.replace("mcp__context_use_eval__", "");

  /** Fall back to transcript mtimes for runs recorded before cost instrumentation existed. */
  function derivedCalls(conv: any, questionId: string): Record<string, number> {
    const idx = String(report.conversations.indexOf(conv) + 1).padStart(3, "0");
    const dir = join(runDir, `${idx}-${conv.sampleId.replace(/[^A-Za-z0-9_-]/g, "-")}`, "qa");
    return existsSync(dir) ? agentToolCalls(dir, `qa-${questionId}`, report.provider) : {};
  }

  const TOOLS = new Set<string>();
  const rows: any[] = [];
  for (const conv of report.conversations) {
    for (const q of conv.questions) {
      const calls = q.toolCalls ?? derivedCalls(conv, q.questionId);
      for (const t of Object.keys(calls)) TOOLS.add(bare(t));
      rows.push({ conv: conv.sampleId, q, calls, s: scoreById.get(q.questionId) });
    }
  }
  const toolCols = [...TOOLS].sort();
  const durations = rows.map((r) => r.q.durationMs).filter((d): d is number => typeof d === "number");
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

  const catRows = (score?.byCategory ?? []).map((c: any) => `<tr>
    <td>${c.category} ${esc(c.name)}</td><td class=n>${c.total}</td>
    <td class=n>${pct(c.officialF1)}</td><td class=n>${pct(c.amem.f1)}</td>
    <td class=n>${pct(c.amem.bleu1)}</td><td class=n>${c.judged ? pct(c.judged.accuracy) : "—"}</td></tr>`).join("");

  const body = rows.map(({ conv, q, calls, s }) => {
    const total = Object.values(calls).reduce((a: number, b: any) => a + b, 0);
    const verdict = s?.judgeCorrect === undefined ? "" : s.judgeCorrect ? "ok" : "bad";
    return `<tr class="${verdict}">
      <td class=meta><span class=conv>${esc(conv)}</span><br><span class=qid>${esc(q.questionId)}</span><br>
        <span class="cat c${q.category}">${q.category} ${esc(q.categoryName)}</span></td>
      <td class=q>${esc(q.question)}</td>
      <td class=a>${q.hypothesis === undefined ? `<span class=void>void: ${esc(q.voidReason)}</span>` : esc(q.hypothesis)}</td>
      <td class=g>${q.category === 5
        ? `<span class=decline>decline — &ldquo;not mentioned&rdquo;</span>`
          + `<br><span class=distractor>unsupported claim: ${esc(gold.get(q.questionId))}</span>`
        : esc(gold.get(q.questionId))}</td>
      <td class=n>${s ? pct(s.officialF1) : "—"}</td>
      <td class=n>${s?.judgeCorrect === undefined ? "—" : s.judgeCorrect ? "✓" : "✗"}</td>
      <td class=n>${q.durationMs === undefined ? "—" : (q.durationMs / 1000).toFixed(1) + "s"}</td>
      ${toolCols.map((t) => `<td class="n tool">${(calls as any)[`mcp__context_use_eval__${t}`] ?? (calls as any)[t] ?? ""}</td>`).join("")}
      <td class="n total">${total || ""}</td>
    </tr>`;
  }).join("");

  const html = `<title>LoCoMo run — ${esc(report.runId)}</title>
  <style>
  :root{--bg:#fff;--fg:#1a1a1a;--dim:#6b7280;--line:#e5e7eb;--ok:#16a34a;--bad:#dc2626;
    --okbg:#f0fdf4;--badbg:#fef2f2;--head:#f9fafb;--accent:#2563eb}
  :root:not([data-theme=light]) ,:root[data-theme=dark]{}
  @media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f1115;--fg:#e5e7eb;--dim:#9ca3af;
    --line:#262b36;--okbg:#0e1a12;--badbg:#1c1113;--head:#151922;--accent:#60a5fa}}
  :root[data-theme=dark]{--bg:#0f1115;--fg:#e5e7eb;--dim:#9ca3af;--line:#262b36;--okbg:#0e1a12;
    --badbg:#1c1113;--head:#151922;--accent:#60a5fa}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--fg);margin:0;padding:24px;
    font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  h1{font-size:20px;margin:0 0 4px} .sub{color:var(--dim);margin-bottom:20px;font-size:13px}
  .cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px}
  .card{border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:130px}
  .card .v{font-size:22px;font-weight:600} .card .k{color:var(--dim);font-size:12px}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th{background:var(--head);text-align:left;padding:8px 10px;font-weight:600;
    border-bottom:1px solid var(--line);position:sticky;top:0;white-space:nowrap}
  td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  tr.ok td{background:var(--okbg)} tr.bad td{background:var(--badbg)}
  td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  td.tool{color:var(--dim)} td.total{font-weight:600}
  td.q{min-width:230px} td.a{min-width:260px} td.g{min-width:180px;color:var(--dim)}
  td.meta{white-space:nowrap;font-size:11px;color:var(--dim)}
  .conv{color:var(--fg);font-weight:600} .qid{font-family:ui-monospace,monospace}
  .cat{display:inline-block;margin-top:3px;padding:1px 6px;border-radius:99px;
    border:1px solid var(--line);font-size:10px}
  .void{color:var(--bad)}\n.decline{color:var(--fg);font-weight:600}\n.distractor{color:var(--dim);font-size:11px;font-style:italic} .summary{margin:24px 0 10px;font-size:16px;font-weight:600}
  </style>
  <h1>LoCoMo run — ${esc(report.runId)}</h1>
  <div class=sub>${esc(report.provider)}${report.model ? " · " + esc(report.model) : ""} ·
    ${report.conversations.length} conversation(s) · ${rows.length} questions ·
    dataset ${esc(report.dataset.revision.slice(0, 10))}</div>
  <div class=cards>
    <div class=card><div class=v>${score ? pct(score.officialF1) : "—"}</div><div class=k>official LoCoMo F1</div></div>
    <div class=card><div class=v>${score ? pct(score.amem.f1) : "—"}</div><div class=k>A-mem F1</div></div>
    <div class=card><div class=v>${score ? pct(score.amem.bleu1) : "—"}</div><div class=k>A-mem BLEU-1</div></div>
    <div class=card><div class=v>${score?.judge ? pct(score.judge.accuracy) : "—"}</div><div class=k>judge</div></div>
    <div class=card><div class=v>${durations.length ? (mean(durations) / 1000).toFixed(1) + "s" : "—"}</div><div class=k>mean latency</div></div>
    <div class=card><div class=v>${mean(rows.map((r) => Object.values(r.calls).reduce((a: number, b: any) => a + b, 0))).toFixed(1)}</div><div class=k>mean tool calls</div></div>
  </div>
  ${catRows ? `<div class=summary>By category</div><div class=scroll><table>
  <tr><th>category</th><th>n</th><th>official F1</th><th>A-mem F1</th><th>BLEU-1</th><th>judge</th></tr>
  ${catRows}</table></div>` : ""}
  <div class=summary>Every question</div>
  <div class=scroll><table>
  <tr><th></th><th>question</th><th>answer</th><th>expected<br><span style="font-weight:400;color:var(--dim);font-size:10px">cat 5: decline</span></th><th>F1</th><th>judge</th><th>time</th>
  ${toolCols.map((t) => `<th>${esc(t)}</th>`).join("")}<th>calls</th></tr>
  ${body}</table></div>`;

  return html;
}
