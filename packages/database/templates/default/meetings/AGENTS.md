# Meetings conventions

**One folder per meeting** at `meetings/<YYYY>/<MM>/<YYYY-MM-DD>_<slug>/`, entered
through `intro`, as [[agents#entities-are-folders-and-views-are-pages|every entity is]].

    meetings/<YYYY>/<MM>/<YYYY-MM-DD>_<meeting-slug>/
    ├── prep    — written before: background and what to ask
    └── intro   — written after: what was said and what was taken away

## Aspects

- **`intro`** — the record of the conversation. Required, and usually the only page.
- **`prep`** — written *before*, holding background and the questions worth asking.
  Leave it as written afterwards: it records what was expected going in, not a draft of
  the write-up.
- **`transcript`** — rare; see below.

Photos, whiteboards and shared decks upload into the folder and embed from `intro`.

A meeting is a completed occurrence, so it has no timeline of its own — it is what other
entities' timelines link to.

## When a meeting gets a folder

When something would be lost by forgetting it: a conversation with someone external, an
intro, an interview, a call where something was decided or learned. Routine internal
syncs don't. The value of this directory is that everything in it is worth reading.

An **[[events|event]]** is defined by the occasion, a meeting by who was in it. A
conversation at an event that matters on its own gets its own meeting folder, linking
the event.

## No transcripts

**Distil, never dump.** No transcript exports, no recording dumps, no pasted notes-app
contents — link the recording where it already lives, on the line that cites it.

This is about retrieval, not tidiness. A transcript is the raw material the write-up
already extracted; keeping both means every future search over this directory wades
through ten thousand words of hedging and crosstalk to reach the two paragraphs that
mattered. The write-up *is* the artefact.

The single exception is a transcript that is the only record and whose source will not
survive. It goes in as `transcript`, marked raw at the top, never in place of `intro`.

## Template

    # <What it was> — <D Month YYYY>              ← intro

    **With:** [[people/…|Name]] ([[companies/…|Company]])
    **Where:** in person / call · **Why:** one line.

    ## What was said
    The substance. Distilled, not transcribed.

    ## What I took away
    The owner's read at the time — what the conversation changed in their
    thinking and what they concluded from it.

    ## Commitments made
    - What each participant agreed during the meeting, stated as a historical fact.

## Local rules

- **Link every participant.** Before writing, search for each person and resolve any
  ambiguous identity. A missing participant folder is part of the same proposed meeting
  write because the meeting cannot be represented coherently without it. Link their
  company where materially relevant; propose any other missing entity in the same
  batched question rather than creating a silent cascade.
- **Never describe the people or the company here.** A meeting page that reintroduces its
  participants will contradict their folders within the year.
- **Separate what was said from what the owner concluded.** Both are useful; conflating
  them makes the page untrustworthy later.
- **Commitments are historical facts.** Record what was agreed here, as of this date;
  subsequent ownership and next actions go in the diary, linking the project or
  [[about/tasks|task]] that gives them durable context.
- **Index every entity this moved.** In the same proposed write, add one dated line and
  a link to the `timeline` of each participant, of a company whose relationship with the
  owner this materially concerns, and of anything else whose state the meeting changed —
  an application, a project, a decision ([[agents#durable-pages-and-the-diary|root
  rule]]). One sentence each, never a copy of the write-up.
- Written promptly or not at all; a page written a week later from memory should say so.
- The [[about/diary|diary]] gets one line and a link, not the content, and the meeting
  page does not narrate the day around it. If a meeting changes what the owner wants, the
  durable page gets updated too — the meeting page records that it happened, it is not
  where the new position lives.
