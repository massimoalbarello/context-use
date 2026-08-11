# Tasks conventions

This subtree inherits the [[about/agents|About conventions]]. A task here is a finite
outcome, experiment or consequential decision frame that can resolve or close and whose
reasoning is useful beyond a simple to-do.

## Suggested shape

    about/tasks/<slug>/
    ├── intro       — what the pursuit is, why it matters and how the owner frames it
    └── timeline    — material changes including its resolution

`intro` is the entry point, with `timeline` added once the task has state changes to
record. Name other pages for what they contain rather than imposing a uniform template.

## Task account

Keep the durable frame, relevant constraints, alternatives and the owner's reasoning.
Activity alone does not make a task: the evidence should identify a real finite pursuit or
decision whose frame will remain useful beyond the day.

Finite is the word that separates a task from its neighbours. Something the owner will
still be doing indefinitely, with no state it could resolve into, is a
[[topics/agents|topic]] however concrete it sounds; something that decomposes into several
finite pursuits is a [[about/projects/agents|project]]. Decide from what the evidence says
the subject is, not from a name that reads like an activity.

An open question the owner is visibly working through — whether to commit, hire, buy, ship,
accept or walk away — is a task as soon as the evidence shows them weighing it, not once it
resolves. Framing it early gives the later evidence somewhere to attach; without the page,
each new consideration lands in a different day's log and the question itself is never
anywhere. Name the task for the question, and let the entities it concerns keep their own
pages and link here.

A task has to say more than its subject's own page already says. If it adds nothing the
organization, person or project page would not carry anyway, there is no frame yet, only a
leaning — and a leaning is a dated fact about that subject, recorded there. The task earns
its page once there is a question with more than one defensible answer and something worth
recording about how the owner is choosing: the constraint, what has been ruled out and why,
what would change the answer, who has to agree.

This decides where a decision is written down, never whether the subjects behind it exist.
The organization still gets its page, the people still get theirs, and folding a decision
back into its subject must never mean writing less about the subject.

## A unit of work, not a unit of evidence

A task is also where several pieces of evidence about one pursuit come together. Two pull
requests continuing the same scope of work are one task that discusses both and links the
[[about/projects/agents|project]] they serve — not two pages, and not one page per
repository artefact. The same holds for a ticket reopened under a new number, a design
document and the change that implemented it, or a review thread and the work it reviews.

This is the counterweight to the root rule that
[[agents#a-subject-arrives-one-of-two-ways|evidence is itself a subject]]. That rule gives
an occurrence its page because a conversation or an exchange is a thing that happened once.
A unit of work is not: it continues across artefacts, and the pursuit is the subject while
each artefact is evidence of it. Ask what the owner would look for afterwards — they
remember the piece of work, not which pull request carried it.

Link every artefact from the task in the sentence saying what it contributed, and keep the
particulars each established. Merging them into one page is not a reason to write less.

Task timeline events include the pursuit being framed, a consequential change in scope or
direction, a decision, handoff, abandonment or resolution. Routine progress and transient
status earn none.

## Resolution

Resolution always earns a dated timeline event, at the date the task was actually resolved.
Say whether it was completed, decided, abandoned or superseded, and link the resulting
outcome or durable page when one exists.

Keep the task as the reasoning record after it closes. Reconcile any resulting truth into
the page that owns it, often a related project or entity, rather than rewriting the task as
a retrospective or duplicating the outcome.
