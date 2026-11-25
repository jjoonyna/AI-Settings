---
name: dispatching-parallel-agents
description: Use when two or more independent investigations can proceed without shared state or sequential dependencies.
---

# Parallel investigation

Identify independent investigation domains and assign each a bounded question, relevant paths, constraints, and evidence to report. Avoid overlapping changes and check dependencies before running work in parallel. The planning session synthesizes findings and owns design decisions and documents.

Internal planning agents investigate or analyze designs only; they do not implement, write the spec or plan, or perform formal review. Implementation and rework use persistent work handoffs; formal review uses a separate read-only review handoff. Agents do not redelegate. Specify a permitted model and require concrete evidence, uncertainty, and failed attempts in each report.
