#!/usr/bin/env node
// Runs the docs' examples against a real jsrt and fails on any difference from what the pages
// show. The examples live in the MDX itself:
//
//   ```sh run=quickstart                  a command, run in order in one bash session
//   ```sh run=cli exit=7                  a command the page shows failing: it must end with that status
//   ```sh run=cli stderr=1                its standard error is part of its output (a refusal line)
//   ```text output=ops match=lines        a stream: every line shown must arrive, in any order
//   ```text output=quickstart             what the command before it prints; compared after
//                                         normalising ids, times, ports, pids and hashes
//   ```js title="hello.js" run=quickstart file=hello.js   written to hello.js in the current directory
//   {/* snippet quickstart: snippets/steps.sh */}   a script sourced at that point
//
// Every suite runs in one bash session, in the order of SUITES; a page's blocks run in document
// order, so cd, exports and background jobs persist exactly as they do for a reader. A block with
// `step=NAME` in its info string can be left out with `--skip NAME`.
//
//   node scripts/snippets.mjs                       check every suite: clones js-runtime into
//                                                   .snippets/work, builds jsrt from main, runs
//                                                   every example against it
//   JSRT_BIN=/path/to/jsrt node scripts/snippets.mjs --skip install   against a binary already built
//   node scripts/snippets.mjs --update ...          write what ran into the pages' output blocks
//   node scripts/snippets.mjs --list                print the steps without running them
//   node scripts/snippets.mjs --coverage            count every code block: run, a checked output,
//                                                   or `not-run="reason"`; fails on any other block
//
// Addresses. jsrt is a CLI that runs on this machine, so the local pages show real loopback
// addresses on the port band this worktree owns, 127.0.0.1:47421–47429 (47420 is the docs
// preview). --port-base N moves the band: shown 127.0.0.1:4742x runs and compares as
// 127.0.0.1:N+x-1, so a developer's allotted band is honoured and the outputs compare equal either
// way. Remote destinations show https://app.example.com, a reserved domain (RFC 2606) — it is only
// ever used for a fetch the sandbox refuses before any I/O, so the text runs as written.
//
// A block that can't run here (a systemd unit, a real-internet fetch, a two-minute drill, a shape
// rather than a command) says so in its info string, `not-run="why"`, so the gap is counted and
// visible, never silent. One that could run but isn't wired up yet says `not-run="todo: why"`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DOCS = join(ROOT, 'src/content/docs');
/**
 * The remote host pages show in examples of a denied or unreachable destination. Reserved for
 * documentation (RFC 2606); it is never fetched successfully — the sandbox refuses the grant-less
 * request before any I/O, so it runs literally.
 */
export const EXAMPLE_BASE = 'https://app.example.com';
/**
 * The first demo port pages show. `127.0.0.1:4742x` is the worktree band: 47421–47429 for demos
 * (47420 is the docs preview). At run time x maps to port-base + x - 1.
 */
export const SHOWN_PORT_BASE = 47421;
/** Suites in the order they run; later suites may use what earlier ones leave (PATH, files). */
const SUITES = ['quickstart', 'cli', 'fetch', 'files', 'kv', 'media', 'serve', 'supervise', 'webhook'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
/** The first port the demo listeners actually bind; shown 4742x → base + x - 1. */
const portBase = Number(option('port-base', SHOWN_PORT_BASE));
const skip = new Set((option('skip', '') || '').split(',').filter(Boolean));
const only = option('suite', '');
const workdir = resolve(option('cwd', join(ROOT, '.snippets/work')));

/** The demo ports: shown 47421–47429 map to base+0…base+8. */
const portMap = (base = portBase) => Array.from({ length: 9 }, (_, k) => ({ shown: SHOWN_PORT_BASE + k, real: base + k }));

/**
 * A block's code as it runs: every shown band address becomes the real one — `127.0.0.1:4742x`
 * first, then the bare port where a flag or a manifest takes it (`"port": 47422`). Remote example
 * hosts are not rewritten: they only appear where the run refuses them before any I/O.
 */
export function runnable(code, base = portBase) {
	let out = code;
	for (const { shown, real } of portMap(base)) {
		if (shown === real) continue;
		out = out.replaceAll(`127.0.0.1:${shown}`, `127.0.0.1:${real}`);
	}
	for (const { shown, real } of portMap(base)) {
		if (shown === real) continue;
		out = out
			.replace(new RegExp(`localhost:${shown}\\b`, 'g'), `localhost:${real}`)
			.replace(new RegExp(`:\\s*${shown}\\b`, 'g'), `: ${real}`)
			.replace(new RegExp(`\\b${shown}\\b`, 'g'), String(real));
	}
	return out;
}

// ---------------------------------------------------------------- reading the pages

function mdxFiles(dir) {
	return readdirSync(dir)
		.flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? mdxFiles(path) : path.endsWith('.mdx') ? [path] : [];
		})
		.sort();
}

