# People conventions

Follow the [[agents|root guide]] for every convention not specific to people. This guide
adds only person selection and shape.

## Suggested shape

    people/<person-slug>/
    ├── intro                  — who they are and how the owner knows them
    ├── timeline               — material relationship and relevance events
    ├── contacts               — supported contact details and useful location facts
    ├── work                   — roles and companies over time, and notable work
    └── as-<relationship>      — the owner's view in one relationship context

Most people need only `intro`, commonly at `people/<first-last>/`. Add an aspect when its
subject becomes independently useful to read or maintain, and name it for that subject.

## What identifies a person

Under the [[agents#identifiability-is-the-threshold|root threshold]], anyone the evidence
resolves gets a page. Someone the owner met, someone who wrote to a channel they read,
someone named in passing as a colleague at a company under discussion — all the same, and
all the first time they appear.

What resolves a person here is a supported name plus enough context — company, role,
profile, contact detail or a specific interaction — to distinguish them from plausible
namesakes and existing aliases. That context can come from anywhere in the evidence, not
only from the sentence naming them: a given name offered as someone's counterpart is
resolved by the organization they are counterpart on, and a given name standing in on a
recurring duty by the team that duty belongs to. Read outward before deciding a name is
unresolvable.

A lone display name, given name or handle with nothing around it stays plain text while
genuine doubt remains, and where one display name genuinely stands for two people, say so
on both pages. That is the only reason to hold back — never how minor the person seems.

## Example intro

    # <Name>                                        ← intro

    **How the owner knows them:** one line.

    Why this person matters here, with links to the useful aspects.

    **Timeline:** [[people/…/timeline|Relationship history]].

    ## Notes
    What is worth knowing before another interaction.

Omit the `Timeline` link from `intro` until a timeline page exists, and add it in the same
write that creates one.

A person page says where they work, who introduced them or what they are working on, and
links each of those subjects. A person folder whose `intro` links nothing is a name in a
directory.

Record a meaningful change in what the person is doing — starting a role, company or
project — as a dated timeline event rather than an undated “currently” snapshot in `intro`.

Keep judgements specific, relevant to the owner's relationship and grounded in something
that happened. Write with the care appropriate to a real person.
