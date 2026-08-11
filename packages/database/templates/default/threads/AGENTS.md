# Threads conventions

Follow the [[agents|root guide]] for every convention not specific to threads. This guide
adds only thread selection, boundary and shape.

`threads/` is for a line of written correspondence the owner is part of. It is the
asynchronous sibling of a [[meetings/agents|meeting]] and stands exactly where a meeting
stands: a conversation happened, and this is the account of it. A meeting happens once and
is dated; a thread has a first message and no scheduled end, which is why its folder
carries no date.

An exchange the evidence resolves — who is in it and what line of work it is about — earns
its thread on exactly the terms a conversation earns its
[[meetings/agents#what-identifies-a-meeting|meeting page]], and the bar is not raised for
being written instead of spoken. Correspondence is where most of what the owner learns
actually arrives, and leaving it to be split one line at a time across the pages of the
parties to it is how a base ends up knowing that things were discussed and not what was
said.

## The thread carries the account

The thread is the **primary record of what the exchange established**, in full: the
figures, terms, dates, conditions, the positions people took and the reasons they gave,
and the order things moved in. Write it here completely, and do not thin it because a
fact also belongs somewhere else.

Some of that knowledge has no other home. A price contingent on a milestone another
company owns, a concession traded for a deadline, a condition that only reads next to the
objection it answers — none sits cleanly on any one party's page, and all of it is lost if
the exchange is only ever summarised into its participants.

**Every thread has a `timeline`, from the first write.** Elsewhere in this base a timeline
is added once an entity has accumulated state changes; here it is not optional, because a
thread is a progression and an `intro` alone flattens it into a snapshot. How a position
moved — what was asked, what came back, what was conceded and when — is most of what the
owner returns to a thread for, and it is exactly what a current-state page cannot hold.

So the two pages divide the work: `intro` says where the exchange stands now and is
corrected in place as it moves; `timeline` says how it got there and is only ever appended
to. When a position changes, both are written in the same coherent change — the correction
above, the dated line below. Every material exchange earns its line on the day it happened,
including the one that created the thread.

## The entities additionally get what they own

A thread that holds knowledge its entities do not is a failure. In the same write:

- every person and organization the exchange identifies gets its page and a link from
  here, on the [[people/agents#what-identifies-a-person|people threshold]] — including
  those merely named in the exchange, not only its correspondents;
- every durable fact with a clear owner is also written on that owner's page or
  `timeline`, in its particulars;
- a material development earns a timeline event on the entity it happened to, linking here.

A figure appearing both on a company's timeline and in this thread's account is **correct,
not duplication**: one records that it happened to that company, the other what it was
traded against. The failure to avoid is the figure that appears *only* here — and the way
to avoid it is to write the entity too, never to leave the account thin.

## A knowledge thread is not a provider thread

The boundary is the line of work, not the container the messages arrived in. One thread may
draw on several email threads, a Slack conversation and a forwarded message; one email
thread may feed two threads when it carries two unrelated lines of work. Neither is the
usual case: when the original exchange is already well bounded and self-contained, one
thread for it is right, and hunting for a cleverer grouping wastes the run.

Name the slug for the subject matter — `northwind-renewal-terms`, not `email-thread-412`
or `slack-deals`. Never open a thread per channel, per counterparty or per provider thread
id: a thread named for a Slack channel is a feed, and a feed is what this base exists not
to be. That rule governs how threads are bounded and named. It is not a reason to write
fewer of them.

## What does not earn one

The exclusions are the root guide's noise filter, no more: newsletters, notifications,
receipts and cold outreach. An exchange that only arranges a meeting belongs to that
meeting.

A single message can be a thread when it establishes enough that its parts have to be read
together — a figure, the condition attached to it and what it changes. One message carrying
one fact is not a thread; it is a timeline event on the entity that fact is about, and the
subjects it names still get their pages.

A thread may be the origin of a [[about/tasks/agents|task]], a [[topics/agents|topic]] or a
[[about/projects/agents|project]], and often is when it runs long. Create that page when its
own guide says so and link the two. The thread keeps what was exchanged; the task keeps the
question and how the owner is deciding it. Neither replaces the other.

## Shape

    threads/<thread-slug>/

Threads are flat and undated as folders, unlike [[meetings/agents|meetings]] and
[[events/agents|events]]: a thread has no single date to file it under. Both pages are
written together; a thread folder holding only an `intro` is incomplete.

Prefer the useful account over a message log. Never paste message bodies, quote blocks or
`>` reply chains; the goal is what the correspondence established, not that it occurred.

`intro` establishes who is in the exchange, since when and what is at stake in it; where
things currently stand, written to stay true as weeks pass; the particulars the exchange has
produced — figures, terms, dates, conditions and the reasons given for them, with who holds
which position where that is the knowledge; and what is unresolved, together with what would
resolve it. An exchange that has produced one figure and one open question is that, in a
paragraph. A negotiation that has moved four times over three terms needs the room to say
so, and its headings are those terms.

Keep what a correspondent asserted distinct from what the owner concluded. A commitment
records what was agreed then; its later state follows the root timeline contract.

The `timeline` follows the root contract, one dated line per material exchange:

    ## 2026                                        ← timeline

    ### April

    - **17 April** — [[people/…|Priya Raman]] — countered at 4.2k a month, holding the
      two-year term and dropping the setup fee.
    - **11 April** — [[people/…|Priya Raman]] — opened at 5k a month on a three-year term.

Its lines record what an exchange established, not that a reply arrived: *conceded 60-day
payment terms in exchange for a two-year commitment* is an event, *replied to Priya about
the contract* is not. Read together, the lines should show how the position moved; that
progression is the reason this page exists.

A thread with no material exchange for roughly six months is finished: reconcile anything
durable into the pages that own it and archive the thread.
