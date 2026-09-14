# Copilot autonomous completion policy

For any task, issue, or pull request assigned to Copilot in this repository, operate result-first and continue autonomously until the task is actually complete.

## Required loop

1. Inspect the current branch, all failing checks, and every unresolved actionable review thread.
2. Fix the root causes in the existing task/PR branch without unrelated scope expansion.
3. Run the relevant tests/builds/linters locally when available and push the fixes.
4. Re-check CI and review feedback. If new failures or actionable findings appear, fix them and repeat.
5. Completion means: required checks are green, the branch is mergeable, and actionable review threads are resolved or made obsolete by the fix.
6. When repository permissions and policy allow, leave the PR ready for merge/auto-merge. Never treat a red, conflicted, or unresolved PR as complete.

## Evidence rules

- Never label a result `verified` merely because an evidence object exists. Honor the actual verification state.
- Never claim a live device, external service, filesystem, network, payment, or deployment action succeeded without direct evidence.
- A verified-empty result is valid only when the underlying source was actually checked successfully.
- Preserve existing product canon and public behavior unless the task explicitly changes it.

## Blockers

Do not stop for routine implementation decisions. Stop only when a real external boundary prevents completion, such as unavailable credentials, required physical interaction, repository-admin permission, or an unavailable external seat/device. Report the exact blocker, the evidence for it, and the smallest action needed to unblock.

## Reviews and CI

When Copilot/Codex review finds defects or CI fails, treat that feedback as work to perform, not as a final report. Address all relevant findings, rerun verification, and continue the loop until green.