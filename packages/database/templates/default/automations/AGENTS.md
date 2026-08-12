# Automations conventions

This subtree inherits the [[agents|root guide]]. It contains only the operating contracts,
minimal state and genuine dependencies of jobs run by an external harness.

The harness owns scheduling, execution, retries, credentials, run history and delivery. Each
automation runs independently: never read, wait on, mutate or use another automation's
instructions, state, checkpoint or report as a precondition.

## Shape

    automations/<automation-name>/
    ├── instructions
    ├── state
    ├── <real dependency>
    └── <YYYY>/<MM>/<DD>/<produced-artifact>

`instructions` is the harness-addressed entry point, a local exception to the root `intro`
default. It contains an executable workflow for gathering and processing inputs,
checkpointing progress, handling failures and reporting results. It links the guides that
own knowledge structure and writing; it does not copy their rules.

An incremental workflow may keep one `state` page containing only its current opaque
checkpoint and, when useful, its last successful completion time. Instructions must define
the exact state representation. Supporting assets sit beside the instructions only when the
workflow actually consumes them.

## Storage boundary

Never store source records, proposals, intermediate observations, scan logs, retry history,
page identifiers, credentials or harness metadata here.

Knowledge an automation learns belongs to its subject under that subject's guide, not under
the process that found it. A produced artifact is the exception: an issue, digest or other
thing the automation itself made may live beneath the automation, dated when separate runs
produce separate artifacts. Facts learned while producing it still belong to their subjects.

An automation instructions page must be runnable without remembered conventions, while
remaining procedural: it says how to acquire and process information and delegates the shape
of resulting knowledge to the applicable `AGENTS.md` chain.
