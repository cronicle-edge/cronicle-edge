const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');

const { Server, utils } = require('ssh2');
const {
	buildConnectionOptions,
	createHostVerifier,
	formatOpenSshFingerprint,
	normalizeFingerprint,
	parseFingerprintList,
	resolveSshTarget
} = require('../lib/ssh-host-policy');

const root = path.dirname(__dirname);
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

function expectPolicyError(code, callback) {
	assert.throws(callback, (err) => err && err.code === code);
}

function jsonMessages(output) {
	return String(output || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
}

function bootstrapExports(input) {
	const values = {};
	const pattern = /^export ([A-Za-z_][A-Za-z0-9_]*)=\$\(printf "([A-Za-z0-9+/=]*)" \| base64 -di\)$/gm;
	let match;
	while ((match = pattern.exec(String(input || '')))) {
		values[match[1]] = Buffer.from(match[2], 'base64').toString();
	}
	return values;
}

function runPlugin(scriptName, extraEnv, job) {
	return new Promise((resolve, reject) => {
		const env = Object.assign({
			PATH: process.env.PATH,
			JOB_ID: 'ssh-policy-' + Date.now(),
			JOB_DEBUG: '0',
			JSON: '1',
			SCRIPT: 'echo plugin-script',
			BASE_URL: 'http://127.0.0.1/'
		}, extraEnv || {});
		const child = childProcess.spawn(process.execPath, [path.join(root, 'bin', scriptName)], {
			cwd: root,
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`${scriptName} did not exit`));
		}, 8000);
		child.stdout.on('data', (data) => { stdout += data; });
		child.stderr.on('data', (data) => { stderr += data; });
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr, messages: jsonMessages(stdout) });
		});
		if (scriptName === 'sshx-plugin.js') {
			child.stdin.end(JSON.stringify(job || { params: { annotate: 0 }, chain_data: {} }));
		}
		else child.stdin.end();
	});
}

let sshServer;
let serverPort;
let serverFingerprint;
let executions = [];

before(async function() {
	const keys = utils.generateKeyPairSync('ed25519');
	const parsedKey = utils.parseKey(keys.private);
	serverFingerprint = formatOpenSshFingerprint(parsedKey.getPublicSSH());
	sshServer = new Server({ hostKeys: [keys.private] }, (client) => {
		client.on('error', function() {});
		client.on('authentication', (ctx) => {
			if ((ctx.method === 'password') && (ctx.password === 'test')) ctx.accept();
			else if (ctx.method === 'none') ctx.accept();
			else ctx.reject(['none', 'password']);
		});
		client.on('ready', () => {
			client.on('session', (accept) => {
				const session = accept();
				session.on('pty', (acceptPty) => acceptPty && acceptPty());
				session.on('env', (acceptEnv) => acceptEnv && acceptEnv());
				session.on('exec', (acceptExec, rejectExec, info) => {
					const stream = acceptExec();
					let input = '';
					stream.on('data', (data) => { input += data; });
					stream.on('end', () => {
						executions.push({ command: info.command, input });
						stream.exit(0);
						stream.end();
					});
				});
			});
		});
	});
	await new Promise((resolve, reject) => {
		sshServer.once('error', reject);
		sshServer.listen(0, '127.0.0.1', function() {
			serverPort = sshServer.address().port;
			resolve();
		});
	});
});

after(async function() {
	if (!sshServer) return;
	await new Promise((resolve) => sshServer.close(resolve));
});

test('OpenSSH SHA256 fingerprints accept padded, unpadded, and rotation lists', () => {
	const keyOne = Buffer.from('server-key-one');
	const keyTwo = Buffer.from('server-key-two');
	const pinOne = formatOpenSshFingerprint(keyOne);
	const pinTwo = formatOpenSshFingerprint(keyTwo);
	const paddedPinOne = pinOne + '=';
	assert.equal(normalizeFingerprint(pinOne).length, 32);
	assert.deepEqual(normalizeFingerprint(pinOne), normalizeFingerprint(paddedPinOne));
	const pins = parseFingerprintList(`${pinOne},\n${pinTwo}`);
	assert.equal(pins.length, 2);
	const verifier = createHostVerifier(pins);
	assert.equal(verifier(keyOne), true);
	assert.equal(verifier(keyTwo), true);
	assert.equal(verifier(Buffer.from('other-key')), false);
	expectPolicyError('SSH_HOST_FINGERPRINT_INVALID', () => normalizeFingerprint('SHA256:not-base64'));
});

