---
name: finishing-a-development-branch
description: Use when implementation and validation are complete and branch integration has been explicitly requested.
---

# Finishing a development branch

Verify the relevant tests and inspect the diff and branch state. Report failures and unresolved review findings; do not claim completion without evidence. The planning session confirms the work and separate read-only review.

Commit, merge, push, tag, release, and destructive cleanup require the user's explicit instruction for each action. Do not propose or perform these merely because implementation finished. Preserve worktrees and branches unless their removal is authorized. If an action is explicitly authorized, check its exact target and run the necessary validation before and after it.
