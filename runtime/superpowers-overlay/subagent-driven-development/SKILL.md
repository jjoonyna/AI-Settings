---
name: subagent-driven-development
description: Use when coordinating independent work in an approved implementation plan.
---

# Coordinating independent implementation work

The planning session may use internal agents for investigation and design analysis only. Implementation, rework, and formal review belong to separate persistent handoff sessions; agents do not redelegate. The planning session owns design and plan writing.

Before handoff, check task dependencies and file conflicts. Supply the model, role, scope, approved decisions, spec and plan paths, interfaces, verification, stop conditions, and reporting destination. The work session applies the approved plan without repeating design approval. It reports scope, files, commands and results, unresolved issues, and the next decision.

The planning session reads the actual changes and verification evidence, then opens a separate read-only review session. Review checks requirements, source changes, verification gaps, and security effects. Reviewers do not create, edit, or delete files. Fixes return to a work session and are reviewed again. Report handoff failures and restore the execution route. Do not infer completion from process exit or report arrival alone.

Commit, merge, push, and release only on explicit user instruction.
