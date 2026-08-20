const assert = require('node:assert/strict');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ClusterSecret = require('../lib/cluster-secret');

let suiteRoot;
let suiteBefore = function() {};
let suiteAfter = function() {};
const tests = [];

function before(callback) { suiteBefore = callback; }
function after(callback) { suiteAfter = callback; }
function test(name, callback) {
	const wrapped = function(testHandle) {
		Promise.resolve().then(callback).then(function() {
			testHandle.done();
		}).catch(function(err) {
			testHandle.ok(false, name + ': ' + (err && err.stack || err));
			testHandle.done();
		});
	};
	Object.defineProperty(wrapped, 'name', {
		value: name.replace(/[^A-Za-z0-9]+/g, '_'),
		configurable: true
	});
	tests.push(wrapped);
}

function hash(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function writeConfig(filename, secret, extra) {
	const config = Object.assign({
		debug: false,
		foreground: true,
		echo: false,
		hostname: 'cluster-secret-probe',
		ip: '127.0.0.1',
		log_dir: path.join(path.dirname(filename), 'logs'),
		log_filename: 'probe.log',
		secret_key: secret
	}, extra || {});
	fs.writeFileSync(filename, JSON.stringify(config, null, 2));
}

function makeRoot(secret) {
	const root = fs.mkdtempSync(path.join(suiteRoot, 'case-'));
	fs.mkdirSync(path.join(root, 'conf'));
	writeConfig(path.join(root, 'conf/config.json'), secret);
	return root;
}

function cleanEnvironment(overrides) {
	const env = Object.assign({}, process.env);
	Object.keys(env).forEach(function(key) {
		if (key.startsWith('CRONICLE_') || key.startsWith('CLUSTER_SECRET_PROBE_')) delete env[key];
	});
	delete env.NODE_OPTIONS;
	return Object.assign(env, overrides || {});
}

function runProbe(root, options) {
	options = options || {};
	return childProcess.spawnSync(process.execPath, [
		path.join(__dirname, 'fixtures/cluster-secret-probe.js')
	].concat(options.args || []), {
		cwd: root,
		env: cleanEnvironment(Object.assign({ CLUSTER_SECRET_PROBE_ROOT: root }, options.env || {})),
		encoding: 'utf8',
		timeout: 15000
	});
}

function probeOutput(result) {
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const lines = result.stdout.trim().split(/\r?\n/);
	return JSON.parse(lines[lines.length - 1]);
}

before(function() {
	suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-cluster-secret-'));
});

after(function() {
	fs.rmSync(suiteRoot, { recursive: true, force: true });
});

test('accepts every supported explicit secret source after PixlServer precedence', function() {
	const cases = [
		{
			name: 'default JSON',
			secret: 'json-secret',
			prepare: function() {}
		},
		{
			name: 'CRONICLE_config_file JSON',
			secret: 'custom-json-secret',
			prepare: function(root, item) {
				item.custom = path.join(root, 'custom.json');
				writeConfig(item.custom, item.secret);
				item.env = { CRONICLE_config_file: item.custom };
			}
		},
		{
			name: 'environment',
			secret: 'environment-secret',
			prepare: function(root, item) { item.env = { CRONICLE_secret_key: item.secret }; }
		},
		{
			name: 'numeric-looking environment string',
			secret: '123456',
			prepare: function(root, item) { item.env = { CRONICLE_secret_key: item.secret }; }
		},
		{
			name: 'default secret file',
			secret: 'default-file-secret',
			prepare: function(root, item) { fs.writeFileSync(path.join(root, 'conf/secret_key'), item.secret + '\n'); }
		},
		{
			name: 'explicit secret file',
			secret: 'explicit-file-secret',
			prepare: function(root, item) {
				item.file = path.join(root, 'mounted-secret');
				fs.writeFileSync(item.file, item.secret + '\n');
				item.env = { CRONICLE_secret_key_file: item.file };
			}
		},
		{
			name: 'numeric-looking secret file string',
			secret: '654321',
			prepare: function(root, item) {
				item.file = path.join(root, 'numeric-secret');
				fs.writeFileSync(item.file, item.secret + '\n');
				item.env = { CRONICLE_secret_key_file: item.file };
			}
		},
		{
			name: 'CLI secret_key',
			secret: 'cli-secret',
			prepare: function(root, item) {
				writeConfig(path.join(root, 'conf/config.json'), 'json-secret', { debug_level: 5 });
				item.args = ['--secret_key', item.secret];
				item.env = { CLUSTER_SECRET_PROBE_DAEMON_LOG: '1' };
			}
		},
		{
			name: 'CLI configFile',
			secret: 'cli-config-file-secret',
			prepare: function(root, item) {
				item.custom = path.join(root, 'cli-config.json');
				writeConfig(item.custom, item.secret);
				item.args = ['--configFile', item.custom];
			}
		},
		{
			name: 'config overrides file',
			secret: 'config-override-secret',
			prepare: function(root, item) {
				item.overrides = path.join(root, 'overrides.json');
				fs.writeFileSync(item.overrides, JSON.stringify({ secret_key: item.secret }));
				writeConfig(path.join(root, 'conf/config.json'), 'json-secret', { config_overrides_file: item.overrides });
				item.env = { CRONICLE_secret_key: 'autogenerated' };
			}
		},
		{
			name: 'config overrides empty default secret file',
			secret: 'config-override-over-empty-file',
			prepare: function(root, item) {
				item.overrides = path.join(root, 'empty-file-overrides.json');
				fs.writeFileSync(item.overrides, JSON.stringify({ secret_key: item.secret }));
				fs.writeFileSync(path.join(root, 'conf/secret_key'), ' \n');
				writeConfig(path.join(root, 'conf/config.json'), 'json-secret', { config_overrides_file: item.overrides });
			}
		}
	];

	cases.forEach(function(item) {
		const root = makeRoot('json-secret');
		item.prepare(root, item);
		const output = probeOutput(runProbe(root, { env: item.env, args: item.args }));
		assert.equal(output.initial, hash(item.secret), item.name);
		assert.equal(output.logContainsInitial, false, item.name + ' must not log the secret');
	});
});

test('fails closed for missing, empty, placeholder, whitespace, and non-string secrets', function() {
	const missingRoot = makeRoot('valid-json-secret');
	let result = runProbe(missingRoot, {
		env: { CRONICLE_secret_key_file: path.join(missingRoot, 'does-not-exist') }
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Configured cluster secret file does not exist/);

	const emptyRoot = makeRoot('valid-json-secret');
	const emptyFile = path.join(emptyRoot, 'empty-secret');
	fs.writeFileSync(emptyFile, ' \n');
	result = runProbe(emptyRoot, { env: { CRONICLE_secret_key_file: emptyFile } });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /CRONICLE_SECRET_KEY_INVALID/);

	const emptyEnvRoot = makeRoot('valid-json-secret');
	fs.writeFileSync(path.join(emptyEnvRoot, 'conf/secret_key'), 'file-must-not-mask-explicit-empty-env\n');
	result = runProbe(emptyEnvRoot, { env: { CRONICLE_secret_key: '' } });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /CRONICLE_SECRET_KEY_INVALID/);

	for (const invalid of ['autogenerated', '  autogenerated  ', '', '   ', 123456]) {
		const root = makeRoot(invalid);
		result = runProbe(root);
		assert.notEqual(result.status, 0, String(invalid));
		assert.match(result.stderr, /CRONICLE_SECRET_KEY_INVALID/);
		assert.equal(result.stderr.includes('123456'), false);
	}

	const numericOverrideRoot = makeRoot('valid-json-secret');
	const numericOverrides = path.join(numericOverrideRoot, 'numeric-overrides.json');
	fs.writeFileSync(numericOverrides, JSON.stringify({ secret_key: 123456 }));
	writeConfig(path.join(numericOverrideRoot, 'conf/config.json'), 'valid-json-secret', {
		config_overrides_file: numericOverrides
	});
	result = runProbe(numericOverrideRoot, { env: { CRONICLE_secret_key: '123456' } });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /CRONICLE_SECRET_KEY_INVALID/);
});

