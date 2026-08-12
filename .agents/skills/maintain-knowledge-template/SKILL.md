---
name: maintain-knowledge-template
description: Maintain or refactor the repository's default knowledge-base template without semantic drift. Use when editing packages/database/templates/default AGENTS.md guides, managed automation instructions, directory or page metadata, or their regression tests; when moving duplicated guidance to its proper owner; or when simplifying prompts while preserving distillation and diary eval behavior.
---

# Maintain Knowledge Template

Keep each rule in one authoritative layer and preserve behavior while improving clarity.

## 1. Establish the current contract

Start from the latest remote default branch and inspect the complete affected guidance chain,
metadata, template tests and relevant eval assertions. Read recent history when wording may
encode a regression fix.

Record the behaviors that must survive before editing. In particular, protect:

- whole-record noise rejection followed by exhaustive extraction from retained evidence;
- global identifiability without engagement, repetition or importance gates;
- one-record-at-a-time reconciliation and checkpoint safety;
- canonical entities, contextual mutual links and dated entity timelines;
- diary composition from exact changed evidence rather than page rewrites or run time;
- owner-authored material, conflicting evidence and multi-writer boundaries.

## 2. Assign one owner to every rule

Use this ownership model:

- Root `AGENTS.md`: invariants that apply to every knowledge write.
- Entity or subtree `AGENTS.md`: subject boundary, paths, local page responsibilities,
  timeline eligibility and genuine exceptions within that subtree.
- `automations/AGENTS.md`: storage and harness conventions shared by automations.
- Automation `instructions`: ordered input, processing, checkpoint, failure and reporting
  workflow only.
- Tool descriptions: argument and response semantics already enforced by the tool surface.
- Tests: semantic ownership and required behavior, not preferred prose.

Move a misplaced rule to its owner and replace copies with a link or a short instruction to
apply that guide. Do not leave two normative versions behind.

## 3. Make workflows executable

Write automation instructions as numbered state machines. Each step must state its input,
action, completion condition and failure transition. Make extraction, reconciliation,
checkpointing and loop termination visually distinct.

Do not bury required behavior in repeated warnings. State it once at the step where the
agent acts, then add a compact invariant or failure rule only when it changes control flow.

## 4. Protect information density

Concise means removing duplication and exposition, not facts or safeguards. Before deleting
guidance, classify it as:

- duplicated elsewhere: remove the copy;
- entity-specific: move it to the entity guide;
- operational: keep it in the relevant workflow step;
- eval-critical or regression-derived: preserve the behavior explicitly;
- merely illustrative: shorten or remove it after the rule is unambiguous.

Resolve contradictions according to the newest accepted behavior and add a regression test
for the chosen owner. Never preserve a contradiction just because both phrasings have tests.

## 5. Align metadata and tests

Check directory summaries and managed-page summaries for stale engagement, importance or
schema claims. They must not contradict the guides.

Prefer tests that assert:

- the authoritative guide contains a rule;
- descendants and automation prompts do not duplicate it;
- required workflow states, tool calls and failure behavior remain present;
- local exceptions stay in the local guide;
- known contradictory phrases are absent.

Avoid pinning full sentences unless exact wording is a runtime contract.

## 6. Validate in layers

Run focused template tests first, then type or build checks affected by structural changes.
Run the distillation and diary evals, or the smallest representative eval available, whenever
guidance could change extraction coverage, entity creation, timelines, links, diary selection
or checkpoint progression.

Review the final diff for rule ownership, broken guide anchors, accidental semantic loss and
word-count movement. Report any validation that could not run; never equate a shorter prompt
with a successful refactor without behavioral evidence.