test('Configured SSH_HOST wins and only configured localhost selects legacy local mode', () => {
	const configured = resolveSshTarget({
		SSH_HOST: 'OPERATOR_HOST',
		OPERATOR_HOST: 'ssh://operator@example.test:2222',
		JOB_ARG: 'localhost'
	}, { allowConfiguredLocal: true });
	assert.equal(configured.mode, 'remote');
	assert.equal(configured.source, 'configured');
	assert.equal(configured.uri.hostname, 'example.test');
	assert.equal(configured.uri.port, '2222');

	const local = resolveSshTarget({ SSH_HOST: 'LOCAL_TARGET', LOCAL_TARGET: 'localhost', JOB_ARG: 'attacker.test' }, { allowConfiguredLocal: true });
	assert.equal(local.mode, 'local');
	assert.equal(local.source, 'configured');

	const sshxLocalhost = resolveSshTarget({ SSH_HOST: 'localhost' }, { allowConfiguredLocal: false });
	assert.equal(sshxLocalhost.mode, 'remote');
	assert.equal(sshxLocalhost.uri.hostname, 'localhost');

	expectPolicyError('SSH_LOCAL_FROM_JOB_ARG', () => resolveSshTarget({ JOB_ARG: 'LOCAL_TARGET', LOCAL_TARGET: 'localhost' }, { allowConfiguredLocal: true }));
	expectPolicyError('SSH_HOST_REQUIRED', () => resolveSshTarget({ JOB_ARG: 'EMPTY_TARGET', EMPTY_TARGET: '' }, { allowConfiguredLocal: true }));
	expectPolicyError('SSH_HOST_REQUIRED', () => resolveSshTarget({}, { allowConfiguredLocal: true }));
});

test('Pins are enforced when configured and strict mode fails closed without a pin', () => {
	const pinOne = formatOpenSshFingerprint(Buffer.from('rotation-one'));
	const pinTwo = formatOpenSshFingerprint(Buffer.from('rotation-two'));
	const compatibility = resolveSshTarget({ SSH_HOST: 'worker.example' }, {});
	assert.equal(compatibility.verification, 'compatibility');
	assert.match(compatibility.warning, /disabled for compatibility/);

	const pinned = resolveSshTarget({ SSH_HOST: 'worker.example', SSH_HOST_FINGERPRINT: pinOne }, {});
	assert.equal(pinned.verification, 'pinned');
	assert.equal(pinned.pinCount, 1);
	expectPolicyError('SSH_HOST_FINGERPRINT_REQUIRED', () => resolveSshTarget({ SSH_HOST: 'worker.example', SSH_HOST_KEY_STRICT: '1' }, {}));

	const mapped = resolveSshTarget({
		SSH_HOST: 'ssh://worker.example:2222',
		SSH_HOST_KEY_STRICT: '1',
		SSH_HOST_FINGERPRINT_MAP: JSON.stringify({ 'worker.example:2222': [pinOne, pinTwo] })
	}, {});
	assert.equal(mapped.pinCount, 2);
	assert.equal(mapped.hostVerifier(Buffer.from('rotation-one')), true);
	assert.equal(mapped.hostVerifier(Buffer.from('rotation-two')), true);

	expectPolicyError('SSH_HOST_FINGERPRINT_REQUIRED', () => resolveSshTarget({
		SSH_HOST: 'unlisted.example',
		SSH_HOST_FINGERPRINT_MAP: JSON.stringify({ 'worker.example': pinOne })
	}, {}));
	expectPolicyError('SSH_HOST_FINGERPRINT_MAP_INVALID', () => resolveSshTarget({ SSH_HOST: 'worker.example', SSH_HOST_FINGERPRINT_MAP: '{bad' }, {}));
});

