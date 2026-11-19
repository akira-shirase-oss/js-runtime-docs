# jsrt Docs — agent instructions

The docs site for [jsrt](https://github.com/akira-shirase-oss/js-runtime), built with Astro
Starlight and deployed to Cloudflare Pages as `docs.jsrt.404human.dev`. The product repository
(`labs/js-runtime` or the clone in `.snippets/work/js-runtime`) is read-only reference for this
worktree; never edit it from here.

## The model (same as the sibling docs sites)

- `src/content/docs/*.mdx` are the pages. Code fences carry test markers: `run=<suite>` executes,
  `output=<suite>` must match what the binary printed (normalised), `not-run="why"` explains a
  block that cannot run. `node scripts/snippets.mjs --coverage` fails on any unmarked block.
- Suites run against a `jsrt` built from the product's `main` with the quick start's own commands.
  jsrt is a CLI that runs on the machine, so demo listeners and loopback fetches show
  `127.0.0.1:4742x` (this worktree's port band, 47420–47439); prose examples of a remote
  destination use `https://app.example.com` (RFC 2606). The list of pages allowed to show local
  addresses lives in `scripts/check-urls.mjs` (`ALLOWED`). Keep it accurate.
- `src/data/surface.json` declares the product's public surface — `rt.*` names, CLI flags,
  manifest keys. `scripts/check-rt.mjs` keeps it bidirectionally in sync with `bootstrap.js`,
  `main.rs` and `capability.rs` in the product source (jsrt has no HTTP API, so there is no
  OpenAPI; this is the contract).
- `scripts/check.sh` is the gate before every push: node tests, the drift check, snippet coverage,
  `npm run build` (internal links, CSP hashes, the output checks), the privacy and accessibility
  scan, no home paths in tracked files.

## Non-negotiables

- No secrets, real hostnames, home paths, user names, commit hashes or internal decision numbers in
  anything committed (public repo). The only real hostname allowed is `docs.jsrt.404human.dev`.
  `scripts/check-dist.mjs` enforces most of this in the output.
- Every example runs in CI or carries a `not-run` reason. Never fake an output block.
- Neutral theme: Starlight tokens only, no product palette — a shared design system is coming.
- Small commits on `main`; the coordinator reviews and pushes.

## Verification

`scripts/check.sh` before every commit that touches pages, scripts or config; `npm run build`
before any commit, always.
