# Can the agent answer the question?

This is the retrieval-facing evaluation: a question goes in, the agent answers it from the
knowledge base a distillation run built, and the answer is compared to a sealed key.

```sh
bun run eval distill --corpus world-v1 --batches 2   # build the knowledge base
bun run eval qa:ask                                  # ask, one session per question
bun run eval qa:score                                # compare to the sealed answers
```

`qa:ask` records answers; `qa:score` is offline and deterministic, so a run can be rescored
whenever the key changes without asking anything again.

## Iterating on a subset

A short run is scored against what it was served. Every answer carries the `due_batch` by
which the corpus has served the pages that state it, and `qa:ask` and `qa:score` work on
the questions due by the last batch a run recorded:

| Batches processed | Questions due | Of those, earned |
| --- | --- | --- |
| 1 | 12 | 10 |
| 2 | 31 | 27 |
| 3 | 43 | 37 |
| 5 | 70 | 60 |
| 10 | 145 | 120 |

So two distillation runs already give 31 answerable questions. This changes nothing about
the question set — a full ten-batch run is still upstream's 145 — and it is the same
discipline [gold/score.ts](../gold/score.ts) applies with `knowableFrom`, where a
three-day amara run is scored against the 107 entities knowable by then rather than all
158. Without it a two-batch run would spend most of its budget on questions nothing could
answer and then report the blanks as failures.

`--all` asks everything regardless, which is only useful for checking that a question is
genuinely unanswerable rather than merely unasked.

## The question set is derived, not authored

`world-v1/questions.json` holds 145 questions and `world-v1/answers.json` their answers.
Both are derived from each corpus page's `_facts` block by [world-derive.ts](world-derive.ts),
which is a faithful port of `buildRelationalQueries` in gbrain-evals'
`eval/runner/before-after.ts` — the same four templates, the same "only entities with their
own page count as answers" filter, the same 145 questions:

| Template | Questions |
| --- | --- |
| `Who attended <meeting>?` | 50 |
| `Who works at <company>?` | 40 |
| `Who invested in <company>?` | 39 |
| `Who advises <company>?` | 16 |

Matching their derivation is the point. The question file is upstream's `PublicQuery`
shape and the answer file is upstream's `Gold`, so the same questions can be put to gbrain
later and the two systems compared on one set rather than on two that merely sound alike.

Both files are committed so that a change in the corpus or in the derivation is a
reviewable diff rather than a silent shift under a measurement. `qa:derive` fails if the
committed copies are stale; `--write` updates them.

**`amara-life-v1` has no question set yet.** Its raw activity carries no `_facts` to read a
key off, so its questions have to be authored the way [gold/entities.json](../gold/entities.json)
was. The one template that ports for free is `Who attended X?`, because
`meetingExpectation` already parses attendees out of meeting front matter.

## Sealing

The agent is handed the question and nothing else — no entity, no slug, no expected shape.
Three things hold that line, and each is asserted in [qa.test.ts](qa.test.ts):

- `questions.json` carries only upstream's public fields, and no expected name appears
  anywhere in it.
- The prompt is the question text plus instructions, and never a slug.
- `_facts` is stripped by the corpus loader itself, so the serving path cannot reach the
  answer key even in principle. [world-derive.ts](world-derive.ts) is the one module that
  reads it, and nothing in the serving path imports it.

A session that calls `read_source_records` is **voided rather than scored**: that tool
serves the corpus, so answering with it measures the corpus instead of what was built from
it. The check reads the provider's own transcript, so it holds for both providers.

## What the score means

Every answer is a set of names, so scoring is a set comparison with no model involved —
free, instant and exactly reproducible. A judge would buy nothing here and cost
determinism; it earns its place only when an answer is prose that can be right in several
wordings.

A question is **correct** when every expected name appears and no one else is named.
Naming someone who was not at the meeting is a wrong answer, not a partially right one.
Only people count as a wrong attribution — every template asks "who", so a company named
as context is background.

Two numbers are reported, and the second is the headline:

- **accuracy** — over every question asked.
- **earned** — over the questions that do not give away their own answer.

Twenty-five of the 145 do give it away: upstream titles its one-on-ones
`1:1 Wendy Hernandez + Mia Brown` and then asks who attended, so echoing the question
scores full marks with an empty knowledge base. They are flagged on the sealed side and
kept rather than dropped, because dropping them would diverge from upstream's 145 and cost
the comparison this file exists to make possible.

All 261 expected answers are recoverable from prose. `unstated_in_prose` exists to catch
any that are not — an answer the corpus states only in `_facts` could not be known by a
system reading content alone, so it would be reported and never counted — and it is empty
today.

Getting that right depended on matching **slugs** rather than page titles. Prose writes
"a senior engineer at [Beta](companies/beta-1)" and never "Beta - Cybersecurity Startup",
which is the page title, so a title match reported three answers as unknowable that the
corpus states plainly. This matters more than it sounds: it is also why upstream's
`employees` never appear on a company page. The prose generator was handed founders,
investors and advisors but never employees, so "who works at X" is answerable only from
the *person's* side, and matching the wrong string there hides that the corpus states it
at all.

## Reading a failure

Every missing name is labelled with which half of the system lost it:

```
✗ q-0002  Who attended Beta Board Meeting Q2 2025?
    missing Victor Taylor — held in the knowledge base but not found
```

`held in the knowledge base but not found` is a retrieval failure. `never written to the
knowledge base` is a distillation failure. They have different fixes, and a bare accuracy
number cannot tell them apart — which matters here, because `world-v1` exercises
distillation and retrieval end to end rather than retrieval alone.

## What this does not measure

Recall, precision, P@5 and nDCG. `Gold.relevant` carries the page slugs upstream would
score, so a later retrieval comparison needs no new authoring, but nothing scores it yet.

Nor temporal reasoning, contradiction resolution or abstention: `world-v1` has no
questions of that kind, and neither does anything else upstream ships with a populated key.
Those belong to the `amara-life-v1` set when it is authored.
