---
title: A sustained rate past the supervised output cap
date: 2026-11-18
type: Feature
areas: [Supervisor]
docs:
  - label: jsrt supervise
    href: /self-hosting/supervise/
---

`--max-output-rate-kbs` gives worker output a sustained rate past the `--max-output-kb` burst: a
chatty worker goes quiet once it exhausts the allowance instead of hitting a lifetime cap. Without
a rate the cap remains a lifetime budget — documented so operators pick knowingly.
