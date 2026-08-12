# Skills conventions

This subtree inherits the [[agents|root guide]]. It contains reusable Agent Skills discoverable
by the runtime.

## Discoverable shape

Use one immediate page at `skills/<skill-name>`, where the leaf is kebab-case. This is a local
runtime exception to the root entity-folder default: do not wrap a skill in a folder or add an
`intro`.

Three values must agree:

1. Page metadata title is exactly `SKILL.md`.
2. Page path leaf and YAML frontmatter `name` are identical.
3. Page metadata summary describes what the skill does and the natural requests that trigger
   it. Keep the frontmatter `description` aligned with that summary.

The body opens with:

    ---
    name: <skill-name>
    description: <what it does and when it should trigger>
    ---

Then provide the complete workflow, resources and expected output needed to use the skill.
Let its subject determine headings and degree of procedural detail. Page history provides
versioning.

A skill is used interactively with the owner. A scheduled unattended workflow belongs under
[[automations/agents|Automations]]. Link the applicable knowledge guide instead of copying its
conventions into the skill.