// The indent is spaces and tabs only: `\s` would let a match start on the blank line before a fence and
// then look for a closing fence after a blank line too, swallowing the blocks in between.
const FENCE = /^([ \t]*)(`{3,})([\w-]*)([^\n]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm;
/** Every fenced block in a page's text: `[indent, fence, lang, info, body]` per match. */
export const fences = (text) => [...text.matchAll(FENCE)];
const COMMENT = /\{\/\*\s*snippet\s+([\w-]+):\s*(\S+)((?:\s+[^\s*]\S*)*)\s*\*\/\}/g;
// A key starts the info string or follows a space, so `run=` never matches inside `not-run=`.
const meta = (text, key) => text.match(new RegExp(`(?:^|\\s)${key}=("([^"]*)"|\\S+)`))?.[2] ?? text.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`))?.[1];

/** Every step of every suite, in document order. */
function readSteps() {
	const steps = [];
	for (const file of mdxFiles(DOCS)) {
		const text = readFileSync(file, 'utf8');
		const found = [];
		for (const match of text.matchAll(FENCE)) {
			const [, indent, , lang, info, body] = match;
			const run = meta(info, 'run');
			const output = meta(info, 'output');
			if (!run && !output) continue;
			const code = body
				.split('\n')
				.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
				.join('\n');
			found.push({ at: match.index, kind: run ? 'run' : 'output', suite: run ?? output, lang, info, code, file, start: match.index, end: match.index + match[0].length, indent });
		}
		for (const match of text.matchAll(COMMENT)) {
			found.push({ at: match.index, kind: 'script', suite: match[1], path: match[2], args: (match[3] ?? '').trim(), file });
		}
		found.sort((a, b) => a.at - b.at);
		for (const step of found) {
			if (step.kind === 'output') {
				const previous = steps.findLast((candidate) => candidate.suite === step.suite);
				if (!previous || previous.kind !== 'run' || previous.expect) throw new Error(`${relative(ROOT, file)}: an output block with no command before it`);
				previous.expect = step;
			} else {
				steps.push(step);
			}
		}
	}
	for (const step of steps) if (!SUITES.includes(step.suite)) throw new Error(`${relative(ROOT, step.file)}: unknown suite "${step.suite}"`);
	return steps;
}

// ---------------------------------------------------------------- normalising output

/** Split `curl -i` output into its head and body; anything else is all body. */
function split(text) {
	const normal = text.replace(/\r\n/g, '\n');
	if (/^HTTP\/[\d.]+ \d{3}/.test(normal)) {
		const at = normal.indexOf('\n\n');
		return at === -1 ? { head: normal.trimEnd(), body: '' } : { head: normal.slice(0, at), body: normal.slice(at + 2) };
	}
	return { head: null, body: normal };
}