test('keeps the resolved key stable after env scrub and config reload', function() {
	const root = makeRoot('json-fallback-secret');
	writeConfig(path.join(root, 'conf/config.json'), 'json-fallback-secret', { debug_level: 10 });
	const output = probeOutput(runProbe(root, {
		env: {
			CRONICLE_secret_key: 'runtime-secret-that-must-stay-active',
			CLUSTER_SECRET_PROBE_RELOAD: '1'
		}
	}));
	assert.equal(output.initial, hash('runtime-secret-that-must-stay-active'));
	assert.equal(output.reloaded, output.initial);
	assert.equal(output.logContainsInitial, false);
	assert.equal(output.logContainsReplacement, false);

	const overrideRoot = makeRoot('json-fallback-secret');
	const overrideFile = path.join(overrideRoot, 'reload-overrides.json');
	fs.writeFileSync(overrideFile, JSON.stringify({ secret_key: 'initial-override-secret' }));
	writeConfig(path.join(overrideRoot, 'conf/config.json'), 'json-fallback-secret', {
		debug_level: 10,
		config_overrides_file: overrideFile
	});
	const overrideOutput = probeOutput(runProbe(overrideRoot, {
		env: {
			CLUSTER_SECRET_PROBE_RELOAD: '1',
			CLUSTER_SECRET_PROBE_RELOAD_OVERRIDE: overrideFile
		}
	}));
	assert.equal(overrideOutput.initial, hash('initial-override-secret'));
	assert.equal(overrideOutput.reloaded, overrideOutput.initial);
	assert.equal(overrideOutput.logContainsInitial, false);
	assert.equal(overrideOutput.logContainsReplacement, false);
});

test('loads protected files before PixlServer without exposing their value', function() {
	const env = { CRONICLE_secret_key_file: '/run/secrets/cluster-key' };
	const fakeFs = {
		readFileSync: function(filename, encoding) {
			assert.equal(filename, '/run/secrets/cluster-key');
			assert.equal(encoding, 'utf8');
			return 'mounted-secret\n';
		}
	};
	ClusterSecret.loadSecretFile(env, env.CRONICLE_secret_key_file, fakeFs);
	assert.equal(env.CRONICLE_secret_key, 'mounted-secret');
});

test('distributable bundle scripts do not create a cluster secret', function() {
	const unixBundle = fs.readFileSync(path.join(__dirname, '../bundle'), 'utf8');
	const windowsBundle = fs.readFileSync(path.join(__dirname, '../bundle.ps1'), 'utf8');
	const legacyInstallerSetup = JSON.parse(fs.readFileSync(path.join(__dirname, '../sample_conf/setup.json'), 'utf8'));

	assert.doesNotMatch(unixBundle, />\s*\$dist\/conf\/secret_key/);
	assert.doesNotMatch(windowsBundle, />\s*\$Path\/conf\/secret_key/i);
	assert.equal(
		legacyInstallerSetup.build.dist.some(function(step) { return step.action === 'generateSecretKey'; }),
		true,
		'legacy target-side installer generation must remain intact'
	);
});

module.exports = {
	setUp: function(callback) {
		Promise.resolve().then(suiteBefore).then(function() { callback(); }, callback);
	},
	tests: tests,
	tearDown: function(callback) {
		Promise.resolve().then(suiteAfter).then(function() { callback(); }, callback);
	}
};
