# Projects conventions

**One folder per enduring body of work** at `about/projects/<slug>/`, entered through
`intro`, as [[agents#entities-are-folders-and-views-are-pages|every entity is]].

A project is something the owner builds, operates or stewards whose identity survives
individual deliverables: a product, organization, research programme, creative body of
work or maintained system. It is not every repository, ticket, client engagement or
short initiative. Repeated activity is evidence for a project only when it reveals one
coherent, durable subject.

## Minimal shape

    about/projects/<slug>/
    ├── intro       — what the project is, why it exists and its durable boundaries
    └── timeline    — optional, curated milestones that changed the project

`intro` is required. `timeline` appears only after there are milestones worth navigating.
Create any other page only when it has a stable subject worth retrieving on its own —
for example `architecture`, `principles` or `history` — and name it for that subject.
Anything inside the project that is an entity in its own right gets its own folder there,
under the root rule; pages hold the project's own views of itself.

## Project or task?

- A **project** is an enduring subject the owner expects to keep building or stewarding
  across several outcomes.
- A [[about/tasks/agents|task]] is a finite outcome, experiment or consequential
  decision that can resolve or close.
- The diary records what the owner did on a given day; each entity's timeline records the
  dated states that entity has passed through.

A task can advance a project and should link it. Do not duplicate the task's decision
frame in the project or turn the project into a queue of future work. A deliverable can
support a project without defining it, and several bodies of evidence can describe the
same project.

## What the durable pages say

Keep the canonical purpose, boundaries, durable design, principles, important outcomes
and links to related people, companies and tasks. Never keep an undated status, next
actions, backlogs, open pull requests or a running progress feed here. Reconcile new
evidence into the current account under
[[agents#reconcile-never-append-by-default|the root rule]].

The optional `timeline` is the project's entity timeline
([[agents#durable-pages-and-the-diary|root rule]]) and stays sparse: launch, material
direction change, major release, handover or similarly consequential outcome, each
linking the most specific diary, meeting, event or other canonical page and adding one
sentence about what durably changed. It is not a commit log or exhaustive release log.

## When to create one

Search first across names, aliases and related entities. Create a project only when the
owner names it as such or the evidence shows a durable body of work through repeated
activity over time or meaningful milestones. One isolated mention, a short burst of
activity or a guessed grouping is not enough.

When evidence fits an existing project, rewrite that project as needed. Prefer expanding,
renaming or restructuring the canonical project over creating a sibling with similar
content. If the relationship remains uncertain, link the activity in the diary and wait
for stronger evidence.

## Local rules

- Write in the owner's first person when describing their purpose or principles; ground
  it in what they actually expressed and mark inference.
- Link people, companies, repositories, meetings, events and tasks instead of copying
  their canonical context.
- Create no empty supporting pages. Concision and navigability matter more than a
  uniform project template.
