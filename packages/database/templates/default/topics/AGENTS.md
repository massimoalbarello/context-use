# Topics conventions

Follow the [[agents|root guide]] for every convention not specific to topics. This guide
adds only topic selection and shape.

`topics/` is for a subject the owner keeps returning to — an idea, a field, a discipline,
a practice or a piece of regulation — that several other pages already need to point at.
The topic page is the canonical home for that recurring subject, so the account of it
lives in one retrievable place instead of being restated inside whichever chapter,
project or diary entry happened to mention it first.

It is not a tag index, a glossary or a list of interests. A topic exists because the
knowledge base already refers to the subject, not because the subject is interesting.

## Suggested shape

A topic has durable identity, so it is a folder entered through `intro`:

    topics/<topic-slug>/
    ├── intro     — the canonical account of the subject and the owner's position on it
    └── timeline  — material changes in the subject or in the owner's relation to it

`intro` is usually enough. Keep `topics/` flat: a topic folder holds pages, never another
topic. Relationships between topics — lineage, dependency, opposition — are wikilinks
between their `intro` pages, because a hierarchy that looks obvious now is expensive to
unpick later.

Name the topic as the owner would say it, and prefer the broader name when it is honest.
Closely related subjects that will always be read together are one topic with linkable
headings, not three thin folders.

## When a topic is useful

The test is inbound pressure, not interest. Create a topic when any of these is already
true:

- Three or more existing pages refer to the subject and have nowhere canonical to link.
- It recurs in the diary across two or more months, so the owner keeps returning to it.
- The owner holds a stated position on the subject and reasons from it — a thesis, a
  principle, a standard, a preference they apply to more than one decision. Such a subject
  is already canonical to the owner, and the decisions it governs need somewhere to point
  from the first time it is written down rather than the third. A position belongs here
  however personal it is, because a thesis, principle or standard is always *about*
  something and belongs with the subject it judges; `about/` holds the owner's own
  circumstances, not the views they apply to the world.
- Other people describe the owner as holding it — *your position on this*, *what you care
  about*, *the thing you keep saying*. Being told what one is known for is inbound pressure
  of the strongest kind, and it usually arrives long before the base has three pages that
  need to point at it.
- The owner recounts something the evidence places nowhere more specific. Under the root
  rule for [[agents#which-entity-does-it-belong-to|choosing the entity]], a topic is where
  activity lands when nothing below it is identifiable: a meal with no named dish or place
  belongs to `food`, a mood to `mood`. This condition holds only for what the owner
  actually tells you, never for harvested records, which climb to nothing and stay in the
  account that mentioned them.

A position the owner keeps applying is a topic even when it is inconvenient to name. The
owner's own words are the clearest signal that one already exists: *my thesis*, *our
principle*, *what I look for*, *the way I do this* all name a subject they are reasoning
from and have nowhere to point at. Give it the plainest name that could be said aloud, and
let the pages that apply it link there instead of restating the reasoning each time.

Creating the page is not the whole change. In the same coherent write, repoint at least
one existing reference at the new topic and thin the passage it came from to what that
page still needs to say for itself. A subject mentioned once belongs in the account that
mentioned it, and a topic page with no inbound links is not yet a topic.

## Keep it the owner's

Remove every sentence that is the owner's position, practice or connection to the rest of
the base. If a useful page survives that subtraction, it is an encyclopedia entry and does
not belong here. Keep enough of the subject's own origin, history and current state to
make the owner's relationship to it intelligible, and no more.

## Example intro

    # <Topic>                                      ← intro

    The smallest account of the subject that makes the rest of the page useful.

    ## Why it matters to me

    The owner's position, in first person and grounded in what they expressed, linking
    the projects, works and occurrences that formed it rather than retelling them.

One topic links another in the sentence that explains the relationship — that one is the
vision this one is the concrete programme for, that one displaced this one — never in a
list at the end. `library/` holds the works; `topics/` holds what the works are about, so
link the saved work instead of summarizing it a second time. A company, person or place a
topic runs through keeps its own page and its own judgement; the topic links it.

The owner's stake in a topic stays on the topic page under the root placement rule, so a
discipline the owner practises records that practice here. What happened on a given day
stays in the diary, and a body of work built around a topic stays a project; the topic
explains the subject both of them keep referring to.

Topic-specific timeline entries include the subject's own material developments, the
changes in what the owner does about it — taking it up, turning away from it, coming back
to it — and, for a topic serving as a holding area, each occasion the owner recounts under
it. A holding-area timeline is expected to grow long, and length is the signal to split:
when a dish, a place or a practice inside it has enough entries to be worth retrieving on
its own, give it its own entity under the guide that owns it and move those entries there,
leaving earlier diary logs pointing where the material lived at the time.

Reconcile rather than accumulate. A topic left unreferenced and unchanged for roughly six
months should be folded back into whatever still needs it, or archived — but a holding area
the owner keeps adding to is referenced by definition, and its thin `intro` is a page still
waiting to be distilled from its timeline, not a candidate for archiving.
