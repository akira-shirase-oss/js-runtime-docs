---
title: The read fence checks before touching the filesystem
date: 2026-11-16
type: Fix
areas: [Capabilities]
docs:
  - label: Files and modules
    href: /guides/files-and-modules/
---

`rt.readText` enforces its 4 MiB cap on the bytes actually read and refuses non-regular files, and
paths outside the read fence are refused before the filesystem is ever asked — a refusal answers
alike for missing, out-of-fence and host files, so denials can't be used as an existence oracle.
