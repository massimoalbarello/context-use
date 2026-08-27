# Context Use engineering guide

Context Use is a Bun and TypeScript monorepo (`apps/*`, `packages/*`). Applications live in
`apps/*`; reusable code and configuration belong in `packages/*`.

Read the nearest nested `AGENTS.md` before changing a workspace. More specific guidance overrides
this file.

## Stack

- **Runtime:** Bun
- **Monorepo:** Bun workspaces and Turbo
- **Backend:** Elysia and SQLite
- **Frontend:** React and Vite
- **Linter/formatter:** Biome (auto-formats on save)
- **Commits:** Conventional Commits (commitlint)

## Simplicity

Simplicity is the primary design constraint. It does not mean the shortest patch or the fewest
files; it means solving the actual problem with the fewest necessary concepts, states, dependencies,
and special cases while preserving correctness.

- Do not start implementing until the problem, desired outcome, constraints, and success condition
  can be stated precisely. If they are unclear, investigate or ask rather than guessing.
- Question the problem before proposing a solution. Separate root causes from symptoms and solve the
  root cause once instead of patching each manifestation independently.
- For a non-trivial change, consider plausible alternatives—including doing nothing—and compare
  their correctness, complexity, operational risk, reversibility, and maintenance cost.
- Choose the smallest coherent solution that satisfies the current need. Do not add speculative
  features, extension points, configuration, or abstractions for imagined future requirements.
- Prefer removing, consolidating, or using an established mechanism over introducing another path.
- Say no to quick fixes whose consequences are not understood, and to features whose immediate value
  and timing cannot be explained. Stop and clarify rather than creating accidental commitments.
- Treat contorted control flow, long explanations, excessive indirection, and confused ownership as
  evidence that the problem or boundary is not understood well enough. Step back and simplify the
  model before continuing.
- Prefer obvious, maintainable, and reversible designs over clever ones. Complexity requires a
  concrete justification tied to an invariant or unavoidable constraint.

## Architecture

- Identify each feature's owning workspace and module, public contract, dependency direction, and
  critical invariants before changing it.
- Every module has one clear responsibility and one primary reason to change. If its description
  needs unrelated clauses joined by “and,” split it along that boundary.
- Organize application code by product area or feature, then by mechanism within that area. Do not
  accumulate unrelated code in a workspace root.
- Dependencies point inward: delivery and infrastructure code may depend on application/domain
  code; domain code must not depend on frameworks, database clients, or process globals.
- Construct stateful dependencies in an explicit composition root. Importing a module must not
  start a server, open a connection, read unrelated environment variables, or mutate global state.
- Expose the narrowest useful public surface. Keep implementation details private and avoid
  cross-feature imports that bypass a feature's public contract.
- Do not create generic `utils`, `helpers`, `common`, `shared`, or `types` dumping grounds. Put a
  reusable mechanism under the domain or capability that owns it and give it a precise name.
- Split a growing file before independent concepts, state machines, or side effects become
  interleaved. File length is a warning signal; cohesion decides the split, not a target line count.
- Prefer one primary component, use case, repository, or service per file. Small supporting types
  that exist only for that unit may remain beside it.

## APIs, types, and naming

- Biome enforces `useMaxParams: 1`. Model an operation with one named input object; do not use a
  large options object to conceal an incoherent operation. Split the operation when fields belong to
  different concerns.
- Keep dependency objects separate from request/input objects. Business input must not carry
  clients, loggers, clocks, or other infrastructure dependencies.
- Use one domain term consistently across the database, backend, frontend, and tests. Do not invent
  local synonyms for an established concept.
- Keep one source of truth for schemas, keys, enum-like values, and contracts. Infer or generate
  downstream types from the owner instead of copying them into broad type files.
- Index files only re-export a deliberate public surface; Biome rejects barrel files used as
  implementation modules.
- New TypeScript files use kebab-case. Comments explain a non-obvious constraint or tradeoff, never
  narrate code that names and types already explain.

## Reuse

- Reuse stable domain rules, protocol handling, transaction mechanics, parsers, and test harnesses.
  A rule must have one owner rather than several nearly identical implementations.
- Do not abstract merely because two short blocks look alike. Share code when the callers rely on
  the same semantic contract and should change together.
