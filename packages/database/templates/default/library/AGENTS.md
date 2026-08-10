# Library conventions

Follow the [[agents|root guide]] for every convention not specific to saved works. This
guide adds only library selection and shape.

`library/` is the owner's collection of external works worth finding again: articles,
videos, podcast episodes, papers, talks, threads and similar material. It is not a feed,
reading queue or archive of everything encountered.

## One work as the unit

    library/<meaningful-slug>/
    ├── intro       — the canonical account of the work
    └── (pictures)  — assets embedded from `intro`

Name the work so its subject or creator is recognizable in the library index; a shortened
title or `<creator>-<topic>` usually beats a mechanically copied long one. The work, not
its delivery format, is the unit: a talk and its transcript are one entry with two source
links, while distinct podcast episodes are separate works.

Save a work when its ideas, the owner's reaction or its connection to existing knowledge
makes it useful to retrieve again.

## Example `intro`

    # <Meaningful title>

    **Source:** [<full source title>](<canonical URL>)
    **Format:** <video | article | podcast | paper | talk | thread | other>
    **Creator:** [[people/…|Name]] or <plain name>
    **Publisher:** [[companies/…|Company]] or <plain publisher / channel>
    **Published:** <date, if known> · **Saved:** <date, when useful>

    ## Summary

    A concise account of the useful argument, evidence or story. For audio or video,
    timestamped links can point directly to important passages.

    ## Owner's note

    > <The owner's exact words when known.>

Keep the creator or publisher's canonical source prominent; alternate links help when they
provide a distinct form such as a transcript. Use plain text for a creator or publisher
that does not independently need an entity page.

The summary represents the work's claims, not the owner's beliefs. Preserve the owner's
exact words separately and label a paraphrase. If neither the work nor a reliable
description is accessible, keep the source and any owner note without inferring a summary
from the title.

Say why the work matters in the prose that makes the connection, linking the topic, project
or related work in the sentence itself, without moving another subject's durable conclusion
into the library entry.
