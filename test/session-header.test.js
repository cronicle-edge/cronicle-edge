const assert = require('node:assert/strict');
const { Readable } = require('stream');

const Api = require('../lib/api');
const User = require('../lib/user');

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

// Minimal in-memory storage mock, just enough for loadSession() and
// api_get_job_log() to run without a real pixl-server storage engine.
class FakeStorage {
	constructor() { this.records = new Map(); }
	get(key, cb) {
		setImmediate(() => {
			if (!this.records.has(key)) {
				const err = new Error('File not found');
				err.code = 'NoSuchKey';
				return cb(err);
			}
			cb(null, this.records.get(key));
		});
	}
	getStream(key, cb) {
		setImmediate(() => cb(null, Readable.from(['fake log data'])));
	}
}

function makeApi() {
	const storage = new FakeStorage();
	const usermgr = Object.create(User.prototype);
	usermgr.logError = function() {};

	const api = Object.create(Api.prototype);
	api.storage = storage;
	api.usermgr = usermgr;
	api.server = { config: { get: (key) => (key === 'protect_job_log' ? true : undefined) } };

	return { api, storage };
}

function seedSession(storage, sessionId, username) {
	storage.records.set('sessions/' + sessionId, {
		id: sessionId,
		username: username,
		expires: Math.floor(Date.now() / 1000) + 3600
	});
	storage.records.set('users/' + username, { username: username, active: 1, privileges: {} });
}

function baseArgs(overrides) {
	return Object.assign({
		cookies: {},
		request: { headers: {} },
		params: {},
		query: {}
	}, overrides);
}

function loadSession(api, args) {
	return new Promise((resolve) => {
		api.loadSession(args, function(err, session, user) {
			resolve({ err, session, user });
		});
	});
}

function getJobLog(api, args) {
	return new Promise((resolve) => {
		api.api_get_job_log(args, function(status, headers, body) {
			resolve({ status, headers, body });
		});
	});
}

// Group A: loadSession() is the shared auth path used by both
// api_get_live_console and api_get_job_log (lib/api/job.js). This is
// exactly what console.html's fetch(..., {headers: {'X-Session-ID': ...}})
// exercises, and what PR #291's reviewer asked to see proven.

test('loadSession authenticates via X-Session-ID header alone, no session_id in URL', async () => {
	const { api, storage } = makeApi();
	seedSession(storage, 'header-session', 'alice');

	const args = baseArgs({ request: { headers: { 'x-session-id': 'header-session' } } });
	const { err, session, user } = await loadSession(api, args);

	assert.equal(err, null);
	assert.equal(session.username, 'alice');
	assert.equal(user.active, 1);
	assert.equal(args.query.session_id, undefined, 'session_id must not be present in the query string');
});

test('loadSession still authenticates via legacy session_id query param (backward compatibility)', async () => {
	const { api, storage } = makeApi();
	seedSession(storage, 'query-session', 'bob');

	const args = baseArgs({ query: { session_id: 'query-session' } });
	const { err, session, user } = await loadSession(api, args);

	assert.equal(err, null);
	assert.equal(session.username, 'bob');
	assert.equal(user.active, 1);
});

test('loadSession fails closed when no session_id is supplied anywhere', async () => {
	const { api } = makeApi();
	const { err, session, user } = await loadSession(api, baseArgs());

	assert.ok(err, 'expected an error when no session_id is present');
	assert.equal(session, null);
	assert.equal(user, null);
});

// Group B: full api_get_job_log handler test (with protect_job_log enabled,
// the default in sample_conf/config.json), proving the whole request path --
// not just loadSession() in isolation -- authenticates via the header.
//
// api_get_live_console is deliberately not given an equivalent full-handler
// test here: it calls the exact same loadSession(args, ...) line already
// proven above (lib/api/job.js:145 vs. :22), but additionally requires
// mocking self.multi.manager, a live in-memory job record from
// get_active_job_by_id, self.server.hostname matching the job's hostname,
// and get_job_log_chunk's real fs.stat/fs.open calls -- none of which adds
// any further signal about header-based auth, so it isn't worth the
// fragile extra mocking.

test('api_get_job_log succeeds via X-Session-ID header, no session_id in URL', async () => {
	const { api, storage } = makeApi();
	seedSession(storage, 'job-log-session', 'alice');

	const args = baseArgs({
		query: { id: 'job1' },
		request: { headers: { 'x-session-id': 'job-log-session' } }
	});

	const { status } = await getJobLog(api, args);
	assert.equal(status, '200 OK');
	assert.equal(args.query.session_id, undefined);
});

test('api_get_job_log is rejected when protect_job_log is enabled and no session_id is supplied', async () => {
	const { api } = makeApi();
	const args = baseArgs({ query: { id: 'job1' } });

	const { status } = await getJobLog(api, args);
	assert.notEqual(status, '200 OK');
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
