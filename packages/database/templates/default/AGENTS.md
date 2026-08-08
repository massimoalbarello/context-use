# Knowledge base conventions

This knowledge base is a durable hypermedia representation of the owner's life, work,
interests and thinking. Design it to remain useful beyond 100,000 pages.

This root guide contains only conventions that apply everywhere. A directory guide adds
the few rules specific to its subtree. Before writing, read this guide and each guide on
the path to the target; do not repeat inherited guidance in a child.

## Guide and managed-page index

### Guides

- [[about/agents|About]]
  - [[about/diary/agents|Diary]]
  - [[about/projects/agents|Projects]]
  - [[about/tasks/agents|Tasks]]
- [[automations/agents|Automations]]
- [[companies/agents|Companies]]
- [[events/agents|Events]]
- [[library/agents|Library]]
- [[meetings/agents|Meetings]]
- [[objects/agents|Objects]]
- [[people/agents|People]]
- [[places/agents|Places]]
- [[skills/agents|Skills]]
- [[topics/agents|Topics]]

### Managed pages

- [[automations/activity-distiller/instructions|Activity distiller instructions]] —
  maintained by the default template.
- [[automations/activity-distiller/state|Activity distiller state]] — created by the
  template when absent, then owned by the automation.

## Entities are folders

Anything with durable identity is represented by a folder, entered through `intro`;
other pages in that folder are views of the same entity. The owning directory guide
defines the useful views. Place a page by its subject, not by the request that produced
it: if a page could be handed to someone else's knowledge base and remain true, its
subject is the entity rather than the owner.

Give every page a one-sentence summary; directory indexes and search use it.

## What earns a page

The owner's own engagement is the threshold. Someone they met, wrote to or heard from; an
organization they dealt with, evaluated or decided about; a question they took a position
on — each earns a page the first time it happens, not once it repeats. A name that appears
only inside someone else's account, with no engagement by the owner, stays plain text
under the page that mentioned it.

Identity, not importance, is the reason to hold back. Create the page when the evidence
identifies the subject clearly enough to avoid a likely duplicate. Two people who share a
name, or two organizations that share a word, are two entities until something in the
evidence actually joins them.

## Reconcile rather than append

New evidence is a reason to reconsider the existing account, not to append another update
block. Read the canonical page, then make the smallest coherent change so there is one
concise current account. Do not append `Updates`, repeated snapshots or chronological
tails.

## Links

Use wikilinks for knowledge-base relationships. Put the wikilink on the sentence that
explains the relationship, never in a `Connections`, `Related` or `See also` list at the
end; generated directory indexes already provide navigation. Put a source link on the
text that makes the claim, not in a list of bare URLs at the end.

The first mention of a subject that has a page is a wikilink to it, whatever form the name
takes — a given name, a surname, an abbreviation, or a bare `the company`. If a page names
a subject that earns a page under its own guide and does not have one, create it in this
write and then link it; never write a link to a page that does not exist.

Link the page that carries the account, not the folder around it: an entity is entered
through `intro`, so `[[area/…/intro|Name]]` lands a reader on what is known, while
`[[area/…|Label]]` lands them on a generated index and belongs only where the collection
is itself the subject.

Connection is mutual, and mutual connection is what makes this base crawlable: someone
arriving at any subject should reach everything related to it by walking outward. An
occurrence names its participants and each participant's page says what that occurrence
was to them; an organization names the people the owner deals with there. Watch for the
shape where every page links one hub and nothing links sideways — it looks connected and
cannot be walked.

In copyable examples, use unresolved placeholders such as `[[area/…|label]]`, because
real wikilinks resolve even inside code blocks.

## Write, then report

Make confident, in-scope writes directly, then tell the owner which pages were created,
materially rewritten, merged or archived and briefly why. Ask before writing only when
unresolved identity or scope would make a confident choice unsafe.

## Directories and guide layering

Every directory is linkable and its index is generated from its immediate children. Do
not hand-maintain an `index` page.

A directory guide lives at `<directory>/agents`, titled `AGENTS.md`. Every child guide
links its direct parent guide and contains only local refinements. Inherited rules remain
in force without being copied; when a genuine local exception exists, the most specific
applicable guide wins and says so explicitly.

## Referencing uploaded assets

Every uploaded asset is referenced with the image form, leading `!` included, whatever
the file actually is:

    ![Cover letter](context-use://asset/<uuid>)

The `!` is what makes it an asset reference. Without it the page renders the literal words
`Private reference` where the file should be. Presentation follows the asset's own content
type: images and videos embed inline, every other type renders as a hyperlink labelled
with the bracket text, so a document needs a label that reads as a link.

## Privacy

Knowledge is private by default, and an agent cannot publish it. Never store credentials,
access tokens, access codes or recovery secrets, and never expose a sensitive identifier
or exact location in a title, path or summary.
