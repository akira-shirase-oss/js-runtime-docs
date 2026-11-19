---
title: A refused name's private addresses stay out of the script's error
date: 2026-11-16
type: Fix
areas: [Capabilities]
docs:
  - label: rt.fetch
    href: /guides/fetch/
---

When a `net` name resolves only to private space, the `CapabilityError` a script can read names
what it asked for and the opt-in — the resolved private addresses go to the operator's stderr, not
into the script-visible message.
