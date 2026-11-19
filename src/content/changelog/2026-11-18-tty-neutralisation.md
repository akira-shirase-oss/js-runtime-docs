---
title: Worker control bytes are neutralised at the terminal
date: 2026-11-18
type: Feature
areas: [Supervisor]
docs:
  - label: Output handling
    href: /self-hosting/supervise/#output--bounded-counted-neutralised
---

Forwarded worker output is stripped of terminal control sequences when the sink could interpret
them — a worker can no longer move an operator's cursor, rewrite lines or stage a paste-attack.
`--output-raw` opts out explicitly, for trusted workers only.
