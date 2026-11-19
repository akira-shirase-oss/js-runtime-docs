#!/usr/bin/env node
// The drift check: jsrt has no HTTP API, so there is no OpenAPI document — the public contract is
// the rt.* namespace a script can call, the flags the CLI accepts and the keys a manifest may
// carry. src/data/surface.json declares all three, and this check compares it both ways against
// the product source:
//
//   - every name the product declares must be in surface.json;
//   - every name surface.json declares must exist in the product.
//
// It reads three files — crates/jsrt-host/js/bootstrap.js (the rt.* namespace), crates/jsrt/src/
// main.rs (the clap surface) and crates/jsrt-host/src/capability.rs (the manifest's serde
// structs) — from JSRT_DIR (a local checkout or the copy CI makes), else it fetches them from
// the product's default branch on GitHub.
//
//   node scripts/check-rt.mjs                       local tree via JSRT_DIR, else fetch
//   JSRT_DIR=../js-runtime node scripts/check-rt.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const SURFACE = join(ROOT, 'src/data/surface.json');
const PRODUCT = process.env.JSRT_DIR ?? join(ROOT, '.snippets/work/js-runtime');
const FILES = {
	bootstrap: 'crates/jsrt-host/js/bootstrap.js',
	cli: 'crates/jsrt/src/main.rs',
	capability: 'crates/jsrt-host/src/capability.rs',
};
const REMOTE = 'https://raw.githubusercontent.com/akira-shirase-oss/js-runtime/main/';

// ---------------------------------------------------------------- the product's surface

/** The body of `globalThis.rt = { ... }` in bootstrap.js, found by balanced braces. */
export function rtObject(source) {
	const at = source.indexOf('globalThis.rt = {');
	if (at === -1) return null;
	let depth = 0;
	for (let i = source.indexOf('{', at); i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', at), i);
	}
	return null;
}

/**
 * Every rt.* name: members are written one tab deep, methods of a nested namespace (kv, media)
 * two tabs. A depth-1 key whose value opens a bare object (`kv: {`) is a namespace; one whose
 * value is a function (`serve: (opts, handler) => {`) is not, so the function body's own keys
 * (server.done, server.close) never leak into the list.
 */
export function rtNames(source) {
	const object = rtObject(source);
	if (object === null) return [];
	const names = [];
	let ns = null;
	for (const line of object.split('\n')) {
		const one = line.match(/^\t(\w+):/);
		if (one) {
			names.push(one[1]);
			ns = /:\s*\{/.test(line) ? one[1] : null;
			continue;
		}
		const two = line.match(/^\t\t(\w+):/);
		if (two && ns !== null) names.push(`${ns}.${two[1]}`);
		if (/^\t\}/.test(line)) ns = null;
	}
	return names.sort();
}

/** The text of a `struct Name { ... }` or enum-variant block, found by balanced braces. */
export function blockBody(source, marker) {
	const at = source.indexOf(marker);
	if (at === -1) return null;
	const open = source.indexOf('{', at);
	if (open === -1) return null;
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}' && --depth === 0) return source.slice(open, i);
	}
	return null;
}

const FIELD = /^\s*(?:pub\s+)?(\w+):\s*[^,]+,/gm;
const KEBAB = (name) => `--${name.replace(/_/g, '-')}`;