/** JSON bodies are compared by value, and shown indented. */
function jsonBody(body) {
	const trimmed = body.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

/** A JSON body indented, with every number exactly as jsrt wrote it (`45.0` stays `45.0`). */
function indent(body) {
	try {
		const exact = JSON.parse(body.trim(), (key, value, context) => (typeof value === 'number' ? JSON.rawJSON(context.source) : value));
		return JSON.stringify(exact, null, 2);
	} catch {
		return null;
	}
}

/**
 * Rewrite the real ports back to the ones the page shows (used by --update and by normalise).
 * Only host:port forms are mapped: a bare port in output (`"bytes":47430`) is data, not an
 * address — mapping it back would hide a real difference.
 */
const toShown = (text) => {
	let out = text;
	for (const { shown, real } of portMap()) {
		if (shown === real) continue;
		out = out.replaceAll(`127.0.0.1:${real}`, `127.0.0.1:${shown}`).replaceAll(`localhost:${real}`, `localhost:${shown}`);
	}
	return out;
};

export { portMap };

/** What the page shows: headers as they came, a JSON body indented, the shown ports as written. */
export function display(text) {
	const { head, body } = split(toShown(text));
	const json = jsonBody(body);
	const shown = json === null ? body.trimEnd() : (indent(body) ?? JSON.stringify(json, null, 2));
	return head === null ? shown : shown === '' ? head : `${head}\n\n${shown}`;
}

/** What is compared: values that differ on every run become placeholders. */
export function normalise(text) {
	const { head, body } = split(toShown(text).replaceAll(escape(workdir), '<work>'));
	const json = jsonBody(body);
	const flatBody = json === null ? body.trim() : JSON.stringify(json);
	const all = `${head ?? ''}\n\n${flatBody}`
		.replace(/"run_id":"[^"]+"/g, '"run_id":"<id>"') // the supervisor stamps every run
		.replace(/"worker_pid":\d+/g, '"worker_pid":<pid>')
		.replace(/"(wall_ms|cpu_ms|peak_rss_bytes|duration_ms|bytes|max_bytes|total_ops|served|dropped|truncated_bytes|rate_limited_bytes)":\d+/g, '"$1":<n>')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
		.replace(/\b[0-9a-f]{64}\b/g, '<hex64>') // a media digest, a generated token
		.replace(/sha256:[0-9a-f]{64}/g, 'sha256:<hash>')
		.replace(/\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z?\b/g, '<time>')
		.replace(/^date: .*$/gim, 'date: <date>')
		.replace(/^content-length: \d+$/gim, 'content-length: <n>')
		.replace(/\bworker \d+ running, signals forwarded\b/g, 'worker <pid> running, signals forwarded')
		.replace(/\b\d+(\.\d+)?ms\b/g, '<ms>') // a duration in prose output
		.replace(/[ \t]+$/gm, '');
	return all.trim();
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether what ran matches the page's output block. Normally the whole normalised text must be
 * equal. With `match=lines` (a stream, whose lines may interleave), every line the page shows must
 * be among the lines that arrived, in any order.
 */
export function matches(actual, expect) {
	if (meta(expect.info ?? '', 'match') !== 'lines') return normalise(actual) === normalise(expect.code);
	const seen = new Set(normalise(actual).split('\n'));
	return normalise(expect.code)
		.split('\n')
		.filter((line) => line.trim() !== '')
		.every((line) => seen.has(line));
}

// ---------------------------------------------------------------- running the steps

function runAll(steps) {
	const dir = join(ROOT, '.snippets', 'run');
	mkdirSync(dir, { recursive: true });
	mkdirSync(workdir, { recursive: true });
	// One bash session for every step, in order: a reader's shell keeps cd, exports and background
	// jobs between commands, and so does this. Each block is sourced from its own file so its
	// output lands in <index>.out — a regular file, so a backgrounded server keeps writing to it
	// harmlessly after the block returns.
	const lines = [
		'set -euo pipefail',
		'shopt -s expand_aliases',
		// However the run ends — a failing step, an early stop — the listeners and jobs it started
		// are its own children; reap them so a stopped run never leaves a stale port.
		"trap 'kill $(jobs -p) 2>/dev/null || true' EXIT",
		`cd ${JSON.stringify(workdir)}`,
		`export SNIPPET_HOME=${JSON.stringify(workdir)}`,
		// JSRT_BIN points at a prebuilt binary (with --skip install). It becomes a real command on
		// PATH via a symlink — never a function: `jsrt … &` must put the binary's own PID in $!, so a
		// later `kill` reaches the process itself, not a wrapper subshell that would orphan it.
		`if [ -n "\${JSRT_BIN:-}" ]; then mkdir -p ${JSON.stringify(join(ROOT, '.snippets', 'run', 'bin'))} && ln -sf "\$JSRT_BIN" ${JSON.stringify(join(ROOT, '.snippets', 'run', 'bin', 'jsrt'))} && export PATH=${JSON.stringify(join(ROOT, '.snippets', 'run', 'bin'))}:"\$PATH"; fi`,
	];
	steps.forEach((step, index) => {
		const out = join(dir, `${index}.out`);
		const marker = `echo "=== step ${index}: ${relative(ROOT, step.file)}" >&2`;
		if (step.kind === 'script') {
			// A script may read what the command before it printed, as $SNIPPET_LAST.
			const last = steps.slice(0, index).findLast((earlier) => earlier.kind === 'run' && !meta(earlier.info, 'file'));
			const lastOut = last ? join(dir, `${steps.indexOf(last)}.out`) : '/dev/null';
			lines.push(marker, `export SNIPPET_LAST=${JSON.stringify(lastOut)}`, `source ${JSON.stringify(join(ROOT, step.path))}${step.args ? ` ${step.args}` : ''}`);
			return;
		}
		const code = runnable(step.code);
		const file = meta(step.info, 'file');
		if (file) {
			lines.push(marker, `cat > ${JSON.stringify(file)} <<'DOCS_SNIPPET_EOF'`, code, 'DOCS_SNIPPET_EOF');
			return;
		}
		if (skip.has(meta(step.info, 'step') ?? '')) {
			lines.push(`echo "=== step ${index}: skipped (${meta(step.info, 'step')})" >&2`);
			return;
		}
		const source = join(dir, `${index}.sh`);
		writeFileSync(source, `${code}\n`);
		// `exit=N`: a command the page shows failing; it must end with that status. `stderr=1`: what
		// it prints on standard error is part of its output too (a refusal line, a report).
		const expected = meta(step.info, 'exit');
		const streams = meta(step.info, 'stderr') === '1' ? ' 2>&1' : '';
		if (expected === undefined) {
			lines.push(marker, `source ${JSON.stringify(source)} > ${JSON.stringify(out)}${streams}`);
		} else {
			lines.push(
				marker,
				'set +e',
				`source ${JSON.stringify(source)} > ${JSON.stringify(out)}${streams}`,
				'__status=$?',
				'set -e',
				`[[ $__status == ${Number(expected)} ]] || { echo "step ${index}: exit $__status, the page says ${Number(expected)}" >&2; cat ${JSON.stringify(out)} >&2; exit 1; }`,
			);
		}
	});
	const script = join(dir, 'suite.sh');
	writeFileSync(script, `${lines.join('\n')}\n`);
	const result = spawnSync('bash', [script], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
	if (result.status !== 0) {
		console.error(`snippets: the run stopped (exit ${result.status}); its script is ${relative(ROOT, script)}`);
		return false;
	}
	let ok = true;
	steps.forEach((step, index) => {
		if (step.kind !== 'run' || !step.expect) return;
		const outFile = join(dir, `${index}.out`);
		// A run that stopped early leaves no .out for the steps it never reached — count them as
		// differences (the run already failed) instead of crashing on the missing file.
		const actual = statSync(outFile, { throwIfNoEntry: false }) ? readFileSync(outFile, 'utf8') : '';
		step.actual = actual;
		if (!matches(actual, step.expect)) {
			ok = false;
			console.error(`\nsnippets: ${relative(ROOT, step.file)}: the output differs from the page for:\n${step.code}\n--- the page (normalised)\n${normalise(step.expect.code)}\n--- the run (normalised)\n${normalise(actual)}\n`);
		}
	});
	return ok;
}

function update(steps) {
	const byFile = new Map();
	for (const step of steps) {
		// Only blocks whose output really differs are rewritten, so ids and dates don't churn.
		if (step.kind === 'run' && step.expect && step.actual !== undefined && !matches(step.actual, step.expect)) {
			const list = byFile.get(step.file) ?? [];
			list.push(step);
			byFile.set(step.file, list);
		}
	}
	for (const [file, list] of byFile) {
		let text = readFileSync(file, 'utf8');
		for (const step of list.sort((a, b) => b.expect.start - a.expect.start)) {
			const { indent, info, lang, start, end } = step.expect;
			const body = display(step.actual)
				.split('\n')
				.map((line) => (line === '' ? '' : `${indent}${line}`))
				.join('\n');
			text = `${text.slice(0, start)}${indent}\`\`\`${lang}${info}\n${body}\n${indent}\`\`\`${text.slice(end)}`;
		}
		writeFileSync(file, text);
		console.log(`snippets: wrote ${list.length} output block(s) into ${relative(ROOT, file)}`);
	}
}

// ---------------------------------------------------------------- coverage

/** Every fenced block on every page, by what happens to it. */
export function coverage() {
	const pages = [];
	for (const file of mdxFiles(DOCS)) {
		const text = readFileSync(file, 'utf8');
		const page = { file: relative(DOCS, file), run: 0, output: 0, notRun: 0, todo: 0, unmarked: [] };
		for (const match of text.matchAll(FENCE)) {
			const info = match[4];
			if (meta(info, 'run')) page.run++;
			else if (meta(info, 'output')) page.output++;
			else if (meta(info, 'not-run')?.startsWith('todo:')) page.todo++;
			else if (meta(info, 'not-run')) page.notRun++;
			else page.unmarked.push(text.slice(0, match.index).split('\n').length);
		}
		if (page.run + page.output + page.notRun + page.todo + page.unmarked.length > 0) pages.push(page);
	}
	return pages;
}

function printCoverage() {
	const pages = coverage();
	const sum = (key) => pages.reduce((total, page) => total + (Array.isArray(page[key]) ? page[key].length : page[key]), 0);
	for (const page of pages) {
		console.log(`${page.file.padEnd(36)} run ${String(page.run).padStart(3)}  output ${String(page.output).padStart(3)}  not-run ${String(page.notRun).padStart(3)}  todo ${String(page.todo).padStart(3)}${page.unmarked.length ? `  UNMARKED at lines ${page.unmarked.join(', ')}` : ''}`);
	}
	const all = sum('run') + sum('output') + sum('notRun') + sum('todo') + sum('unmarked');
	console.log(`snippets coverage: ${all} blocks; ${sum('run')} run, ${sum('output')} outputs checked, ${sum('notRun')} can't run here (with a reason), ${sum('todo')} could run but aren't wired yet (not-run="todo: …"), ${sum('unmarked')} unmarked`);
	process.exit(sum('unmarked') > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

function main() {
	if (flag('coverage')) printCoverage();
	const steps = readSteps();
	const suites = SUITES.filter((name) => (only ? name === only : true)).map((name) => [name, steps.filter((step) => step.suite === name)]);
	if (flag('list')) {
		for (const [name, list] of suites) {
			console.log(`${name}: ${list.length} steps`);
			for (const step of list) console.log(`  ${step.kind.padEnd(6)} ${relative(ROOT, step.file)} ${step.kind === 'script' ? step.path : (step.code.split('\n')[0] ?? '').slice(0, 100)}${step.expect ? '  [checked]' : ''}`);
		}
		process.exit(0);
	}
	const ordered = suites.flatMap(([name, list]) => {
		if (list.length > 0) console.log(`snippets: suite ${name}, ${list.length} steps`);
		return list;
	});
	const failed = !runAll(ordered);
	if (flag('update')) update(steps);
	const checked = steps.filter((step) => step.expect && step.actual !== undefined).length;
	console.log(`snippets: ${checked} outputs checked${failed ? ', with differences' : ', all match'}`);
	process.exit(failed && !flag('update') ? 1 : 0);
}