test('A JOB_ARG URI cannot provide an attacker-controlled fingerprint', () => {
	const attackerPin = formatOpenSshFingerprint(Buffer.from('attacker-key'));
	expectPolicyError('SSH_HOST_FINGERPRINT_REQUIRED', () => resolveSshTarget({
		JOB_ARG: `ssh://attacker.test?hostFingerprint=${encodeURIComponent(attackerPin)}`,
		SSH_HOST_KEY_STRICT: '1'
	}, {}));
	expectPolicyError('SSH_HOST_FINGERPRINT_REQUIRED', () => resolveSshTarget({
		SSH_HOST: `ssh://configured.test?hostFingerprint=${encodeURIComponent(attackerPin)}`,
		SSH_HOST_KEY_STRICT: '1'
	}, {}));

	const operatorPin = formatOpenSshFingerprint(Buffer.from('operator-key'));
	const target = resolveSshTarget({
		JOB_ARG: `ssh://attacker.test?hostFingerprint=${encodeURIComponent(attackerPin)}`,
		SSH_HOST_FINGERPRINT: operatorPin,
		SSH_HOST_KEY_STRICT: '1'
	}, {});
	assert.equal(target.pinCount, 1);
	assert.equal(target.hostVerifier(Buffer.from('attacker-key')), false);
	assert.equal(target.hostVerifier(Buffer.from('operator-key')), true);
});

test('Connection options retain SSH host, port, username, pty, and the verifier', () => {
	const pin = formatOpenSshFingerprint(Buffer.from('server'));
	const target = resolveSshTarget({
		SSH_HOST: 'sftp://cronicle@example.test:2200',
		SSH_HOST_FINGERPRINT: pin
	}, { defaultProtocol: 'sftp' });
	const conf = buildConnectionOptions(target);
	assert.equal(conf.host, 'example.test');
	assert.equal(conf.port, 2200);
	assert.equal(conf.username, 'cronicle');
	assert.equal(conf.pty, true);
	assert.equal(typeof conf.hostVerifier, 'function');
	assert.equal(buildConnectionOptions(target, { pty: false }).pty, false);
});

test('ssh-plugin honors configured remote host over JOB_ARG and preserves SSH_CMD', async () => {
	const beforeCount = executions.length;
	const result = await runPlugin('ssh-plugin.js', {
		SSH_HOST: `sftp://cronicle:test@127.0.0.1:${serverPort}`,
		JOB_ARG: 'localhost',
		SSH_HOST_FINGERPRINT: serverFingerprint,
		SSH_HOST_KEY_STRICT: '1',
		SSH_CMD: 'bash -s --noprofile',
		SCRIPT: 'echo remote-only'
	});
	assert.equal(result.signal, null);
	assert.equal(executions.length, beforeCount + 1);
	assert.equal(executions.at(-1).command, 'bash -s --noprofile');
	assert.match(executions.at(-1).input, /echo remote-only/);
	assert.equal(result.messages.at(-1).code, 0);
});

test('ssh-plugin keeps explicit configured local mode and rejects local JOB_ARG with flushed JSON', async () => {
	const local = await runPlugin('ssh-plugin.js', {
		SSH_HOST: 'localhost',
		JOB_ARG: 'attacker.example',
		SSH_CMD: 'sh -',
		SCRIPT: 'echo configured-local'
	});
	assert.match(local.stdout, /configured-local/);
	assert.equal(local.messages.at(-1).code, 0);

	const rejected = await runPlugin('ssh-plugin.js', {
		JOB_ARG: 'localhost',
		SSH_CMD: 'sh -',
		SCRIPT: 'echo MUST_NOT_RUN'
	});
	assert.doesNotMatch(rejected.stdout, /MUST_NOT_RUN/);
	assert.equal(rejected.messages.length, 1);
	assert.equal(rejected.messages[0].code, 1);
	assert.match(rejected.messages[0].description, /cannot select local SSH execution/);
});

