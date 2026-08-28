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
- **Linter/formatter:** Biome
- **Commits:** Conventional Commits

## Before implementation

Do not start implementing until the problem, desired outcome, constraints, and success condition can
be stated precisely. Question the request and distinguish the root cause from its symptoms.

- Before writing code, discuss the core design with the requester: ownership, boundaries,
  abstractions, important invariants, meaningful alternatives, and tradeoffs. Do not silently commit
  to an implementation.
- For a non-trivial change, consider plausible alternatives—including doing nothing—and compare
  correctness, complexity, operational risk, reversibility, and maintenance cost.
- Do not build a feature without a concrete current need. Say no or ask for clarification when its
  value, timing, or consequences are unclear.

## Simplicity and deletion before addition

Simplicity is the primary design constraint. Choose the smallest coherent solution with the fewest
necessary concepts, states, dependencies, and special cases. This is not the same as the shortest
patch.

- Before adding code, dependencies, configuration, or abstractions, ask whether the existing design
  can be simplified, consolidated, reshaped, or deleted to accommodate the change.
- Prefer one clear path over parallel mechanisms. Do not preserve obsolete structure merely because
  adding beside it is easier.
- Reject quick fixes that address a symptom without resolving the cause.
- Treat contorted control flow, excessive indirection, long explanations, and confused ownership as
  evidence that the model or boundary needs to be reconsidered.
- Prefer obvious, maintainable, and reversible designs over clever ones. Every added layer of
  complexity needs a concrete justification.

## Design, abstractions, and modularity

Code that merely works is not sufficient. Its design must make ownership and future change clear.

- Define the right components and abstractions—modules, classes, interfaces, or equivalent—before
  distributing logic. Each must represent a cohesive role or boundary, not ceremony.
- Assign a rule to the component that owns and enforces its invariant. Share it only when consumers
  rely on the same semantic contract and should change together.
- Every module has one responsibility and one primary reason to change. Split unrelated workflows
  instead of joining them with flags, optional branches, or large input objects.
- Dependencies point inward. Construct stateful dependencies in an explicit composition root;
  importing a module must not open connections, start processes, or mutate global state.
- Expose narrow public contracts and keep one source of truth for schemas, keys, enum-like values,
  and types. Derive downstream representations instead of copying them.
- Do not create generic `utils`, `helpers`, `common`, `shared`, or `types` dumping grounds. Name the
  domain or capability that owns the code.
- Biome enforces one function parameter. When an operation needs several values, destructure a
  named object in its signature so call sites name every argument and cannot confuse positional
  values, especially values of the same type. Split the operation if the object is not cohesive.
- Use one domain term consistently. New TypeScript files use kebab-case. Index files only re-export
  deliberate public surfaces. Comments explain non-obvious constraints or tradeoffs, not the code.

## Planned evolution

Context Use initially runs as a single-user instance backed by SQLite. Multi-user instances with
strong privacy boundaries and additional databases, beginning with PostgreSQL, are planned. Treat
the current user count and database as deployment choices, not permanent domain assumptions.

- Make the acting identity and resource ownership explicit at trust, service, and persistence
  boundaries. Never rely on an implicit “only user” or process-global principal.
- Keep domain and application contracts independent of a database client or SQL dialect. Isolate
  current implementation details behind owned repository and adapter boundaries.
- Preserve these seams now, but do not build unused database adapters, tenancy machinery, extension
  points, or configuration. Generalize an abstraction when a concrete implementation needs it.

## Red flags

Stop and revisit the design when:

- The problem or success condition cannot be explained without referring to the proposed solution.
- A module, function, component, or test owns unrelated workflows.
- An abstraction needs caller-specific modes, or an input object keeps accumulating unrelated
  fields.
- Similar domain logic exists in several places without one clear owner.
- New code is being added even though deleting or reshaping existing code could solve the problem.
- The change cannot be summarized as one outcome without listing unrelated work.

## Tests

There is no coverage target and no expectation that every function has a test. Each test must
protect a critical invariant, boundary, or failure mode whose regression would matter.

- Use `bun:test` as the common unit and integration runner. Add another runner only when a concrete
  boundary cannot be tested coherently with the existing stack.
- Each workspace keeps tests in `test`, organized by the same feature, capability, and boundary
  ownership as production code. Reusable test infrastructure belongs in that workspace's
  `test/support`.
- Test an invariant at the lowest layer that can prove it. Do not repeat the same behavior at every
  layer without a distinct risk.
- Prefer compact decision tables over near-duplicate cases.
- Assert observable behavior and durable contracts, not private call sequences or source text when
  behavior can be executed.
- Keep suites scoped and remove redundant tests when a stronger test supersedes them.
- Never weaken encapsulation solely to make implementation details testable.

## Database changes

Database state is durable shared state, not an implementation convenience. Read and follow
`apps/backend/src/db/AGENTS.md` before making any database change.

## Atomic changes and pull requests

Every PR has one goal that a reviewer can state in one sentence.

- Include only the implementation, focused tests, and documentation required for that goal.
- Separate behavior changes from broad refactors when either can stand alone.
- Keep unrelated upgrades, generated-file refreshes, formatting churn, and renames out of the PR.
- Preserve unrelated work and review the final diff for accidental scope growth.
- Keep the description brief: state the intent and any non-obvious risk or rollout detail.

Follow the repository-local [open-pull-request skill](./.agents/skills/open-pull-request/SKILL.md)
when drafting or opening a pull request.

## Validation

Check root and workspace scripts before running commands. Before handing off an implementation, run:

1. `bun fix:codestyle`
2. `bun check:all`
3. `bun run test`
4. `bun run build`

Also run focused integration checks and exercise changed routes when applicable.

## Documentation

Published packages keep public usage docs in `pkg/README.md` and contributor guidance in
`README.md`; the contributor README links to the public one without duplicating it. Internal-only
packages need a README only for non-obvious contributor context. Keep the root README short.

When a change establishes a convention, update the owning `AGENTS.md` in the same PR. Guidance must
describe the code contributors are expected to write next.
