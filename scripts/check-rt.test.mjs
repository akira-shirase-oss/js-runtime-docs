// The drift check's own tests: the parsers must find each surface in the product's source style,
// and the comparison must fail in both directions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rtNames, cliSurface, manifestSurface, surfaceLists } from './check-rt.mjs';

const BOOTSTRAP = `
globalThis.rt = {
	/** Write to stdout with no added newline. */
	print: (msg) => corePrint(String(msg), false),
	/** {runtime, version, engine}. */
	hostInfo: () => ops.op_host_info(),
	kv: {
		/** The value, or null. */
		get: (key) => ops.op_kv_get(String(key)),
		/** Upsert. */
		put: (key, value) => ops.op_kv_put(String(key), String(value)),
	},
	serve: (opts, handler) => {
		const rid = ops.op_serve_listen(opts.host ?? "127.0.0.1", opts.port);
		return {
			done,
			close: () => {
				try { ops.op_serve_close(rid); } catch (e) {}
			},
		};
	},
};
`;

const MAIN_RS = `
#[derive(Args, Clone)]
struct RunArgs {
    /// The module file to execute.
    file: PathBuf,
    /// Wall-clock deadline.
    #[arg(long, default_value_t = 10_000)]
    timeout: u64,
    /// Capability manifest.
    #[arg(long)]
    manifest: Option<PathBuf>,
    /// Like --net but private.
    #[arg(long)]
    net_private: Vec<String>,
}
#[derive(Subcommand)]
enum Command {
    Run(RunArgs),
    Supervise {
        #[command(flatten)]
        run: RunArgs,
        /// RSS ceiling.
        #[arg(long)]
        max_rss_mb: Option<u64>,
        /// Mask a literal.
        #[arg(long = "redact-env")]
        redact_env: Vec<String>,
        /// Pass bytes raw.
        #[arg(long = "output-raw")]
        output_raw: bool,
    },
}
`;

const CAPABILITY = `
#[serde(deny_unknown_fields)]
struct Manifest {
    /// Read dirs.
    #[serde(default)]
    read: Vec<PathBuf>,
    /// Net entries.
    #[serde(default)]
    net: Vec<ManifestNet>,
    /// The serve grant.
    #[serde(default)]
    serve: Option<ManifestServe>,
}

#[serde(deny_unknown_fields)]
struct ManifestServe {
    host: String,
    port: u16,
    #[serde(default)]
    max_body: Option<u64>,
}
`;

test('rt.* names parse: members, namespaces, and serve stays a bare name', () => {
	const names = rtNames(BOOTSTRAP);
	assert.deepEqual(names, ['hostInfo', 'kv', 'kv.get', 'kv.put', 'print', 'serve']);
	assert.ok(!names.includes('close'), 'the returned handle is not an rt.* member');
	assert.ok(!names.includes('done'), 'server.done is the handle, not rt.done');
});

test('run flags and supervise-only flags parse separately', () => {
	const { run, supervise } = cliSurface(MAIN_RS);
	assert.deepEqual(run, ['--manifest', '--net-private', '--timeout']);
	assert.deepEqual(supervise, ['--max-rss-mb', '--output-raw', '--redact-env']);
	assert.ok(!run.includes('--file'), 'the positional entry is not a flag');
});

test('manifest structs parse with their deny-unknown keys', () => {
	const m = manifestSurface(CAPABILITY);
	assert.deepEqual(m.Manifest, ['net', 'read', 'serve']);
	assert.deepEqual(m.ManifestServe, ['host', 'max_body', 'port']);
});

test('the declared lists come back sorted for comparison', () => {
	const spec = surfaceLists({ rt: ['b', 'a'], cli: { run: ['--z', '--a'], supervise: [] }, manifest: { top: ['serve', 'net'], net: ['private', 'host'], kv: [], media: [], serve: [] } });
	assert.deepEqual(spec.rt, ['a', 'b']);
	assert.deepEqual(spec.run, ['--a', '--z']);
	assert.deepEqual(spec.net, ['host', 'private']);
});
