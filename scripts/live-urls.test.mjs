// The URL check's rules, proven: what may appear on a public page, and what is allowed only on the
// pages that run on this machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problems } from './check-urls.mjs';
import { runnable, EXAMPLE_BASE } from './snippets.mjs';

test('the example domain and the docs domain are fine anywhere', () => {
	assert.deepEqual(problems(`rt.fetch(${EXAMPLE_BASE}/hooks) and https://docs.jsrt.404human.dev/quick-start/`, 'src/content/docs/concepts.mdx'), []);
});

test('a this-machine URL is fine on the local pages, forbidden elsewhere', () => {
	const local = 'curl http://127.0.0.1:47421/health';
	assert.deepEqual(problems(local, 'src/content/docs/quick-start.mdx'), []);
	assert.deepEqual(problems(local, 'src/content/docs/guides/fetch.mdx'), []);
	assert.deepEqual(problems(local, 'src/content/docs/self-hosting/supervise.mdx'), []);
	assert.equal(problems(local, 'src/content/docs/concepts.mdx').length, 1);
});

test('a private IPv4 address leaks nowhere', () => {
	for (const url of ['http://10.0.0.4:47421/health', 'http://192.168.1.20/hooks', 'https://172.16.0.9:47421'])
		assert.equal(problems(`see ${url}`, 'src/content/docs/concepts.mdx').length, 1, url);
	// Documentation subnets stay allowed.
	assert.deepEqual(problems('the route 203.0.113.10 is an example', 'src/content/docs/concepts.mdx'), []);
});

test('a credential in a URL is caught', () => {
	assert.equal(problems(`GET ${EXAMPLE_BASE}/hooks?key=abc123`, 'src/content/docs/concepts.mdx').length, 1);
	assert.equal(problems(`https://app.example.com/?token=xyz`, 'src/content/docs/quick-start.mdx').length, 1);
});

test('0.0.0.0 is never an address to visit', () => {
	assert.equal(problems('curl http://0.0.0.0:47421/health', 'src/content/docs/quick-start.mdx').length, 1);
});

test('plain http off the local pages is flagged, even the example domain', () => {
	assert.equal(problems('see http://internal.example.org/hooks', 'src/content/docs/concepts.mdx').length, 1);
	assert.equal(problems('rt.fetch("http://app.example.com/x")', 'src/content/docs/concepts.mdx').length, 1);
});

test('runnable() keeps the example domain literal — it is only ever refused', () => {
	assert.equal(runnable(`rt.fetch("${EXAMPLE_BASE}/hello")`), `rt.fetch("https://app.example.com/hello")`);
});
