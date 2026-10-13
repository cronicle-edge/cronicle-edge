const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PluginEnv = require('../lib/plugin-env');

const repoRoot = path.resolve(__dirname, '..');
const runtimeProbe = path.join(__dirname, 'fixtures', 'plugin-runtime-probe.cjs');
const kubeLoader = path.join(__dirname, 'fixtures', 'kube-client-loader.mjs');
const localEnvProbe = path.join(__dirname, 'fixtures', 'print-selected-env.cjs');

const tests = [];
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
		value: name.replace(/[^A-Za-z0-9]+/g, '_'), configurable: true
	});
	tests.push(wrapped);
}

function baseEnv(extra) {
	return Object.assign({
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		LANG: process.env.LANG || 'C',
		BASE_URL: 'https://manager.internal',
		BASE_APP_URL: 'https://cronicle.example'
	}, extra || {});
}

function runNode(args, options) {
	const spawnOptions = Object.assign({
		cwd: repoRoot,
		encoding: 'utf8',
		timeout: 15000
	}, options || {});
	let inputPath = null;
	let inputFd = null;
	if (Object.prototype.hasOwnProperty.call(spawnOptions, 'input')) {
		inputPath = path.join(
			os.tmpdir(), 'cronicle-plugin-env-' + process.pid + '-' + Date.now() + '.json'
		);
		fs.writeFileSync(inputPath, spawnOptions.input);
		inputFd = fs.openSync(inputPath, 'r');
		delete spawnOptions.input;
		spawnOptions.stdio = [inputFd, 'pipe', 'pipe'];
	}
	let result;
	try {
		result = spawnSync(process.execPath, args, spawnOptions);
	}
	finally {
		if (inputFd !== null) fs.closeSync(inputFd);
		if (inputPath) fs.unlinkSync(inputPath);
	}
	if (result.error) throw result.error;
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result;
}

function readProbe(stdout, marker) {
	const line = String(stdout).split(/\r?\n/).find((item) => item.startsWith(marker));
	assert.ok(line, 'missing runtime probe ' + marker + ' in: ' + stdout);
	return line.substring(marker.length);
}

test('manager job environment retains BASE_URL and user runtime secrets', () => {
	const childEnv = {
		BASE_URL: 'https://manager.internal',
		BASE_APP_URL: 'https://cronicle.example',
		USER_RUNTIME_SECRET: 'decrypted-for-user-code'
	};
	PluginEnv.copyPublicJobFieldsToEnv({
		id: 'j1', debug: true, attempts: 2,
		secret: 'encrypted-event', globalenv: 'encrypted-global',
		cat_secret: 'encrypted-category', plug_secret: 'encrypted-plugin',
		local_secret: 'encrypted-local', api_key: 'request-secret'
	}, childEnv);

	assert.equal(childEnv.BASE_URL, 'https://manager.internal');
	assert.equal(childEnv.BASE_APP_URL, 'https://cronicle.example');
	assert.equal(childEnv.USER_RUNTIME_SECRET, 'decrypted-for-user-code');
	assert.equal(childEnv.JOB_ID, 'j1');
	assert.equal(childEnv.JOB_DEBUG, 1);
	assert.equal(childEnv.JOB_ATTEMPTS, '2');
	['JOB_SECRET', 'JOB_GLOBALENV', 'JOB_CAT_SECRET', 'JOB_PLUG_SECRET',
		'JOB_LOCAL_SECRET', 'JOB_API_KEY'].forEach((key) => {
		assert.equal(Object.hasOwn(childEnv, key), false, key);
	});
});

test('runtime job metadata remains available to existing plugin consumers', () => {
	const childEnv = {};
	PluginEnv.copyPublicJobFieldsToEnv({
		command: 'bin/terminal-plugin.js',
		cwd: '/opt/cronicle',
		uid: 1000,
		gid: 1000,
		log_file: '/var/log/cronicle/jobs/j1.log',
		web_hook: 'https://hooks.example/runtime',
		web_hook_start: 'https://hooks.example/start',
		web_hook_error: 'https://hooks.example/error',
		post_data: 'runtime-post-data',
		headers: 'X-Runtime: visible',
		stdin_script: 'runtime bootstrap'
	}, childEnv);

	assert.deepEqual(childEnv, {
		JOB_COMMAND: 'bin/terminal-plugin.js',
		JOB_CWD: '/opt/cronicle',
		JOB_UID: '1000',
		JOB_GID: '1000',
		JOB_LOG_FILE: '/var/log/cronicle/jobs/j1.log',
		JOB_WEB_HOOK: 'https://hooks.example/runtime',
		JOB_WEB_HOOK_START: 'https://hooks.example/start',
		JOB_WEB_HOOK_ERROR: 'https://hooks.example/error',
		JOB_POST_DATA: 'runtime-post-data',
		JOB_HEADERS: 'X-Runtime: visible',
		JOB_STDIN_SCRIPT: 'runtime bootstrap'
	});
});

