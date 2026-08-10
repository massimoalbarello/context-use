# Can the agent answer the question?

A question goes in, the agent answers it from the knowledge base, and the answer is
compared to a sealed key. Both corpora are asked and scored by the same two commands:

```sh
bun run eval qa:ask     # ask, one session per question
bun run eval qa:score   # compare to the sealed answers
```

They differ only in **how the knowledge base under test comes to exist**, and that is the
whole design:

| | `world-v1` | `amara-life-v1` |
| --- | --- | --- |
| Knowledge base | `qa:seed` puts its 240 pages in as they are | `distill` builds it from raw activity |
| Questions | 145, derived from `_facts` | 99, authored and quote-checked |
| A score measures | retrieval | distillation **and** retrieval |

```sh
bun run eval qa:seed --batches 2                           # world-v1
bun run eval distill --corpus amara-life-v1 --batches 2    # amara-life-v1
```

Everything downstream of that is shared: one question file format, one sealed answer
format, one scorer, one pair of commands. A run records its corpus and its mode in
`report.json`, so `qa:ask` and `qa:score` select the right question set and state what the
number covers — there is nothing to pass.

`qa:ask` records answers; `qa:score` is offline and deterministic, so a run can be rescored
whenever the key changes without asking anything again.

## Why the split is real, and not two benchmarks in a trenchcoat

`world-v1` has no owner, so the activity distiller correctly declines it (below), and its
pages are already someone's finished knowledge. Seeding them isolates retrieval — and it is
what upstream does too, so a later comparison is closer rather than further.

`amara-life-v1` is the opposite: a real owner, raw email and Slack and notes, nothing
pre-reconciled. Its knowledge base has to be *built* before it can be asked, so a score over
it carries every extraction and merge decision the agent made. That is the harder and more
representative measurement, and it is why the amara questions are worth authoring by hand.

Read together, the two localise a failure that one number cannot: if `world-v1` retrieval is
strong and `amara-life-v1` is weak, the gap is in distillation, not in search.

## Why world-v1 is seeded, not distilled

`world-v1` has no owner. Its 240 pages are third-person profiles of a VC world with no "me"
at the centre: twenty partners at twenty *different* firms, no person in more than four of
its fifty meetings, seventy-five distinct attendees. There is no protagonist to find,
individual or institutional.

The activity distiller selects on owner engagement — "maintain this knowledge base from the
owner's connected activity… this is curation, not ingestion" — so on this corpus it
correctly imports almost nothing. Running it produces a number that measures the mismatch
rather than the system. Inventing an owner would assert a relationship the corpus does not
contain, which is the same thing the [eval README](../README.md) refuses to do with
upstream's fabricated email threading.

Upstream does not distil it either. `before-after.ts` calls `putPage` for all 240 pages and
then queries: the corpus *is* the knowledge base in their harness, and seeding is the step
they perform too — so this makes a later comparison closer rather than further.

Pages are written through `PageRepository`, the same path an MCP write takes, so the search
vector, link normalisation and version row are production behaviour and a seeded page is
indistinguishable from a written one. They keep upstream's own slug — `people/adam-lee-19` —
because `Gold.relevant` labels those slugs and renaming them would throw away the one thing
that makes a retrieval comparison possible.

**So this measures retrieval, and nothing else.** It says nothing about the distiller or
about our own taxonomy; those belong to `amara-life-v1`, which has a real owner and real
activity. `distill --corpus world-v1` still works, because demonstrating that the distiller
declines a corpus with no owner is itself worth being able to show.

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
number cannot tell them apart.

Which of the two a run can even produce depends on how its base was built. A seeded
`world-v1` base holds every page by construction, so every miss there is retrieval. A
distilled `amara-life-v1` base can lose a fact either way, and this line is how you tell —
it is the reason the label exists.

## What the first full run found

Both legs, run locally on 10 August 2026 with Codex against the same stack.

| | `world-v1`, seeded | `amara-life-v1`, distilled |
| --- | --- | --- |
| Knowledge base | 68 pages, 2 batches | **180 pages, all 8 dense batches** |
| Asked | 6 of the 31 due | **85 of the 85 due** |
| Correct | 6/6 | **26/85 — 31%** |

Retrieval over a seeded base was clean. Building the base first costs most of the score, and
the interesting part is where.

**By the record the answer lives in:**

| Source | Correct |
| --- | --- |
| Meeting write-ups | 17/28 |
| Email | 6/34 |
| Slack | 2/20 |
| Calendar | 0/2 |

The distiller reads meeting write-ups well and loses most of what is only ever said in an
email or a Slack message. That is one finding, not fifty-nine.

**By how much joining the answer needs:** 25/76 for a single record, 1/9 for anything
needing two or three. **By tier:** 0/5 on the `adversarial` questions — asked whether its
records disagree about where Marcus Reid works or who Nadia Freeman works for, the base
answers with one confident affiliation. It has flattened the contradiction rather than kept
it, which is the failure those five exist to detect.

**Forty-one of the fifty-nine misses were `NOT FOUND`.** The agent declined rather than
guessed, so only eighteen answers were confidently wrong. `gold:check` on the same run
agrees about the cause: 59 of 158 entities filed, 8/8 meetings, and 53 expected names that
never reached the knowledge base against 34 that are held in it but were not retrieved.

That split is the whole point of running the two corpora together. A 31% here next to 6/6
there is not a retrieval problem.

### The run also found two bugs in this harness

Both were false negatives — the system was right and the grader said otherwise — and both
are fixed with a regression test:

- A person the **question itself names** counted as a wrong attribution. "Who introduced
  Sarah Chen to the Vela founders?" answered "Marcus Reid introduced Sarah Chen to them"
  scored `partial` for repeating the question's own subject.
- `8 months` did not match "roughly **eight** months", and `180-220M` did not match
  "$180–220 **million**".

Rescoring the recorded answers with the fix took no new agent calls and moved 24/85 to
26/85 — which is the argument for offline scoring in one line.

Every remaining failure was read against the corpus by hand. They are the system's: the
base says Terraform Energy has traction in grid optimization where the corpus says
industrial heat pumps, names Sequoia where the corpus says Crossbeam looked at GridMatrix,
and reports board-seat language where the corpus says Amara flagged liquidation preferences.

## The key is lenient, and knowing why matters

Upstream's derivation keeps only entities that have their own page — `filterExisting`,
because a page that does not exist cannot be retrieved. That is right for their scoring and
loose for ours: **37% of the relationship entries in `_facts` are dropped that way** (152 of
413). The Acme board meeting lists three attendees and the prose says plainly that "Ian
Anderson attended in person"; he has no profile page, so the sealed answer names two.

Nothing breaks, because the scorer's vocabulary is built from pages too, so a page-less
attendee is invisible — naming one costs nothing and omitting one costs nothing. But it
means a score reads as *correct on the entities the corpus profiles*, not *correct on who
attended*. Widening the key to unfiltered `_facts` would diverge from upstream's 145 and
ask for people the corpus never profiles, so it stays as it is.

## What this does not measure

Recall, precision, P@5 and nDCG. `Gold.relevant` carries the page slugs upstream would
score, so a later retrieval comparison needs no new authoring, but nothing scores it yet.

Nor abstention. Neither set asks a question the corpus cannot answer, because proving a
negative over 418 records is a claim that has to be authored as carefully as a positive one
and nothing here does that yet. Contradiction is covered, by `amara-life-v1`'s five
`adversarial` questions; `world-v1` has none, its pages being already reconciled.