/** Every `#[arg(long)]` field in a block, as --kebab-case (honouring `long = "name"`). */
export function argFlags(block) {
	if (block === null) return [];
	const flags = [];
	for (const match of block.matchAll(/#\[arg\(long(?:\s*=\s*"([^"]+)")?[^\]]*\)\]\s*(?:\/\/\/[^\n]*\n\s*)*(?:#\[[^\]]+\]\s*)*(\w+)\s*:/g)) {
		flags.push(match[1] ? `--${match[1]}` : KEBAB(match[2]));
	}
	return flags.sort();
}

/** The clap surface: RunArgs fields are run flags; the Supervise variant's are supervise-only. */
export function cliSurface(source) {
	const run = blockBody(source, 'struct RunArgs');
	const supervise = blockBody(source, 'Supervise {');
	return { run: argFlags(run), supervise: argFlags(supervise) };
}

/**
 * The manifest's serde structs, by name. Each `#[serde(deny_unknown_fields)]` struct's fields are
 * the keys that layer of the manifest may carry.
 */
export function manifestSurface(source) {
	const out = {};
	for (const match of source.matchAll(/#\[serde\(deny_unknown_fields\)\]\s*(?:\/\/[^\n]*\n\s*)*(?:#\[[^\]]+\]\s*)*(?:pub\s+)?struct\s+(\w+)[^{]*\{/g)) {
		const body = blockBody(source.slice(match.index), `struct ${match[1]}`);
		if (body === null) continue;
		out[match[1]] = [...body.matchAll(FIELD)].map((m) => m[1]).sort();
	}
	return out;
}

// ---------------------------------------------------------------- the docs' declaration

/** Every name surface.json declares, per surface. */
export function surfaceLists(spec) {
	return {
		rt: [...(spec.rt ?? [])].sort(),
		run: [...(spec.cli?.run ?? [])].sort(),
		supervise: [...(spec.cli?.supervise ?? [])].sort(),
		manifestTop: [...(spec.manifest?.top ?? [])].sort(),
		net: [...(spec.manifest?.net ?? [])].sort(),
		kv: [...(spec.manifest?.kv ?? [])].sort(),
		media: [...(spec.manifest?.media ?? [])].sort(),
		serve: [...(spec.manifest?.serve ?? [])].sort(),
	};
}

export async function main() {
	const sources = {};
	const missing = [];
	for (const [key, file] of Object.entries(FILES)) {
		const at = join(PRODUCT, file);
		if (existsSync(at)) sources[key] = readFileSync(at, 'utf8');
		else missing.push(key);
	}
	if (missing.length > 0) {
		for (const key of missing) {
			const response = await fetch(`${REMOTE}${FILES[key]}`);
			if (!response.ok) {
				console.error(`check-rt: could not read ${FILES[key]} locally or from GitHub (HTTP ${response.status})`);
				process.exit(1);
			}
			sources[key] = await response.text();
		}
		console.error(`check-rt: no local product tree at ${PRODUCT}; fetched ${missing.join(', ')} from GitHub`);
	}

	const spec = surfaceLists(JSON.parse(readFileSync(SURFACE, 'utf8')));
	const actual = {
		rt: rtNames(sources.bootstrap),
		...cliSurface(sources.cli),
		...(() => {
			const m = manifestSurface(sources.capability);
			return { manifestTop: m.Manifest ?? [], net: m.ManifestNetDetailed ?? [], kv: m.ManifestKv ?? [], media: m.ManifestMedia ?? [], serve: m.ManifestServe ?? [] };
		})(),
	};

	let bad = 0;
	const compare = (label, have, declared) => {
		for (const name of have) if (!declared.includes(name)) console.error(`check-rt: the product has ${label} "${name}" that surface.json lacks`);
		for (const name of declared) if (!have.includes(name)) console.error(`check-rt: surface.json declares ${label} "${name}" the product doesn't have`);
		bad += Math.abs(have.length - declared.length) + have.filter((n) => !declared.includes(n)).length;
	};
	compare('rt.* member', actual.rt, spec.rt);
	compare('a `jsrt run` flag', actual.run, spec.run);
	compare('a supervise-only flag', actual.supervise, spec.supervise);
	compare('a top-level manifest key', actual.manifestTop, spec.manifestTop);
	compare('a net object key', actual.net, spec.net);
	compare('a kv key', actual.kv, spec.kv);
	compare('a media key', actual.media, spec.media);
	compare('a serve key', actual.serve, spec.serve);

	if (bad === 0) console.log(`check-rt: surface.json and the product agree (${actual.rt.length} rt.* names, ${actual.run.length + actual.supervise.length} flags, ${actual.manifestTop.length} manifest sections)`);
	process.exit(bad ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