test('Docker plugin passes public runtime values without connection credentials', () => {
	const result = runNode(['-r', runtimeProbe, path.join(repoRoot, 'bin', 'docker-plugin.js')], {
		input: '{}\n',
		env: baseEnv({
			JOB_ID: 'j-docker',
			JOB_ARG: 'ssh://user:arg-password@arg-host',
			JOB_SECRET: 'encrypted-event',
			JOB_GLOBALENV: 'encrypted-global',
			DOCKER_HOST: 'DOCKER_REMOTE',
			DOCKER_REMOTE: 'ssh://user:docker-password@docker-host',
			DOCKER_VISIBLE: 'visible',
			DOCKER_PASSWORD: 'registry-password',
			SSH_PASSWORD: 'ssh-password',
			SSH_KEY: 'ssh-key',
			SSH_PASSPHRASE: 'ssh-passphrase',
			ARG1: 'public-arg',
			IMAGE: 'alpine',
			PULL_IMAGE: '0'
		})
	});
	const entries = JSON.parse(readProbe(result.stdout, 'DOCKER_ENV_PROBE='));
	const passed = Object.fromEntries(entries.map((item) => item.split(/=(.*)/s).slice(0, 2)));

	assert.equal(passed.JOB_ID, 'j-docker');
	assert.equal(passed.DOCKER_VISIBLE, 'visible');
	assert.equal(passed.ARG1, 'public-arg');
	assert.equal(passed.BASE_URL, 'https://manager.internal');
	assert.equal(passed.JOB_ARG, 'ssh://user:arg-password@arg-host');
	['JOB_SECRET', 'JOB_GLOBALENV', 'DOCKER_HOST', 'DOCKER_REMOTE',
		'DOCKER_PASSWORD', 'SSH_PASSWORD', 'SSH_KEY', 'SSH_PASSPHRASE']
		.forEach((key) => assert.equal(Object.hasOwn(passed, key), false, key));
});

test('connection URI detection covers username tokens and normalized query keys', () => {
	[
		'ssh://TOKEN_ONLY@docker-host',
		'https://docker-host?access_token=private',
		'https://docker-host?client-secret=private',
		'https://docker-host?sessionToken=private',
		'https://docker-host?apiKey=private',
		'https://docker-host?customRefresh_Token=private'
	].forEach((uri) => {
		const passed = Object.fromEntries(PluginEnv.buildDockerPluginEnv({
			DOCKER_HOST: 'DOCKER_REMOTE',
			DOCKER_REMOTE: uri,
			DOCKER_VISIBLE: 'visible'
		}, false));
		assert.equal(Object.hasOwn(passed, 'DOCKER_HOST'), false, uri);
		assert.equal(Object.hasOwn(passed, 'DOCKER_REMOTE'), false, uri);
		assert.equal(passed.DOCKER_VISIBLE, 'visible', uri);
	});

	const compatible = Object.fromEntries(PluginEnv.buildDockerPluginEnv({
		DOCKER_HOST: 'tcp://docker.example:2375',
		DOCKER_VISIBLE: 'visible'
	}, false));
	assert.equal(compatible.DOCKER_HOST, 'tcp://docker.example:2375');
	assert.equal(compatible.DOCKER_VISIBLE, 'visible');
});

test('environment filtering is case-insensitive at security boundaries', () => {
	const docker = Object.fromEntries(PluginEnv.buildDockerPluginEnv({
		JOB_Secret: 'encrypted-event',
		DOCKER_password: 'registry-password',
		SSH_Key: 'ssh-key',
		DOCKER_Visible: 'visible'
	}, false));
	assert.deepEqual(docker, { DOCKER_Visible: 'visible' });

	const kube = Object.fromEntries(PluginEnv.buildKubePluginEnv({
		JOB_GlobalEnv: 'encrypted-global',
		KUBE_Config: 'private-config',
		KUBE_Visible: 'visible'
	}, false));
	assert.deepEqual(kube, { KUBE_Visible: 'visible' });

	const sshx = Object.fromEntries(PluginEnv.buildSSHXPluginEnv({
		SSH_Host: 'SSH_Remote',
		SSH_Remote: 'ssh://token-only@host',
		SSH_Password: 'connection-password',
		SSH_Key: 'connection-key',
		SSH_Passphrase: 'connection-passphrase',
		SSH_TmpDir: '/safe/tmp'
	}, false));
	assert.deepEqual(sshx, { SSH_TmpDir: '/safe/tmp' });

	const local = PluginEnv.sanitizeSSHLocalEnv({
		Job_Secret: 'encrypted-event',
		Ssh_Host: 'Ssh_Remote',
		Ssh_Remote: 'ssh://token-only@host',
		Ssh_Password: 'connection-password',
		Ssh_Key: 'connection-key',
		Ssh_Passphrase: 'connection-passphrase',
		User_Runtime_Secret: 'decrypted-for-user-code'
	});
	assert.deepEqual(local, { User_Runtime_Secret: 'decrypted-for-user-code' });
});

