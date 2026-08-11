# Events conventions

Follow the [[agents|root guide]] for every convention not specific to events. This guide
adds only event selection and shape.

## Suggested shape

    events/<YYYY>/<MM>/<YYYY-MM-DD>_<event-slug>/
    ├── intro        — what it was, where, why the owner went and what happened
    ├── takeaways    — what changed or became useful because of it
    └── (pictures)   — assets embedded from the relevant page

Use the start date. A multi-day event is one occurrence and usually one folder; a recurring
conference gets one folder per occurrence, linked across years, rather than one page mixing
them. `intro` should make the occurrence intelligible to someone who was not there.
Separate `takeaways` only when the owner's changed thinking or new connections are
independently worth revisiting.

## What counts as an event

An event is defined by an occasion with a time and place: a conference, trip, dinner,
hackathon, demo day or wedding. A [[meetings/agents|meeting]] is instead defined by its
conversation and participants. A meaningful conversation inside an event may have its own
meeting page, but the event is not a container for every conversation that occurred there.

An occasion the evidence resolves — what it was, roughly when and where — gets its folder
under the [[agents#identifiability-is-the-threshold|root threshold]], whether or not the
owner attended. A conference someone else went to and reported on is still an identified
occasion. What does not earn one is an occasion that cannot be pinned down: a reference to
"the summit" with nothing saying which, or an invitation with no evidence it happened.

## Example pages

    # <Event> — <D Month YYYY>                     ← intro

    **What:** one line. **Where:** city, venue.
    **Why the owner went:** one line.

    ## What happened
    The parts worth remembering.

    ## People
    - [[people/…|Name]] — why this person mattered to the event.

    # Takeaways                                    ← takeaways

    What changed in the owner's thinking, what they would do differently and what the
    event led to, linked to the canonical pages where those outcomes now live.

Every person and company the evidence resolves here gets its page and its link, on the same
terms as any other named subject. What co-attendance alone does not earn is a timeline event
on those entities: reserve that for an encounter that materially starts or changes a
relationship. Durable outputs live with their own subjects and link back here.
