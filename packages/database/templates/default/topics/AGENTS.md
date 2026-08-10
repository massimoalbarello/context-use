# Topics conventions

Follow the [[agents|root guide]] for every convention not specific to topics. This guide
adds only topic selection and shape.

`topics/` is for a subject the owner keeps returning to — an idea, a field, a discipline, a
practice or a piece of regulation — so the account of it lives in one retrievable place
instead of being restated wherever it was first mentioned. It is not a tag index, a
glossary or a list of interests.

Two boundaries define it. A topic has **no start and no finish**, so a pursuit that can
close is a [[about/tasks/agents|task]] however long it runs. And its **subject is in the
world**, so food, running and travel are topics while the owner's medical record, finances
and schooling are their own particulars under [[about/agents|about]]. Personal engagement
never moves a subject out of `topics/`; it is the reason the topic is here.

## Suggested shape

    topics/<topic-slug>/
    ├── intro     — the canonical account of the subject and the owner's position on it
    └── timeline  — material changes in the subject or in the owner's relation to it

`intro` is usually enough. Keep `topics/` flat: a topic folder holds pages, never another
topic, and relationships between topics are wikilinks between their `intro` pages, because
a hierarchy that looks obvious now is expensive to unpick later. Prefer the broader name
when it is honest — closely related subjects always read together are one topic with
linkable headings, not three thin folders.

## When a topic is useful

The usual test is inbound pressure, not interest: the base needs somewhere to point. The
last condition is the exception, and comes from the owner rather than the base. Create a
topic when any of these is already true:

- Three or more existing pages refer to the subject and have nowhere canonical to link.
- It recurs in the diary across two or more months.
- The owner holds a stated position on the subject and reasons from it — a thesis, a
  principle, a standard, a preference they apply to more than one decision. The decisions
  it governs need somewhere to point from the first time it is written down rather than
  the third, and the owner's own words are the signal: *my thesis*, *what I look for*,
  *the way I do this*.
- Other people describe the owner as holding it — *your position on this*, *the thing you
  keep saying*. That usually arrives long before three pages need to point at it.
- The owner recounts something the evidence places nowhere more specific. Under the root
  rule for [[agents#which-entity-does-it-belong-to|choosing the entity]], a topic is where
  activity lands when nothing below it is identifiable: a meal with no named dish or place
  belongs to `food`, a mood to `mood`. This holds only for what the owner tells you, never
  for harvested records, which stay in the account that mentioned them.

Creating the page is not the whole change. In the same write, repoint at least one existing
reference at the new topic and thin the passage it came from. A topic with no inbound links
is not yet a topic — unless it is a holding area, which the owner's own account is the
inbound link for.

## Keep it the owner's

Remove every sentence that is the owner's position, practice or connection to the rest of
the base. If a useful page survives that subtraction, it is an encyclopedia entry and does
not belong here.

## Example intro

    # <Topic>                                      ← intro

    The smallest account of the subject that makes the rest of the page useful.

    ## Why it matters to me

    The owner's position, in first person and grounded in what they expressed, linking
    the projects, works and occurrences that formed it rather than retelling them.

`library/` holds the works; `topics/` holds what the works are about, so link the saved
work instead of summarizing it again. A company, person or place a topic runs through keeps
its own page and its own judgement.

Topic timeline events include the subject's own material developments, changes in what the
owner does about it, and for a holding area each occasion they recount under it. A
holding-area timeline is expected to grow long, and length is the signal to split: when a
dish, a place or a practice inside it has enough events to be worth retrieving on its own,
give it its own entity and move those events there.

A topic left unreferenced and unchanged for roughly six months should be folded back into
whatever still needs it, or archived — but a holding area the owner keeps adding to is
referenced by definition, and its thin `intro` is waiting to be distilled from its
timeline, not a candidate for archiving.
