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

## What identifies a topic

Under the [[agents#identifiability-is-the-threshold|root threshold]], a subject discussed
in the evidence gets its page as soon as it resolves to a **subject** rather than a passing
noun. That is the whole of the local test, and it does more work here than anywhere else:
most nouns in a conversation are not topics. A field someone works in, a practice the owner
follows, a piece of regulation, a thesis being argued — each is a subject. *Timelines*,
*pricing* and *the market*, used as ordinary words inside a sentence about something else,
are not.

Two cases resolve reliably and should never be left out:

- **A position the owner reasons from** — a thesis, principle, standard or preference they
  apply to more than one decision. Their own words are the signal: *my thesis*, *what I look
  for*, *the way I do this*. So is someone else's: *your position on this*, *the thing you
  keep saying*. Every decision citing a position restates it unless there is a page to point
  at, which is why this earns one the first time it is stated rather than the third.
- **Activity the evidence places nowhere more specific.** Under the root rule for
  [[agents#which-entity-does-it-belong-to|choosing the entity]], a topic is where activity
  lands when nothing below it is identifiable: a meal with no named dish or place belongs to
  `food`, a mood to `mood`.

Inbound pressure — several pages needing somewhere to point — is no longer a gate to pass
before creating a topic. It is the signal that an existing one has become too coarse and
should split.

Creating the page is not the whole change. In the same write, repoint the references that
should now point here and link the topic from the account that raised it, so it is reachable
rather than orphaned.

## Keep it the owner's

Remove every sentence that is the owner's position, practice or connection to the rest of
the base. If a useful page survives that subtraction, it is an encyclopedia entry and does
not belong here.

## Example intro

    # <Topic>                                      ← intro

    What the subject is, and what is true about it.

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
