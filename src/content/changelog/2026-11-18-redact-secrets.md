---
title: Mask secrets in forwarded worker output
date: 2026-11-18
type: Feature
areas: [Supervisor]
docs:
  - label: Redaction
    href: /self-hosting/supervise/#redaction--never-a-secret-on-argv
  - label: Security model
    href: /self-hosting/security/
---

`jsrt supervise --redact-env NAME` masks an environment variable's value in forwarded output, and
`--redact-file PATH` masks each non-empty line of a file — refusing one readable by group or
world. Neither flag ever carries the literal on argv, and masked bytes are counted in the report
so masking is admitted, not silent.
