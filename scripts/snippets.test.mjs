// The snippets engine's own tests — the same cases that guard the runner's promise: ports, ids,
// times and hashes normalise away, and a real difference still fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, matches, runnable, coverage, fences, EXAMPLE_BASE, SHOWN_PORT_BASE } from './snippets.mjs';

test('the example host runs literally — it is only ever a refused destination', () => {
	assert.equal(runnable('curl -i $BASE/health'), 'curl -i $BASE/health');
	const code = runnable(`jsrt run client.js   # fetches ${EXAMPLE_BASE}/hello`);
	assert.match(code, /app\.example\.com\/hello/, 'the refused fetch keeps its example name');
	assert.doesNotMatch(code, /127\.0\.0\.1/, 'it is never pointed at a demo listener');
});

test('shown ports map to the band under test', () => {
	// With the default base the listener stays 47421.
	const code = runnable('jsrt run server.js --manifest m.json   # 127.0.0.1:47421');
	assert.match(code, /127\.0\.0\.1:47421/);
	const banded = runnable('jsrt run server.js   # serve on 127.0.0.1:47421 and kv at 47422', 47430);
	assert.match(banded, /127\.0\.0\.1:47430/);
	assert.doesNotMatch(banded, /47421/);
	// The bare forms a manifest or a flag takes: "port": 47421 becomes the mapped port.
	const manifest = runnable('{ "serve": { "host": "127.0.0.1", "port": 47422 } }', 47430);
	assert.equal(manifest, '{ "serve": { "host": "127.0.0.1", "port": 47431 } }');
});

test('a run id, a pid and durations normalise', () => {
	const a = normalise('{"run_id":"1774800000123x441","worker_pid":441,"wall_ms":812,"cpu_ms":402,"peak_rss_bytes":21950464}');
	const b = normalise('{"run_id":"1774899999999x802","worker_pid":802,"wall_ms":9,"cpu_ms":11,"peak_rss_bytes":31457280}');
	assert.equal(a, b);
});

test('a media digest normalises, a real difference does not hide', () => {
	assert.equal(
		normalise('name: 9f2c1a4b7e8d0a3b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b'),
		'name: <hex64>',
	);
	assert.notEqual(normalise('{"ok":true}'), normalise('{"ok":false}'), 'a real difference still fails');
});

test('JSON bodies compare by value, not by formatting', () => {
	assert.equal(normalise('{"a":{"x":[2,3]},"b":1}'), normalise('{\n  "a": {\n    "x": [2, 3]\n  },\n  "b": 1\n}'));
	assert.notEqual(normalise('{"v":45}'), normalise('{"v":46}'));
});

test('millisecond values in prose output normalise', () => {
	assert.equal(normalise('fetched 24 bytes in 12ms'), normalise('fetched 24 bytes in 847ms'));
});

test('curl -i heads compare with dates stripped', () => {
	const one = normalise('HTTP/1.1 200 OK\ndate: Mon, 17 Nov 2026 10:00:00 GMT\ncontent-length: 12\n\n{"ok":true}');
	const two = normalise('HTTP/1.1 200 OK\ndate: Tue, 18 Nov 2026 10:00:01 GMT\ncontent-length: 99\n\n{"ok":true}');
	assert.equal(one, two);
});

test('match=lines accepts a stream whose order differs', () => {
	const expect = { code: 'worker 1 running\nworker 2 running', info: 'match=lines' };
	assert.ok(matches('worker 2 running\nworker 1 running\nworker 3 running', expect), 'shown lines all arrived, in any order');
	assert.ok(!matches('worker 1 running', expect), 'a shown line that never arrived still fails');
});

test('coverage counts every block kind and flags the unmarked', () => {
	const page = `\`\`\`sh run=quickstart\ncurl example\n\`\`\`\n\`\`\`json output=quickstart\n{}\n\`\`\`\n\`\`\`text not-run="a systemd unit"\n[Unit]\n\`\`\`\n\`\`\`python\nprint("oops")\n\`\`\``;
	// The unit test can't inject a page; instead prove the fence reader sees all four blocks and
	// their kinds via the exported fence iterator used by coverage().
	const kinds = fences(page).map((m) => (m[4].includes('not-run') ? 'not-run' : m[4].match(/(?:^|\s)run=/) ? 'run' : m[4].includes('output=') ? 'output' : 'unmarked'));
	assert.deepEqual(kinds, ['run', 'output', 'not-run', 'unmarked']);
});

test('a code fence inside indented markdown is still a block, not prose', () => {
	const page = `1. Step\n\n   \`\`\`sh run=quickstart\n   jsrt run hello.js\n   \`\`\``;
	assert.equal(fences(page).length, 1);
});

test('the shown band constant is what the pages are written against', () => {
	assert.equal(SHOWN_PORT_BASE, 47421);
});
