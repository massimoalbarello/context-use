# Library conventions

`library/` is the owner's collection of external material worth remembering: videos,
articles, blog posts, podcast episodes, papers, talks, threads and similar works. It is
not a feed, reading queue or archive of everything encountered. Save an item when its
ideas, the owner's reaction or its connection to existing knowledge makes it worth
finding again.

## One work, one folder

A saved work is an entity, so it gets a folder
([[agents#entities-are-folders-and-views-are-pages|root rule]]): one per work at
`library/<meaningful-slug>/`, entered through `intro`. The slug, folder title and `intro`
page title should make the subject or creator recognisable in a directory listing;
shorten a long original title rather than copying it mechanically. Prefer
`<creator>-<topic>` when the title alone is vague or likely to collide.

    library/<meaningful-slug>/
    ├── intro       — the canonical account of the work
    └── (pictures)  — uploaded into the folder and embedded from `intro`

Give every work folder a one-sentence directory summary when creating it. This is the
description shown for the work in the parent `library/` index, so it should say what the
item is and why it is useful to remember; do not leave it blank or merely repeat the
format or title. The `intro` page is required and is usually the only page. Add supporting
pages or assets beside it only when they make the saved work more useful to revisit.

Use the work itself as the unit, not its delivery format. A video and transcript of the
same talk are one entry with both links. Separate podcast episodes are separate entries.
Format is metadata, never a directory: do not create `videos/`, `podcasts/`, `books/` or
similar branches.

## Template

    # <Meaningful title>                           ← intro

    **Source:** [<full source title>](<canonical URL>)
    **Format:** <video | article | podcast | paper | talk | thread | other>
    **Creator:** [[people/…|Name]] or <name as plain text when no entity exists>
    **Publisher:** [[companies/…|Company]] or <publisher / channel as plain text>
    **Published:** <date, if known> · **Saved:** <date, only when useful>

    ## Summary

    A concise account of the work's useful argument, evidence or story. Link claims to
    the source inline; for audio or video, use timestamped links where they materially
    help. Omit this section when the source could not be accessed and the owner supplied
    no reliable description — never infer a summary from the title alone.

    ## Owner's note

    > <What the owner said when saving it, preserved exactly when their words are known.>

    Label a paraphrase as a paraphrase. Omit the section when the owner added no comment;
    do not invent why they saved something.

    ## Connections

    - **People:** [[people/…|Name]] — the relevant relationship to the work
    - **Companies:** [[companies/…|Company]] — publisher, employer or subject
    - **Related:** [[about/…|idea, project or preference]], [[about/tasks/…|decision frame]],
      [[meetings/…|meeting]], [[events/…|event]] or [[library/…|related work]]

Delete empty metadata and connection lines rather than leaving placeholders. The
`intro` page's one-sentence summary should follow the same standard as the folder
summary: say what the item is and why it is useful to remember, not merely its format or
title.

A saved work is fixed once published, so it has no timeline. What the owner did with it
over time belongs to whatever the work changed, and to the diary.

## Local rules

- **Keep the canonical source link prominent.** Prefer the creator or publisher's URL to
  a repost, tracking link or search result. Add alternate links only when they provide a
  distinct useful form such as a transcript.
- **Preserve the owner's words separately from the source summary.** Exact words stay
  exact and visibly quoted; interpretation is labelled. Never turn a source's claim into
  the owner's belief merely because they saved it.
- **Connect to canonical entities.** Link existing people, companies, projects, tasks,
  meetings and events wherever they explain why the item matters. If a missing entity is
  materially relevant, propose all such additions together rather than silently creating
  them.
- **Do not duplicate durable conclusions.** The library page records what the source
  says and what the owner said about it. When it changes a durable page elsewhere, edit
  that page too and link the two; do not make the library entry its new canonical home.
- **Summarise only from evidence.** If the source is inaccessible, preserve its link and
  the owner's note, record that no summary was available, and stop.
