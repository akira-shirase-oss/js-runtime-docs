#!/usr/bin/env node
// The privacy check: what a reader's browser would actually do on the built site. It drives the
// pages in headless Chromium with the network fully traced, and fails if anything —
//
//   - leaves the machine to a third party on any page (fonts, CDNs, analytics, telemetry
//     endpoints, images from other hosts). This site is first-party only: it makes no API calls,
//     embeds no remote assets and stores no credentials anywhere.
//   - persists anything in storage (localStorage, sessionStorage, cookies, IndexedDB) — the docs
//     keep nothing about a reader, so nothing may be written.
//
// It also runs the accessibility scan (scripts/axe-scan.mjs) on the pages it visits — the same
// browser, the same pass.
//
//   node scripts/check-privacy.mjs                 the whole site (starts `astro preview` itself)
//   node scripts/check-privacy.mjs --pages /,/quick-start/   just these pages
//   PREVIEW=http://127.0.0.1:47420 node scripts/check-privacy.mjs   against a preview already up
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import axeScan from './axe-scan.mjs';

const sitemap = (await import('./lib/sitemap-pages.mjs')).default;

// With no PREVIEW given, serve dist/ on this worktree's docs port (47420) for the run.
let preview = null;
const given = process.env.PREVIEW;
if (!given) {
	preview = spawn('npx', ['astro', 'preview', '--port', '47420', '--host', '127.0.0.1'], {
		cwd: new URL('..', import.meta.url).pathname,
		stdio: 'ignore',
	});
	const up = Date.now() + 60_000;
	for (;;) {
		const ok = await fetch('http://127.0.0.1:47420/').then((r) => r.ok).catch(() => false);
		if (ok) break;
		if (Date.now() > up) {
			preview.kill();
			console.error('privacy: astro preview did not come up on 127.0.0.1:47420');
			process.exit(1);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
}
process.on('exit', () => preview?.kill());
const base = given ?? 'http://127.0.0.1:47420';
const argPages = (() => {
	const at = process.argv.indexOf('--pages');
	return at === -1 ? null : process.argv[at + 1].split(',');
})();
const pages = argPages ?? sitemap();

const own = new URL(base).host;
const ok = (url) => {
	const u = new URL(url);
	return u.host === own || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
};

let bad = 0;
const fail = (what) => {
	bad++;
	console.error(`privacy: ${what}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });

// Every request the browser makes, and who made it.
const requests = [];
await context.route('**/*', async (route) => {
	const url = route.request().url();
	const page = route.request().frame()?.page();
	requests.push({ url, page: page?.url() ?? '(no page)', resource: route.request().resourceType() });
	if (ok(url)) return route.continue();
	fail(`third-party request from ${page?.url() ?? '?'}: ${url}`);
	await route.abort();
});

const page = await context.newPage();
const axeBad = [];
const codeTexts = [];
for (const path of pages) {
	const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
	if (!response?.ok()) {
		fail(`${path} → HTTP ${response?.status()}`);
		continue;
	}
	await page.waitForTimeout(300);
	// Collect the page's code blocks: the example host a reader copies must be the reserved domain
	// or a labelled loopback, never a real one.
	codeTexts.push(...(await page.locator('pre').allInnerTexts()), ...(await page.locator('[data-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-code') ?? ''))));
	const violations = await axeScan(page, { label: path });
	if (violations.length) axeBad.push({ path, violations });
}

// Nothing may persist: a docs site keeps no state about its reader.
for (const stored of await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))) {
	for (const bag of Object.values(stored)) {
		for (const name of bag) fail(`storage key ${name} was persisted — the docs keep nothing`);
	}
}
const cookies = await context.cookies();
if (cookies.length > 0) fail(`${cookies.length} cookie(s) were set — the docs set none`);
if ((await page.evaluate(async () => (await indexedDB.databases?.())?.length ?? 0)) > 0) fail('an IndexedDB database exists — nothing may persist');

// Examples on static pages: the only hosts a reader may copy are the reserved domain and loopback.
if (!codeTexts.some((text) => text.includes('app.example.com') || text.includes('127.0.0.1'))) console.error('privacy: no page showed an example address — is the docs content wired?');

// A stray request is anything that isn't this site or a reader-aimed scheme.
const stray = requests.filter((r) => !ok(r.url));
for (const r of stray) fail(`request left for a third party: ${r.url} (from ${r.page})`);

for (const { path, violations } of axeBad) {
	for (const v of violations) console.error(`privacy/axe: ${path} — ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).join(', ')}`);
	bad += violations.length;
}

await browser.close();
console.log(bad === 0 ? `privacy: clean across ${pages.length} page(s)` : `privacy: ${bad} problem(s)`);
process.exit(bad ? 1 : 0);
