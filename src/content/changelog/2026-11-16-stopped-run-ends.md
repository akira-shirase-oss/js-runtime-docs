---
title: A run the host stopped actually ends
date: 2026-11-16
type: Fix
areas: [Runtime]
docs:
  - label: Exit codes
    href: /reference/cli/#exit-codes
---

A run ended by `terminate_execution` — the timeout watchdog or the heap ceiling — now exits 6 even
when the engine's event loop declines to wind down on its own. Terminated stays classified, not a
hang that happens to share a signal.
