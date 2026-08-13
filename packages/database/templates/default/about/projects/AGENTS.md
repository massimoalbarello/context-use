# Projects conventions

This subtree inherits the [[about/agents|About conventions]]. A project is an enduring body of
work the owner builds, operates or stewards whose identity survives individual deliverables.

## Identity and boundary

Apply the root [[agents#identifiability-is-the-threshold|identifiability invariant]] to a
distinct body of work, not merely evidence that work happened. The owner naming it as a
project resolves it. Otherwise, repeated activity or a meaningful milestone can establish
durability when the work clearly breaks into several finite [[about/tasks/agents|tasks]].

A repository, ticket, pull request or short engagement is evidence or an artifact of work,
not automatically the project. When evidence resolves only one finite outcome, write the task
and link a project later if one becomes identifiable.

## Shape and account

    about/projects/<slug>/

`intro` says what the project is, why it exists, its durable boundaries and the high-level
project-specific reasoning that defines it. Link tasks, artifacts and external entities
rather than absorbing their accounts. Add another page such as `architecture`, `principles`,
`releases` or `history` when that aspect is independently useful.

Project timeline events are consequential milestones: launch, material direction change, a
release with a durable user-facing or architectural effect, handover or similarly durable
outcome. A project timeline is not a commit log or a list of build numbers.
