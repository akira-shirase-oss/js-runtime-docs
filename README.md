# jsrt Docs

The documentation for [jsrt](https://github.com/akira-shirase-oss/js-runtime), the open-source
purpose-built JavaScript host: the quick start, the `rt.*` script API and its capability manifest,
the CLI and its exit codes, supervision, self-hosting and the changelog.

**Read it at <https://docs.jsrt.404human.dev>.**

Built with [Astro Starlight](https://starlight.astro.build): static pages, Pagefind search, and
almost no JavaScript. jsrt has no HTTP API — there is no OpenAPI and no interactive reference; the
contract is the `rt.*` namespace, the CLI flags and the manifest keys, declared in
`src/data/surface.json`.

## How it stays true

Documentation that drifts from the code is worse than none, so CI checks the docs against jsrt
itself (`.github/workflows/ci.yml`), on every push and every night:

- **Examples run.** Code blocks marked `run=<suite>` are executed in order, in one shell, against a
  `jsrt` built from js-runtime `main` with the quick start's own commands; the block marked
  `output=<suite>` after each must match what the binary printed, once ids, times, ports and hashes
  are normalised (`scripts/snippets.mjs`). A block that cannot run in CI says why, `not-run="…"`,
  and the coverage check fails on any unmarked block.
- **The declared surface covers the product.** `src/data/surface.json` lists every `rt.*` name,
  every `jsrt run`/`jsrt supervise` flag and every manifest key; CI fails when the product source
  has one the file lacks, or when the file declares one the product does not
  (`scripts/check-rt.mjs`).
- **Links resolve.** Internal links are checked while building; external ones by lychee.
- **The output is complete and clean.** Every page has its Markdown copy, search and `llms.txt` are
  built, and no machine path, private name or real hostname is in the output
  (`scripts/check-dist.mjs`).

## Working on it

Node.js 22.17 or newer.

```sh
npm ci
npm run dev                    # http://localhost:4321
npm run build                  # the site in dist/, checked
npm test                       # the snippet runner's and drift check's own tests
scripts/check.sh               # the gate before every push
npm run hooks                  # once per clone: git runs that gate before every push
```

Running the examples needs `git`, `curl` and a Rust toolchain with rustup. With nothing on the
ports the pages use (they show `127.0.0.1:47421`, inside this worktree's band):

```sh
node scripts/snippets.mjs                  # clone js-runtime, build jsrt, run every example
node scripts/snippets.mjs --list           # what would run, in order
node scripts/snippets.mjs --coverage       # every code block: runs, a checked output, or not-run="why"
node scripts/snippets.mjs --skip install   # against a jsrt already on PATH or at $JSRT
```

## Writing

- Say what jsrt does on `main` today. Something not built yet is left out.
- jsrt is a CLI that runs on your machine: examples show `127.0.0.1` loopback addresses on the
  pages that run locally (the quick start, guides, self-hosting — each says so). Prose examples of
  a remote destination use `https://app.example.com`, a reserved domain (RFC 2606).
  `scripts/check-urls.mjs` holds the local list.
- No commit hashes, file paths of the product repository, internal decision numbers, secrets,
  hostnames or real names in public text.
- Changelog entries live in `src/content/changelog/`, one file per change, named
  `YYYY-MM-DD-short-name.md` (the name is the entry's permanent anchor). The schema is in
  `src/content.config.ts`.

## Deploying

Cloudflare Pages, project `js-runtime-docs`:

```sh
npm run build
npx -y wrangler@4.148.0 pages deploy dist --project-name js-runtime-docs --branch main
npm run check:live -- https://docs.jsrt.404human.dev   # search, headers, the changelog feed
```

## Licence

MIT, like jsrt.
