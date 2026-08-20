const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.dirname(__dirname);
const tempRoots = [];
const tests = [];

function test(name, callback) {
	const wrapped = function(testHandle) {
		try {
			callback();
			testHandle.done();
		}
		catch (err) {
			testHandle.ok(false, name + ': ' + (err && err.stack || err));
			testHandle.done();
		}
	};
	Object.defineProperty(wrapped, 'name', {
		value: name.replace(/[^A-Za-z0-9]+/g, '_'),
		configurable: true
	});
	tests.push(wrapped);
}

function makeInstall() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-bootstrap-test-'));
	tempRoots.push(home);
	fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
	fs.mkdirSync(path.join(home, 'nodejs', 'bin'), { recursive: true });
	fs.mkdirSync(path.join(home, 'lib'), { recursive: true });
	fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
	fs.copyFileSync(path.join(root, 'bin', 'manager'), path.join(home, 'bin', 'manager'));
	fs.copyFileSync(path.join(root, 'bin', 'control.sh'), path.join(home, 'bin', 'control.sh'));
	fs.chmodSync(path.join(home, 'bin', 'manager'), 0o755);
	fs.chmodSync(path.join(home, 'bin', 'control.sh'), 0o755);

	const fakeNode = `#!/bin/sh
printf '%s\\n' "$*" >> "$BOOTSTRAP_TRACE"
case "$1" in
  -v)
    printf '%s\\n' 'v-test'
    exit 0
    ;;
  -e)
    printf '%s\\n' 'logs/cronicled.pid'
    exit 0
    ;;
  */storage-cli.js)
    case "$2" in
      setup) exit "\${BOOTSTRAP_SETUP_EXIT:-0}" ;;
      reset) exit "\${BOOTSTRAP_RESET_EXIT:-0}" ;;
    esac
    ;;
  */lib/main.js|*/bin/cronicle.js)
    exit "\${BOOTSTRAP_RUNTIME_EXIT:-0}"
    ;;
esac
exit 0
`;
	fs.writeFileSync(path.join(home, 'nodejs', 'bin', 'node'), fakeNode, { mode: 0o755 });
	return home;
}

function run(script, args, values) {
	const home = path.dirname(path.dirname(script));
	const trace = path.join(home, 'trace.log');
	const env = Object.assign({}, process.env, {
		BOOTSTRAP_TRACE: trace,
		BOOTSTRAP_SETUP_EXIT: '0',
		BOOTSTRAP_RESET_EXIT: '0',
		BOOTSTRAP_RUNTIME_EXIT: '0'
	}, values || {});
	delete env.GIT_REPO;
	if (values && Object.prototype.hasOwnProperty.call(values, 'GIT_REPO')) {
		env.GIT_REPO = values.GIT_REPO;
	}
	const result = cp.spawnSync(script, args || [], { env, encoding: 'utf8' });
	result.trace = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
	return result;
}

test('manager rejects deprecated GIT_REPO without exposing it or starting setup/runtime', function() {
	const home = makeInstall();
	const secretUrl = 'https://user:credential@example.invalid/private.git';
	const result = run(path.join(home, 'bin', 'manager'), [], { GIT_REPO: secretUrl });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /GIT_REPO.*unsupported|unsupported.*GIT_REPO/i);
	assert.equal((result.stdout + result.stderr).includes(secretUrl), false);
	assert.equal((result.stdout + result.stderr).includes('credential'), false);
	assert.equal(result.trace, '');
});

test('control setup preserves storage-cli failure and does not continue to start', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'control.sh'), ['setup', 'start'], {
		BOOTSTRAP_SETUP_EXIT: '37'
	});
	assert.equal(result.status, 37);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.doesNotMatch(result.trace, /lib\/main\.js|bin\/cronicle\.js/);
});

test('control setup success can still continue to start', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'control.sh'), ['setup', 'start']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.match(result.trace, /lib\/main\.js/);
});

test('manager preserves setup failure and never starts the runtime', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'manager'), [], { BOOTSTRAP_SETUP_EXIT: '37' });
	assert.equal(result.status, 37);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.doesNotMatch(result.trace, /lib\/main\.js|bin\/cronicle\.js/);
});

test('manager reset fallback preserves setup failure and never starts the runtime', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'manager'), ['--reset'], {
		BOOTSTRAP_RESET_EXIT: '23',
		BOOTSTRAP_SETUP_EXIT: '37'
	});
	assert.equal(result.status, 37);
	assert.match(result.trace, /storage-cli\.js reset/);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.doesNotMatch(result.trace, /lib\/main\.js|bin\/cronicle\.js/);
});

test('manager reset success skips setup and starts the runtime', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'manager'), ['--reset']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.trace, /storage-cli\.js reset/);
	assert.doesNotMatch(result.trace, /storage-cli\.js setup/);
	assert.match(result.trace, /lib\/main\.js/);
});

test('manager reset failure can recover through successful setup', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'manager'), ['--reset'], {
		BOOTSTRAP_RESET_EXIT: '23'
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.trace, /storage-cli\.js reset/);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.match(result.trace, /lib\/main\.js/);
});

test('manager without GIT_REPO completes setup and starts the runtime', function() {
	const home = makeInstall();
	const result = run(path.join(home, 'bin', 'manager'));
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.trace, /storage-cli\.js setup/);
	assert.match(result.trace, /lib\/main\.js/);
});

test('Windows manager source contract rejects GIT_REPO and guards both setup paths', function() {
	const managerBat = fs.readFileSync(path.join(root, 'bin', 'manager.bat'), 'utf8');
	const setupGuards = managerBat.match(/node \.\\storage-cli\.js setup\s*\n\s*if errorlevel 1 goto setup_failed/gi) || [];
	const gitRepoGuardIndex = managerBat.search(/if defined GIT_REPO/i);
	const firstSetupIndex = managerBat.search(/storage-cli\.js setup/i);
	assert.match(managerBat, /if defined GIT_REPO \([\s\S]*?GIT_REPO bootstrap is unsupported[\s\S]*?exit \/b 1[\s\S]*?\)/i);
	assert.doesNotMatch(managerBat, /%GIT_REPO%/i);
	assert.ok(gitRepoGuardIndex >= 0 && gitRepoGuardIndex < firstSetupIndex);
	assert.equal(setupGuards.length, 2);
	assert.match(managerBat, /node \.\\cronicle\.js[^\n]*\nexit \/b\s*\n\s*:setup_failed/i);
	assert.match(managerBat, /:setup_failed\s*\nexit \/b 1/i);
	assert.ok(managerBat.indexOf(':setup_failed') > managerBat.indexOf('node .\\cronicle.js'));
});

module.exports = {
	setUp: function(callback) { callback(); },
	tests: tests,
	tearDown: function(callback) {
		for (const tempRoot of tempRoots.splice(0)) {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
		callback();
	}
};