test('Kubernetes plugin omits config and credentials from the real pod manifest', () => {
	const result = runNode([
		'--experimental-loader', kubeLoader,
		path.join(repoRoot, 'bin', 'kube-plugin.mjs')
	], {
		input: JSON.stringify({ id: 'j-kube', params: {} }),
		env: baseEnv({
			JOB_ID: 'j-kube',
			JOB_ARG: 'ssh://user:arg-password@arg-host',
			JOB_SECRET: 'encrypted-event',
			JOB_GLOBALENV: 'encrypted-global',
			KUBE_CONFIG: 'KUBE_CONFIG_PRIVATE_SENTINEL',
			KUBE_VISIBLE: 'visible',
			ARG1: 'public-arg',
			IMAGE: 'alpine',
			VERBOSE: '1'
		})
	});
	const entries = JSON.parse(readProbe(result.stdout, 'KUBE_ENV_PROBE='));
	const passed = Object.fromEntries(entries.map((item) => [item.name, item.value]));

	assert.equal(result.stdout.includes('KUBE_CONFIG_PRIVATE_SENTINEL'), false);
	assert.equal(passed.JOB_ID, 'j-kube');
	assert.equal(passed.KUBE_VISIBLE, 'visible');
	assert.equal(passed.ARG1, 'public-arg');
	assert.equal(passed.BASE_URL, 'https://manager.internal');
	assert.equal(passed.JOB_ARG, 'ssh://user:arg-password@arg-host');
	['JOB_SECRET', 'JOB_GLOBALENV', 'KUBE_CONFIG']
		.forEach((key) => assert.equal(Object.hasOwn(passed, key), false, key));
});

test('SSH local mode keeps user runtime values out of connection-secret scope', () => {
	const command = '"' + process.execPath + '" "' + localEnvProbe + '"';
	const result = runNode([path.join(repoRoot, 'bin', 'ssh-plugin.js')], {
		input: '',
		env: baseEnv({
			JSON: '1',
			SSH_HOST: 'localhost',
			SSH_CMD: command,
			SCRIPT: '',
			USER_RUNTIME_SECRET: 'decrypted-for-user-code',
			JOB_SECRET: 'encrypted-event',
			JOB_GLOBALENV: 'encrypted-global',
			SSH_PASSWORD: 'connection-password',
			SSH_KEY: 'connection-key',
			SSH_PASSPHRASE: 'connection-passphrase'
		})
	});
	const passed = JSON.parse(readProbe(result.stdout, 'SSH_LOCAL_ENV_PROBE='));

	assert.equal(passed.BASE_URL, 'https://manager.internal');
	assert.equal(passed.USER_RUNTIME_SECRET, 'decrypted-for-user-code');
	['JOB_SECRET', 'JOB_GLOBALENV', 'SSH_HOST', 'SSH_PASSWORD', 'SSH_KEY', 'SSH_PASSPHRASE']
		.forEach((key) => assert.equal(Object.hasOwn(passed, key), false, key));
});

test('SSHX plugin excludes the selected host reference and connection credentials', () => {
	const result = runNode([
		'-r', runtimeProbe, path.join(repoRoot, 'bin', 'sshx-plugin.js')
	], {
		input: JSON.stringify({ id: 'j-sshx', params: {}, chain_data: {} }),
		env: baseEnv({
			JOB_ID: 'j-sshx',
			JOB_ARG: 'ssh://user:arg-password@arg-host',
			JOB_SECRET: 'encrypted-event',
			JOB_GLOBALENV: 'encrypted-global',
			SSH_HOST: 'SSH_REMOTE',
			SSH_REMOTE: 'ssh://user:ssh-password@ssh-host',
			SSH_PASSWORD: 'connection-password',
			SSH_KEY: 'connection-key',
			SSH_PASSPHRASE: 'connection-passphrase',
			SSH_TMPDIR: '/safe/tmp',
			ARG1: 'public-arg'
		})
	});
	const script = Buffer.from(
		readProbe(result.stdout, 'SSHX_SCRIPT_PROBE='), 'base64'
	).toString();

	['JOB_ID', 'BASE_URL', 'SSH_TMPDIR', 'ARG1'].forEach((key) => {
		assert.match(script, new RegExp('export ' + key + '='));
	});
	['JOB_ARG', 'JOB_SECRET', 'JOB_GLOBALENV', 'SSH_HOST', 'SSH_REMOTE',
		'SSH_PASSWORD', 'SSH_KEY', 'SSH_PASSPHRASE'].forEach((key) => {
		assert.doesNotMatch(script, new RegExp('export ' + key + '='));
	});
	['arg-password', 'encrypted-event', 'encrypted-global', 'ssh-password',
		'connection-password', 'connection-key', 'connection-passphrase'].forEach((value) => {
		assert.equal(script.includes(Buffer.from(value).toString('base64')), false, value);
	});
});

module.exports = {
	setUp: function(callback) { callback(); },
	tests: tests,
	tearDown: function(callback) { callback(); }
};
