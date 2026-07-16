---
name: open-pr
description: Open, prepare, publish, or shepherd pull requests for this repository. Use when asked to create, raise, open, publish, or get a PR ready for review, including committing and pushing the intended changes and monitoring GitHub checks. Never merge a PR unless the user explicitly authorizes merging that specific PR.
---

# Open Pull Request

Finish the requested work as a narrow pull request and shepherd its pre-merge checks. Treat opening a PR as authorization to commit and push only the changes in scope; do not treat it as authorization to merge.

## Ground Rules

- Preserve user work. Never stage, rewrite, revert, or clean up unrelated changes.
- Use non-interactive `git` and `gh` commands.
- Never commit secrets, local environment files, build output, or unrelated generated files.
- Never push directly to `main`.
- Never merge, enable auto-merge, or press a merge button unless the user explicitly asks to merge that specific PR.
- Keep the PR narrow. Stop and ask for direction if the safe scope is materially ambiguous.
- Do not rewrite published history or force-push unless the user explicitly requests it and the consequences are clear.

## 1. Establish Scope and State

Read repository instructions and inspect the worktree before changing Git state:

```sh
git status --short --branch
git diff --stat
git diff
git diff --cached
git remote -v
git symbolic-ref refs/remotes/origin/HEAD
```

Infer the intended file set from the current task and conversation. Treat all other modifications and untracked files as user-owned. If an intended file overlaps unrelated edits, preserve both when safe; otherwise stop and explain the conflict.

Confirm GitHub CLI access and repository metadata when needed:

```sh
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef
```

Before creating a PR, check whether the current branch already has one. Update and shepherd the existing PR instead of opening a duplicate.

```sh
gh pr list --head "$(git branch --show-current)" --state open --json number,title,url,baseRefName,headRefName
```

## 2. Validate the Change

Run the smallest useful local checks for the touched area, then run broader CI-equivalent checks when the change affects shared code, dependencies, builds, infrastructure, or deployment.

Core repository checks are:

```sh
bun run typecheck
bun test
bun --cwd apps/server build
bun --cwd apps/web build
```

For dependency changes, also run `bun install --frozen-lockfile` and `bun audit --production`. For Terraform changes, initialize with `-backend=false` and validate each touched module. For deployment or image changes, run the relevant Compose, Caddy, or Docker validation mirrored in `.github/workflows/ci.yml` when practical.

Do not silently change unrelated code to make a check pass. Fix failures caused by the intended change; record pre-existing, environmental, skipped, or unresolved failures for the user and PR body when they matter to review.

## 3. Prepare the Branch and Commit

If already on an appropriate feature branch, keep it. If on `main`, detached HEAD, or an unrelated branch, create a focused branch from the correct base. Use the `codex/` prefix by default, for example `codex/add-open-pr-skill`.

Fetch before branching when a fresh base is required, but never discard local work. Stage only explicit paths:

```sh
git add -- path/to/intended-file another/intended-file
git diff --cached --stat
git diff --cached
```

Review the staged diff for scope, secrets, debug output, and accidental generated files. Commit with a concise message consistent with the repository history. Do not amend existing commits unless requested.

Push the branch without force:

```sh
git push -u origin "$(git branch --show-current)"
```

## 4. Open or Update the PR

Target the repository's default branch unless the user or existing branch stack requires another base. Use a concise title that describes the outcome and matches the repository's Conventional Commit-style history when appropriate.

Write the body for a reviewer who was not part of the implementation:

- Explain what changed and why in a short opening paragraph.
- Include decisions, tradeoffs, risks, migration notes, or follow-up context only when useful.
- Link the relevant issue with `Closes #...` only when closure is intended.
- Avoid generic checklists, padded three-bullet summaries, implementation trivia, and raw command output.
- Omit routine local validation lists. Mention validation only for a skipped check, failure, unusual caveat, or reviewer-relevant result.

Prefer `--body-file` over an inline shell string so Markdown and shell metacharacters remain intact:

```sh
gh pr create --base "$BASE_BRANCH" --head "$(git branch --show-current)" --title "$TITLE" --body-file "$BODY_FILE"
```

If a PR already exists, push the commits and update its title or body only when needed. Return the PR URL to the user.

## 5. Shepherd Pre-Merge Checks

Do not consider the publish step complete while required checks are pending. Inspect PR state, mergeability, and checks:

```sh
gh pr view "$PR_NUMBER" --json number,state,isDraft,mergeable,reviewDecision,statusCheckRollup,headRefName,baseRefName,url
gh pr checks "$PR_NUMBER"
```

Poll pending checks at reasonable intervals. Keep the user informed during long waits. When checks fail:

1. Inspect the failed check and logs with `gh run view "$RUN_ID" --log-failed` or the linked check details.
2. Determine whether the failure was introduced by this PR.
3. Reproduce it locally when practical.
4. Make the smallest safe in-scope fix, validate it, commit it, push it, and resume monitoring.
5. Stop and explain the evidence when logs are unavailable, permissions are missing, the failure is unrelated, or the fix would broaden scope materially.

Finish pre-merge shepherding when one of these states is reached:

- Required checks pass and the open PR is ready for review or merge.
- The PR is closed without merge and the user is told.
- GitHub state or logs are too ambiguous to continue safely and the user is told what is needed.
- The user explicitly asks to wait for a human action; arrange a current-task follow-up when that capability is available, including the PR URL, number, branch, base, current status, and next check.

Passing checks and clean mergeability are not merge approval.

## 6. Handle a Merge Only with Explicit Approval

If the user explicitly asks to merge this PR, use the repository's normal merge style, then identify the exact merged commit:

```sh
gh pr view "$PR_NUMBER" --json state,mergedAt,mergeCommit,url
```

Monitor post-merge runs for that commit rather than assuming the latest commit on `main` belongs to the PR:

```sh
gh run list --branch "$BASE_BRANCH" --commit "$MERGED_SHA" --json databaseId,status,conclusion,name,workflowName,event,headSha,url,createdAt
```

If post-merge CI fails because of the merged change, inspect the logs and open a new, narrowly scoped repair PR from the latest base. Link the original PR and failed run. Do not create an endless repair chain; if a second repair is not obvious and narrow, report the failure and ask for direction.
