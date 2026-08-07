# The gold standard

What would a *perfect* knowledge base hold, given this corpus? Everything about scoring
depends on that answer, so it is built here as its own artifact, in stages, each small
enough to check by hand.

The point of the gold standard is to measure how far the default guidelines are from
ideal. It therefore has to be independent of those guidelines. If it encodes the current
template's directories or page schema, then improving them registers as regression, and
the measurement argues for the thing it was built to question.

Stage 0 is implemented. The rest is planned below.

## What "ideal" can mean for this corpus

Not a coherent world state. The corpus does not contain one, and
[Stage 0](#stage-0--corpus-profile-done) measures the ways it does not:

- Twenty-four of the twenty-five declared email threads pair two messages that share no
  entity. `thr-0000` is Ravi introducing *Terraform Dynamics* followed by Amara thanking
  Bill about *Terraform Industries* — a shared `thread_id`, a resolving `in_reply_to`,
  and no shared subject.
- All five meetings that name a `linked_calendar` name the wrong event. `mtg-0002` is
  Amara and Ravi Gupta on 14 April; it links an event that is Amara and Diego Alvarez on
  the 15th.
- Twelve note topics recur across the 47 days, and upstream regenerates them rather than
  continuing them. The January and April `novamind-followup` notes disagree about what
  NovaMind builds and who the contact is (Derek Lin, then Chen Wei).
- Six people other than the owner are written under the `user/` namespace, so the
  namespace cannot identify the owner outside meeting front matter.

An ideal knowledge base over a source like this is not one that resolves those conflicts
into a single truth. It is one that **carries every claim the corpus makes, attributed to
where it came from, with the right entity, findable, and not asserted as current once
something later contradicts it.** That is the standard being built.

## Design commitments

**Structure-agnostic.** No gold item names a path, a directory, or a page schema. Items
are claims about the world plus the evidence for them. Scoring asks whether the knowledge
base *carries* a claim, resolved by search and a judge, never by looking up a path. A
reorganised ontology should score the same.

**The slug is the coreference answer key.** Upstream marks every reference with its own
canonical slug — `[Priya](people/priya-sharma)`. Two mentions with one slug are one
entity; two slugs are two entities however alike the labels. This is ground truth we did
not author, and the agent sees it in the record text, so it is a fair standard. It is
also the hardest part of the corpus: three people are called just "Priya" and four just
"Derek", while one company is spelled `NovaMind`, `NovaMinds`, `Novamind` and once with a
zero-width space inside it. A knowledge base that merges on the surface label gets these
wrong.

**Every claim is quote-grounded.** A gold claim carries a verbatim span from the record
it came from, and a check refuses any claim whose span is not present in that record.
Soundness is machine-enforced across the whole set; completeness is what human review is
for. A gold standard with a wrong claim in it is worse than one that is merely short.

**Defects are excluded by name, not by judgement.** `linked_calendar`, email
`thread_id` coherence, and the `user/` namespace outside meeting front matter are
recorded in the profile as unreliable and generate no gold claims. Meeting `attendees`
front matter is the one clean cross-source signal and is used heavily.

**Absence is scored where it can be, and not where it cannot.** 130 of 176 entities
appear in exactly one record. The guides deliberately say not to page passing mentions,
so requiring a page per entity would penalise correct behaviour. Salience is tiered, and
only the tiers with mechanical justification carry a must/must-not.

**Properties over paths, spread over point estimates.** Two runs over the same three days
produced 21 and 10 pages on day one, with different entities and different meeting slugs.
Every reported number is a spread over repeated runs.

## Stages

Each stage is one reviewable artifact with one way to check it.

### Stage 0 — corpus profile (done)

`profile.ts` derives `profile.json`: every referenced entity with its slugs, namespaces,
surface labels, records, source types and first day; the identity confusion sets in both
directions; and the mechanical defects above.

```sh
bun run eval gold:profile           # print the summary, fail if the committed copy is stale
bun run eval gold:profile --write   # regenerate it
```

It is committed so that a change in the corpus or the derivation is a reviewable diff
rather than a silent shift under a measurement. Nothing in it decides what a knowledge
base should contain — it only measures what the corpus says.

**Check:** the tests regenerate it from the corpus bytes and pin the specific facts the
design rests on. The confusion sets are 34 rows and readable in full.

### Stage 1 — the rubric

`RUBRIC.md`, written and frozen *before* any claim is generated: what a perfect knowledge
base holds, how a claim resolves against a knowledge base, the grade scale, what is
deliberately not measured, and the salience rules. Changing it after scores exist
invalidates them, so it carries a version.

**Check:** human review. It is prose, and it is the one artifact that is meant to be
argued with.

### Stage 2 — identity key

`identity.json`: the canonical entity set keyed by upstream slug, the confusion groups
promoted from Stage 0 into explicit *must-not-merge* and *must-merge* pairs, and, per
entity, the day it first becomes knowable.

**Check:** mechanical from Stage 0. 176 entities, ~34 confusion rows, verifiable by eye.

### Stage 3 — salience tiers

Rules from the rubric applied by code, no per-entity hand-picking:

- **must exist** — the 16 people Amara demonstrably interacted with (meeting front-matter
  attendees ∪ calendar attendees ∪ email correspondents ∪ Slack co-posters), plus
  organisations carrying claims across more than one source type.
- **should exist** — entities in two or more records.
- **optional** — single-record mentions. 107 of the dense window's 146. Scored neither way.
- **must not exist** — the merge errors: any page conflating two slugs from a confusion
  group, and the two references whose label names something other than their slug
  (`[NovaMind](people/jordan-park)`, `[Threshold Ventures](people/mina-kapoor)`).

The must-not tier is what makes precision measurable without enumerating every possible
hallucination.

**Check:** review the rules, then spot-check the assignment for a sample.

### Stage 4 — structural claims

Fully mechanical, no model in the loop: meeting attendance and date from front matter,
the verbatim bullets under each meeting's `## Decisions Made` and `## Action Items`,
calendar attendance, email correspondence, note topics. Roughly 200 claims, each with an
exact span.

**Check:** small enough to read in full, and every claim is a string match against the
corpus.

### Stage 5 — narrative claims

Where the real signal is, and the only stage with a model in it. Per record, an extractor
produces atomic claims constrained to that record's text, each with a verbatim span.
Several independent extractions per record; a claim survives on agreement. Then code
drops any claim whose span is not present verbatim in its record, which removes most
fabrication without a judgement call.

The extractor is prompted from the rubric and is given no ontology, so the gold standard
cannot inherit the blind spots of the system it measures.

**Check:** the span invariant is enforced on all of them; a stratified sample is audited
by hand; the audit's error rate is reported with the gold standard and bounds every score
computed from it.

### Stage 6 — conflict and currency

Claims sharing a subject and predicate with different objects across days. The corpus
contradicts itself, so the standard does not pick a winner: it requires that a knowledge
base not assert both as current, and that the later one be reachable. This is where
reconciliation is actually measured.

**Check:** the conflict set is small; review in full.

### Stage 7 — the scorer

Given a knowledge base snapshot and a day cutoff: resolve each claim by searching the
knowledge base, grade with a blinded judge from a different model family into
correct / incomplete / wrong / absent, and report per tier, per source area and per day —
never one aggregate. Entity resolution is reported separately as merge and split errors
against the identity key, because it is the failure with the largest downstream cost.

**Check:** hand-grade a subsample against the judge and report agreement.

### Stage 8 — variance and an upper bound

Repeat runs over the same days and report the spread. Alongside it, an *oracle* knowledge
base — one strong model, the whole corpus at once, no day boundary and no guidelines —
as an upper reference. The oracle is not the standard; it is a sample from a distribution
like any other run. It answers a different question: how much of the gap is the guidelines
and how much is the task being hard incrementally.

## Scope

The gold standard is built over the **dense window** (13–20 April 2026) first: 187
records carrying 379 of the 418 items, and all the meetings, calendar events, email and
Slack. The other 39 days are one regenerated note each, and those notes contradict each
other, so they measure a knowledge base's handling of a self-inconsistent source rather
than its handling of a working week. They are a later, separate question.

## What this does not measure

Writing quality, page layout, and the wording of a summary. Whether a given fact *should*
have been considered important enough to keep — beyond the salience tiers, which are the
only part of that judgement the corpus supports mechanically. And anything the corpus
does not contain: the six documents under `doc/` are absent from the upstream manifest,
are never served, and generate no claims.
