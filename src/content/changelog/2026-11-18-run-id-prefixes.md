---
title: Worker lines carry their run id — and the report names the killer
date: 2026-11-18
type: Feature
areas: [Supervisor]
docs:
  - label: The report
    href: /self-hosting/supervise/#the-budgets--and-who-killed-whom
---

Supervised worker stderr is prefixed `[run <id>]` (stdout optionally, via `--prefix-stdout`), and
the JSON report's `killed_by` names which budget ended a run — `wall-clock`, `cpu-budget`,
`rss-budget`, `operator-sigterm` — instead of leaving it to inference.
