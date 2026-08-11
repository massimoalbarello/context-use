# Can the agent answer the question?

A question goes in, the agent answers it from the knowledge base, and the answer is
compared to a sealed key.

```sh
bun run eval qa:ask     # ask, one session per question
bun run eval qa:score   # compare to the sealed answers
```

Both corpora use those two commands and differ only in how the knowledge base under test
comes to exist:

| | `world-v1` | `amara-life-v1` |
| --- | --- | --- |
| Knowledge base | `qa:seed` puts its 240 pages in as they are | `distill` builds it from raw activity |
| Questions | 145, derived from `_facts` | 99, authored and quote-checked |
| A score measures | retrieval | distillation **and** retrieval |

```sh
bun run eval qa:seed --batches 2                           # world-v1
bun run eval distill --corpus amara-life-v1 --batches 2    # amara-life-v1
```

A run records its corpus and mode in `report.json`, so both commands pick the right question
set and say what the number covers. `qa:score` is offline, so a run can be rescored whenever
the key changes without asking anything again.

Read together the two localise a failure: strong `world-v1` next to weak `amara-life-v1`
puts the gap in distillation rather than in search.

## Why world-v1 is seeded

It has no owner — twenty partners at twenty different firms, no protagonist. The activity
distiller selects on owner engagement, so it correctly imports almost nothing, and running
it would measure the mismatch rather than the system. Upstream does not distil it either:
`before-after.ts` calls `putPage` for all 240 pages and then queries. Pages are written
through `PageRepository`, so a seeded page is indistinguishable from a written one, and they
keep upstream's slugs because `Gold.relevant` labels those slugs.

## Only the questions a run has served the evidence for

Every answer carries the `due_batch` by which the corpus has served what states it, and both
commands work on the questions due by the batches a run actually recorded. Two distillation
batches give 25 amara questions and 31 world ones; the full runs give 85 and 145. `--all`
overrides it, which is only useful for checking that a question is genuinely unanswerable
rather than merely unasked.

Membership of the served batches, not `<= last`: `--window dense` never serves amara's
thirty-nine sparse note days, so a question due in February is not due for it.

## The two question sets

**`world-v1`** is derived from each page's `_facts` block by [world-derive.ts](world-derive.ts),
a port of upstream's `buildRelationalQueries` — the same four templates and the same 145
questions, in upstream's `PublicQuery` and `Gold` shapes so the set can be put to gbrain
later. `qa:derive` fails if the committed copies are stale; `--write` updates them.

**`amara-life-v1`** is authored, because raw email and Slack carry no key to read. Nine
readers each took a slice and proposed candidates with a verbatim quote per claim; a second
answered each question again from the whole corpus without seeing the proposed answer; a
third tried to refute each one. 123 went in, 99 came out — most of the 24 dropped were the
corpus contradicting itself, such as a founder quoting his seed round at $4M, $6M and $4M
again inside five days.

Every claim the corpus can settle is re-checked by [amara-evidence.ts](amara-evidence.ts) on
each test run, so a key that drifts fails the build: quotes are exact substrings of the
records they name, `due_batch` is the last evidence day, each reference answer satisfies its
own key, and no required element already appears in the question. What is left to judgement
— that the quotes entail the answer — is why every answer carries its quotes, so any one of
the 99 can be checked in seconds.

```sh
bun run eval qa:verify    # re-check the authored key against the corpus
```

## Sealing

The agent gets the question and nothing else. `questions.json` carries only upstream's
public fields, the prompt is the question text plus instructions and never a slug, and
`_facts` is stripped by the corpus loader itself. A session that calls `read_source_records`
is **voided rather than scored**: that tool serves the corpus, so answering with it measures
the corpus instead of what was built from it.

## What the score means

Correctness is a set comparison with no model involved. A question is **correct** when every
required element appears and no one else is named; naming a non-attendee is wrong, not
partially right. Wrong attribution applies only when the answer is itself a person, so for
`What was the Q1 ARR?` whoever reported the figure is context.

An `expected_names` entry may be a list of interchangeable renderings, because `$18.2M` and
`$18.2 million` are the same fact. Alternatives never add requirements — widening one can
only stop a right answer failing.

Two numbers for `world-v1`, and the second is the headline: **accuracy** over everything
asked, and **earned** over the questions that do not give away their own answer. Twenty-five
do, because upstream titles its one-on-ones `1:1 Wendy Hernandez + Mia Brown` and then asks
who attended. They are kept rather than dropped, so the set stays upstream's 145.

Its key is also lenient in a way worth knowing: upstream keeps only entities that have their
own page, which drops 37% of the `_facts` relationships. A score there reads as *correct on
the entities the corpus profiles*, not *correct on who attended*.

## Reading a failure

```
✗ q-0002  Who attended Beta Board Meeting Q2 2025?
    missing Victor Taylor — held in the knowledge base but not found
```

`held … but not found` is a retrieval failure and `never written` a distillation one. Held
means the name sits on a page that is also about what the question asks — the weaker test,
that the string appears anywhere, counted an unrelated page's "40%" as the answer.

## What the runs found

The first full amara run scored 27/85, and reading every failure against the corpus found
one cause behind most of them: the base recorded that a conversation happened rather than
what it established — *"supplied cap-table context"* where the evidence said *"came in at 8%
equity for that initial $1.2M check"*. Three changes to the guides followed, each ablated
over the full eight days with only the guides differing:

| | score | email | Slack |
| --- | --- | --- | --- |
| before | 27/85 | 6/34 | 2/20 |
| [particulars over narration](../../packages/database/templates/default/AGENTS.md) | 38/85 | 12/34 | 4/20 |
| [+ batches read in small passes](../../packages/database/templates/default/_pages/activity-distiller/instructions.md) | 47/85 | 14/34 | 10/20 |
| **+ engagement scoped to which subjects exist** | **55/85** | **21/34** | 8/20 |

Expected names never written to the base fell from 73 to 44, against five written and not
retrieved.

Still wrong: 2/5 on the contradiction questions — the base keeps the particulars now and
still flattens the disagreement between them — 5/9 on joins, and 0/2 on calendar. Slack fell
back with the third change while email gained.

Each row is a single run and volume is noisy: two runs of the identical config produced 71
and 113 pages. These deltas are far outside that band, but they are not repeated
measurements. Ten grader defects were found and fixed along the way, every one a false
negative where the system was right and the key was pinned to one rendering, and every run
is scored on the final key.

## What this does not measure

Recall, precision and nDCG — `Gold.relevant` carries the slugs so a retrieval comparison
needs no new authoring, but nothing scores it yet. Nor abstention: neither set asks something
the corpus cannot answer, because proving a negative over 418 records has to be authored as
carefully as a positive one.
