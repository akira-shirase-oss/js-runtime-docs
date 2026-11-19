---
title: A misspelt manifest key is an error that names it
date: 2026-11-16
type: Fix
areas: [Capabilities]
docs:
  - label: The manifest
    href: /reference/manifest/
---

An unknown key in `jsrt.manifest.json` now fails fast — exit 8, naming the key and the line — so a
misspelt bound like `"max_byte"` can never quietly become the default. Deny-by-default now covers
the manifest's own typos.
