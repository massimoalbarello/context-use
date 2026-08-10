# Can the agent answer the question?

This is the retrieval-facing evaluation: a question goes in, the agent answers it from the
knowledge base a distillation run built, and the answer is compared to a sealed key.

```sh
bun run eval distill --corpus world-v1 --batches 2   # build the knowledge base
bun run eval qa:ask                                  # ask, one session per question
bun run eval qa:score                                # compare to the sealed answers
```

Both corpora have a set: `world-v1/` (145 questions, derived) and `amara-life-v1/` (99,
authored). A run records which corpus it processed, so `qa:ask` and `qa:score` put that
corpus's own questions to it — there is nothing to select.

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

## `world-v1`'s set is derived, not authored

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

## `amara-life-v1`'s set is authored, and that is the harder claim

`amara-life-v1/questions.json` holds 99 questions. Nothing derived them, because there is
nothing to derive them from: the corpus is raw email, Slack, notes and meeting write-ups
with no `_facts` and no key of any kind. They were read out of it, the way
[gold/entities.json](../gold/entities.json) was.

That makes them the more valuable set and the less trustworthy one, so the process is worth
stating. Nine readers each took a slice of the corpus — one per dense day, one for the 39
sparse notes, one for the calendar, one reading the whole thing for questions that only a
join can answer — and proposed candidates with a verbatim quote for every claim, having
first grepped the whole corpus to check nothing elsewhere contradicted it. A second reader
then answered each question again **from the whole corpus, never having seen the proposed
answer**, and marked it `single`, `ambiguous`, `contradicted`, `not-found` or `ill-posed`.
A third read the whole corpus trying to *refute* each candidate: re-checking every quote,
hunting for a second entity the question could mean, and attacking the grading in both
directions. 123 candidates went in; 99 came out.

The 24 that did not are as interesting as the ones that did, because they are all the
corpus's own mess rather than the readers':

- **Seven** asked something the corpus answers two ways. Jordan Park quotes NovaMind's seed
  at `$4M` on 15 April, `$6M` on 17 April and `$4M` again on 19 April, so "how much is he
  raising" has no answer — it survives only as `q-0098`, which asks what the conflicting
  figures *are*. A note gives Halfway `14.2%` of a bare "Meridian" where a meeting gives
  `14%` of Meridian Health, and `14%` is a substring of `14.2%`, so the wrong figure would
  have passed the right question.
- **Fifteen** were duplicates of a better-scoped sibling.
- **Two** presupposed something the corpus does not state — that two ops-sync messages a day
  apart describe the same meeting, and that five scattered NovaMind efficiency claims are a
  disagreement rather than different metrics.

### What is checked, and what is judged

Everything the corpus can settle is settled by [amara-evidence.ts](amara-evidence.ts) on
every test run, so a key that drifts fails the build:

- every quote is an exact substring of the record it names;
- `due_batch` is the day the last of those records arrives, so a short run is scored only
  against what it was served;
- the reference answer satisfies its own `expected_names`;
- no `expected_names` element already appears in the question — the self-answering problem
  upstream has to live with, which an authored set can simply not have.

What is left to judgement is that the quotes entail the answer and that no other record
contradicts it. That is what the three independent reads bought, and it is the part a
reviewer should spend their time on: every answer carries its quotes and the record they
came from, so any one of the 99 can be checked in seconds.

```sh
bun run eval qa:verify    # re-check the authored key against the corpus, and report its shape
```

### What it asks about

| | |
| --- | --- |
| Settled by one record | 87 |
| Needing a join across records | 12 |
| Contradiction questions (`adversarial`) | 5 |
| Distinct records quoted | 79 |
| Days on which a question first becomes answerable | 20 |

The five `adversarial` questions ask about the corpus's own inconsistencies rather than
around them — where Marcus Reid works, which firm Sarah Chen is at, what Jordan Park says
NovaMind builds. A knowledge base that has flattened those into one confident answer gets
them wrong, which is the point: this corpus disagrees with itself, and a system that hides
that is worse than one that reports it.

The questions reach every source type the corpus serves, and are spread over 20 of its 47
days rather than mined out of the richest meeting.

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
Only people count as a wrong attribution, and only when the answer is itself a person: for
`Who attended X?` a second name is a wrong claim, but for `What was the Q1 ARR?` whoever
reported the figure is context, and failing that would mark a correct answer wrong.

`amara-life-v1`'s answers are often numbers rather than names, and `$18.2M` and
`$18.2 million` are the same fact. So an `expected_names` entry may be a list of
interchangeable renderings, any one of which satisfies it. The alternatives are
alternatives and never additional requirements — widening one cannot let a wrong answer
pass, only stop a right one from failing. `world-v1`'s answers are all person names and use
the plain string form, unchanged.

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

Nor abstention. Neither set asks a question the corpus cannot answer, because proving a
negative over 418 records is a claim that has to be authored as carefully as a positive one
and nothing here does that yet. Contradiction is covered, by `amara-life-v1`'s five
`adversarial` questions; `world-v1` has none, its pages being already reconciled.
