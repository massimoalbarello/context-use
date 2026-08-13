# Automations conventions

This subtree inherits the [[agents|root guide]]. This guide is for agents creating or changing
an automation. A running automation follows its own instructions and the guides applicable to
its output; do not make reading this authoring guide a runtime prerequisite.

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
default. Write it as a numbered state machine for gathering and processing inputs,
checkpointing progress, handling failures and reporting results. Make inputs, actions,
completion conditions and failure transitions explicit. Unfinished work loops back into
processing; only objective failure conditions named by the workflow enter a failure
transition.

Instructions must be runnable without remembered conventions. Link the guides that own the
structure and writing of output instead of copying their rules. State an operational safeguard
once, where it changes control flow, rather than repeating warnings elsewhere.

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
