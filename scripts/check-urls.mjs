#!/usr/bin/env node
// Finds every URL a reader could copy from a page — in code blocks and in prose — and fails on
// ones that would mislead:
//
//   - http://localhost or http://127.0.0.1 outside the pages that run on this machine
//     (ALLOWED below; everywhere else examples use https://app.example.com)
//   - 0.0.0.0 anywhere (a listen address, not one to visit)
//   - internal paths, credentials or tokens
//   - private IPv4 subnets (10/8, 172.16/12, 192.168/16) — they would leak the author's network.
//     Documentation subnets 198.51.100.0/24, 203.0.113.0/24 (TEST-NET-2/3) and 127/8 stay allowed.
//   - a URL whose scheme isn't https (or http on the local pages)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DOCS = join(ROOT, 'src/content/docs');
const PAGES = join(ROOT, 'src/pages');

// Pages that run on this machine may show its own addresses (the quick start's listener, a
// manifest's serve grant, a loopback fetch in a guide). Everywhere else is https://app.example.com.
export const ALLOWED = [
	/^src\/content\/docs\/quick-start\.mdx$/, // the quick start builds and runs jsrt on 127.0.0.1
	/^src\/content\/docs\/guides\//, // every guide runs the CLI and its demo listener locally
	/^src\/content\/docs\/self-hosting\//, // listen addresses, local health checks, supervise demos
	/^src\/content\/docs\/reference\/cli\.mdx$/, // exit-code demos run jsrt on this machine
	/^src\/content\/docs\/reference\/manifest\.mdx$/, // a serve grant is always a loopback literal
	/^src\/content\/docs\/reference\/errors\.mdx$/, // a real refusal line contains the loopback address it named
];
const LOCAL = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/;
const PRIVATE_V4 = /^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
const URL_IN_TEXT = /https?:\/\/[^\s"'`)\]},;>]+/g;

export function problems(text, file) {
	const bad = [];
	const local = ALLOWED.some((ok) => ok.test(file));
	for (const match of text.matchAll(URL_IN_TEXT)) {
		const url = match[0].replace(/[.,;:]+$/, '');
		if (LOCAL.test(url) && !local) bad.push(`${url} is a this-machine address on a page that isn't local`);
		else if (PRIVATE_V4.test(url)) bad.push(`${url} is a private IPv4 address — use a documentation subnet or an example name`);
		else if (/^https?:\/\/0\.0\.0\.0/.test(url)) bad.push(`${url}: 0.0.0.0 listens everywhere; it isn't an address to visit`);
		else if (/[?&](token|key|secret|sig|password)=[A-Za-z0-9]/i.test(url)) bad.push(`${url} looks like it carries a credential`);
		else if (/^http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[?::1)/.test(url)) bad.push(`${url} is plain http — use https (or a loopback address on a local page)`);
	}
	return bad;
}

export function scan(dir) {
	const bad = [];
	const walk = (at) => {
		for (const name of readdirSync(at)) {
			const path = join(at, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(mdx?|astro)$/.test(name)) {
				const file = relative(ROOT, path);
				for (const problem of problems(readFileSync(path, 'utf8'), file)) bad.push(`${file}: ${problem}`);
			}
		}
	};
	walk(dir);
	return bad;
}

export function main(dir = join(ROOT, 'src')) {
	const bad = scan(dir);
	for (const problem of bad) console.error(`check-urls: ${problem}`);
	console.log(`check-urls: ${bad.length === 0 ? 'all URLs are example or labelled-local' : `${bad.length} bad URL(s)`}`);
	process.exit(bad.length ? 1 : 0);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
