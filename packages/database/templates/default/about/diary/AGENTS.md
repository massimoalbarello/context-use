# Diary conventions

This subtree inherits the [[about/agents|About conventions]]. The diary is the chronological
connective tissue of the owner's knowledge: it tells how the subjects they moved among,
the decisions they made and the things they experienced formed a day, while the durable
pages carry the full account of each subject.

It is composed after the knowledge it describes. An agent recording activity puts the
particulars on the relevant entities and their timelines, then stops; the
[[automations/diary-composer/instructions|diary composer]] later turns those timeline events
into the day's account. It is the only unattended writer here. The owner may write in the
diary directly, and their words are part of the day rather than material for the composer
to replace.

## A day is a small hypermedia

One folder represents one day at `about/diary/<YYYY>/<MM>/<DD>/`, zero-padded. Its `log` is
the entry point. A day folder is a chronological container rather than a durable entity,
so `log` is a local exception to the root `intro` convention; do not add a redundant
`intro`.

Most days need only `log`. When part of a day is independently worth reading, or distinct
material would make the log harder to follow, give it a descriptive page in the same day
folder. This is not a prescribed set of companion pages: the day may remain one page or
become several connected views according to what actually happened.

The log introduces every companion view in the sentence that says what it contributes.
The views link one another when their material bears on one another, under the root
hypermedia rule; they do not all route back through the log as a hub. The folder holds only
pages and assets belonging to that day. Give the log the title `Log — <weekday>, <day>
<month> <year>` and give any other page a descriptive title that remains clear away from
the folder.

## What the log establishes

Write prose, not a digest of timeline bullets. The log carries the thread between the
day's activities: what led to what, which work resumed, where attention shifted and what
was left open. Every distinct activity the evidence records appears, with inline links to
the most specific occurrences and durable subjects that let a reader continue into the
detail.

That link is usually enough. Figures, terms, participant biographies, full reasoning and
other particulars already explained by an entity page stay there. Repeat one only when the
day's transition, decision or consequence cannot be understood without it. The diary is
the route through the knowledge, not a second copy of it.

Several timeline events may be different entity-side views of the same activity. In the
diary they become one passage carrying all useful links, not one sentence per timeline.
Conversely, proximity in time is not a relationship. When a day contains genuinely
separate subjects, keep them separate with descriptive headings, distinct passages or
companion views. Never invent cause, mood or a unifying theme to make unrelated work read
as one story.

The shape follows the material under the root guide. There are no required sections,
heading order, opening line, location, thread list or mood block. Use headings when they
name real divisions in the day and omit them when the prose already reads clearly. Write
the page summary last, from the finished day.

The composer may include a thought, feeling or first-person position only when the owner
actually recorded it. It does not infer an interior state from activity, and it never
turns somebody else's view into the owner's voice.

## Continuity between days

When an activity genuinely resumes, follows from or changes the meaning of an earlier one,
link the most specific earlier diary page inline where that relationship is told. One hop
to the latest useful account is enough; following its links recovers the older path. A day
with several independent arcs may link a different earlier page from each passage.

Repeated mention is not continuation, even when it is the same entity. Neither is mere
chronological adjacency: the generated calendar already places one day after another. If
today's topics are separate from the previous day's, let them be separate rather than
writing a false transition. Never edit an earlier log merely to add a forward pointer,
because it records what was known then.

A continuity chain that becomes cumbersome is evidence that the underlying subject needs
a better durable page, project, task or thread. The diary still links that subject rather
than absorbing its account.

## Reading and maintenance

Enter through a day's log, follow its views and links, and move backward through the
continuity links relevant to the question. Treat an old mood, plan or open loop as a
historical snapshot until later evidence changes it. An optional monthly overview may
narrate what mattered across a month as a considered review, never as an automatic digest
or substitute for the days.

Reconcile a day when new timeline evidence for it arrives, but preserve every owner-written
passage exactly. The composer may add its prose around an owner-created log; it never
reorders that prose, restructures or archives a page it did not create, or claims uncertain
wording as its own. Do not rewrite a past log merely to polish its prose or neaten its link
graph. Correct what is wrong or misleading under the root reconciliation rule; when the
correction itself changes the story, say so and link the later evidence.

A past log otherwise keeps the links it was written with. When an entity is later split
out of a topic, its timeline events may move but the day continues to point where the
material lived when the day was composed.

## Diary privacy

Assume day folders contain sensitive personal detail. Material intended for publication
belongs on a separate `<DD>/public-summary` page whose title, summary and body are safe to
expose; the owner still reviews and publishes it under the root privacy rule.