test('sshx-plugin uses its fixed remote command and never forwards trust-policy variables', async () => {
	const beforeCount = executions.length;
	const result = await runPlugin('sshx-plugin.js', {
		SSH_HOST: `ssh://cronicle@127.0.0.1:${serverPort}`,
		JOB_ARG: 'localhost',
		SSH_PASSWORD: 'test',
		SSH_HOST_FINGERPRINT: serverFingerprint,
		SSH_HOST_KEY_STRICT: '1',
		SCRIPT: 'echo sshx-script'
	});
	assert.equal(result.signal, null);
	assert.equal(executions.length, beforeCount + 1);
	assert.equal(executions.at(-1).command, 'sh -');
	assert.doesNotMatch(executions.at(-1).input, /SSH_HOST_FINGERPRINT/);
	assert.doesNotMatch(executions.at(-1).input, /SSH_HOST_KEY_STRICT/);
	assert.doesNotMatch(executions.at(-1).input, new RegExp(serverFingerprint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	assert.equal(result.messages.at(-1).code, 0);
});

test('sshx bootstrap does not forward connection secrets or a JOB_ARG target selector', async () => {
	const directPassword = 'JOB_ARG_PASSWORD_SENTINEL';
	const directPassphrase = 'JOB_ARG_URI_PASSPHRASE_SENTINEL';
	const envPassphrase = 'SSH_PASSPHRASE_ENV_SENTINEL';
	const directUri = `ssh://cronicle:${directPassword}@127.0.0.1:${serverPort}?passphrase=${directPassphrase}`;
	let result = await runPlugin('sshx-plugin.js', {
		JOB_ARG: directUri,
		SSH_PASSPHRASE: envPassphrase,
		SSH_HOST_FINGERPRINT: serverFingerprint,
		SSH_HOST_KEY_STRICT: '1',
		ARG_SAFE_PROBE: 'bootstrap-probe-visible',
		SCRIPT: 'echo direct-job-arg'
	});
	assert.equal(result.messages.at(-1).code, 0);
	let exported = bootstrapExports(executions.at(-1).input);
	assert.equal(exported.ARG_SAFE_PROBE, 'bootstrap-probe-visible');
	assert.equal(Object.hasOwn(exported, 'JOB_ARG'), false);
	assert.equal(Object.hasOwn(exported, 'SSH_PASSPHRASE'), false);
	assert.equal(Object.values(exported).some((value) => [directPassword, directPassphrase, envPassphrase].some((secret) => value.includes(secret))), false);

	const aliasPassword = 'JOB_ARG_ALIAS_PASSWORD_SENTINEL';
	const aliasUri = `ssh://cronicle:${aliasPassword}@127.0.0.1:${serverPort}`;
	result = await runPlugin('sshx-plugin.js', {
		JOB_ARG: 'ARG_SSH_TARGET',
		ARG_SSH_TARGET: aliasUri,
		SSH_PASSWORD: 'test',
		SSH_HOST_FINGERPRINT: serverFingerprint,
		SSH_HOST_KEY_STRICT: '1',
		ARG_SAFE_PROBE: 'alias-probe-visible',
		SCRIPT: 'echo aliased-job-arg'
	});
	assert.equal(result.messages.at(-1).code, 0);
	exported = bootstrapExports(executions.at(-1).input);
	assert.equal(exported.ARG_SAFE_PROBE, 'alias-probe-visible');
	assert.equal(Object.hasOwn(exported, 'JOB_ARG'), false);
	assert.equal(Object.hasOwn(exported, 'ARG_SSH_TARGET'), false);
	assert.equal(Object.values(exported).some((value) => value.includes(aliasPassword)), false);
});

test('sshx-plugin rejects JOB_ARG localhost and an untrusted URI fingerprint before connect', async () => {
	const local = await runPlugin('sshx-plugin.js', {
		JOB_ARG: 'localhost',
		SSH_PASSWORD: 'test'
	});
	assert.equal(local.messages.length, 1);
	assert.equal(local.messages[0].code, 1);
	assert.match(local.messages[0].description, /cannot select local SSH execution/);

	const ownPin = await runPlugin('sshx-plugin.js', {
		JOB_ARG: `ssh://cronicle@127.0.0.1:${serverPort}?hostFingerprint=${encodeURIComponent(serverFingerprint)}`,
		SSH_PASSWORD: 'test',
		SSH_HOST_KEY_STRICT: '1'
	});
	assert.equal(ownPin.messages.length, 1);
	assert.equal(ownPin.messages[0].code, 1);
	assert.match(ownPin.messages[0].description, /No trusted SSH host key fingerprint/);
});

test('Both plugins emit final JSON for malformed credentials and unreadable private keys', async () => {
	const missingKey = path.join(root, 'test', 'fixtures', 'missing-ssh-private-key');
	const cases = [
		['ssh-plugin.js', { SSH_HOST: `sftp://cronicle:%@127.0.0.1:${serverPort}` }, /URI malformed/],
		['ssh-plugin.js', { SSH_HOST: `sftp://cronicle@127.0.0.1:${serverPort}?privateKey=${encodeURIComponent(missingKey)}` }, /ENOENT/],
		['sshx-plugin.js', { SSH_HOST: `ssh://cronicle:%@127.0.0.1:${serverPort}` }, /URI malformed/],
		['sshx-plugin.js', { SSH_HOST: `ssh://cronicle@127.0.0.1:${serverPort}?privateKey=${encodeURIComponent(missingKey)}` }, /ENOENT/]
	];
	for (const [plugin, env, expected] of cases) {
		const result = await runPlugin(plugin, env);
		assert.equal(result.signal, null);
		assert.equal(result.code, 1);
		assert.equal(result.messages.length, 1);
		assert.equal(result.messages[0].complete, 1);
		assert.equal(result.messages[0].code, 1);
		assert.match(result.messages[0].description, expected);
		assert.equal(result.stderr, '');
	}
});

test('Host-key mismatch blocks command execution in both SSH plugins', async () => {
	const beforeCount = executions.length;
	const wrongPin = formatOpenSshFingerprint(Buffer.from('wrong-server-key'));
	const legacyResult = await runPlugin('ssh-plugin.js', {
		SSH_HOST: `sftp://cronicle:test@127.0.0.1:${serverPort}`,
		SSH_HOST_FINGERPRINT: wrongPin,
		SSH_HOST_KEY_STRICT: '1',
		SSH_CMD: 'sh -',
		SCRIPT: 'echo MUST_NOT_REACH_SERVER'
	});
	assert.equal(executions.length, beforeCount);
	assert.equal(legacyResult.messages.at(-1).code, 1);
	assert.match(legacyResult.messages.at(-1).description, /(Host key verification failed|Host denied \(verification failed\))/i);

	const sshxResult = await runPlugin('sshx-plugin.js', {
		SSH_HOST: `ssh://cronicle@127.0.0.1:${serverPort}`,
		SSH_PASSWORD: 'test',
		SSH_HOST_FINGERPRINT: wrongPin,
		SSH_HOST_KEY_STRICT: '1',
		SCRIPT: 'echo MUST_NOT_REACH_SERVER_EITHER'
	});
	assert.equal(executions.length, beforeCount);
	assert.equal(sshxResult.messages.at(-1).code, 1);
	assert.match(sshxResult.messages.at(-1).description, /(Host key verification failed|Host denied \(verification failed\))/i);
});

test('Compatibility mode preserves an unpinned remote Workflow argument and warns', async () => {
	const beforeCount = executions.length;
	const result = await runPlugin('ssh-plugin.js', {
		JOB_ARG: `sftp://cronicle:test@127.0.0.1:${serverPort}`,
		SSH_CMD: 'sh -',
		SCRIPT: 'echo compatibility-job'
	});
	assert.equal(executions.length, beforeCount + 1);
	assert.match(result.stdout, /disabled for compatibility/);
	assert.equal(result.messages.at(-1).code, 0);
});

module.exports = {
	setUp: function(callback) {
		Promise.resolve().then(suiteBefore).then(function() { callback(); }, callback);
	},
	tests,
	tearDown: function(callback) {
		Promise.resolve().then(suiteAfter).then(function() { callback(); }, callback);
	}
};