- Before adding a helper, search for the existing owner. Before extending an abstraction with
  unrelated flags or optional branches, split it into cohesive operations.
- Cross-workspace packages exist for genuinely shared contracts or capabilities, not as a place to
  move code that lacks a clear owner.

## Red flags

Stop and reconsider the design when any of these appear:

- A module, function, component, or test suite owns several unrelated workflows.
- An input object keeps growing because unrelated callers need different subsets of its fields.
- Similar domain logic exists in more than one place without a clearly identified owner.
- A shared abstraction needs mode flags or caller-specific branches to remain reusable.
- A feature reaches through another feature's internals instead of using a narrow public contract.
- A test exists only to increase coverage, repeats an invariant already proven elsewhere, or asserts
  implementation text instead of behavior.
- A proposed PR cannot be summarized as one outcome without listing unrelated changes.

## Tests

There is no coverage target and no expectation that every function has a test. Each test must name a
critical invariant, boundary, or failure mode whose regression would matter.

Prioritize tests for authorization and trust boundaries, data integrity and loss prevention,
important state transitions, idempotency and retry behavior, concurrency, and public contracts.

- Test each invariant at the lowest layer that can prove it. Do not repeat the same behavior through
  unit, controller, integration, and end-to-end tests without a distinct risk at each layer.
- Prefer a small decision table that covers meaningful branches over many near-duplicate examples.
- Assert observable behavior and durable contracts. Avoid snapshots of incidental markup, private
  call sequences, or source-string inspection when the behavior can be executed. Static policy
  tests are appropriate only for properties that cannot be exercised directly.
- Put reusable builders, fakes, database setup, and assertions in the owning workspace's
  `test/support`. Keep a fixture beside a feature only when no other feature should use it.
- Test support must use production types and public contracts; do not maintain a second model of the
  application for tests.
- Keep suites scoped to one boundary or invariant family. Split catch-all regression files, and
  remove redundant tests when a stronger test supersedes them.
- Never weaken encapsulation or export implementation details solely to make them testable.

## Database changes

Database state is durable shared state, not an implementation convenience. Read and follow
`apps/backend/src/db/AGENTS.md` before making any database change.

## Atomic changes and pull requests

Every PR has one goal that a reviewer can state in one sentence.

- Include only the implementation, focused tests, and documentation required for that goal. Leave
  unrelated cleanup for a follow-up.
- Separate behavior changes from broad refactors when either can stand alone. A mechanical move or
  rename should not quietly alter behavior.
- Keep dependency upgrades, formatting churn, generated-file refreshes, and unrelated renames out of
  feature PRs.
- Preserve unrelated work in a dirty worktree and review the final diff for accidental scope growth.
- Keep PR descriptions minimal: state the intent and any non-obvious rollout or risk in a few lines;
  the diff should explain the implementation.

Follow the repository-local [open-pull-request skill](./.agents/skills/open-pull-request/SKILL.md)
whenever drafting or opening a pull request.

## Validation

Check root and workspace `package.json` scripts before running commands. Run narrow checks while
iterating. Before handing off a completed implementation, always run:

1. `bun fix:codestyle`
2. `bun check:all`
3. `bun test`
4. `bun run build`

Run focused integration tests for the boundary changed by the PR. Exercise changed routes against a
running server when applicable.

## READMEs

Packages fall into two buckets:

- **Published packages** (have a `pkg/` directory) carry two READMEs:
  - `packages/<package>/pkg/README.md` is public, user-facing, and shipped to npm.
  - `packages/<package>/README.md` is for contributors. It links to the public README and covers
    source layout, development scripts, and constraints without duplicating install or usage docs.
- **Internal-only packages** (no `pkg/`) need a README only when they have contributor-relevant
  context that is not obvious from the source.

Update both READMEs in lockstep only when a change genuinely affects both audiences. Keep the root
README short; deep usage belongs in package documentation.

## Keeping guidance current

When a change establishes or changes an architectural, testing, migration, naming, tooling, or
dependency convention, update the owning `AGENTS.md` in the same PR. Guidance must describe the code
contributors are expected to write next, not an aspiration that accepted code ignores.
