const assert = require('node:assert/strict');
const http = require('node:http');

const User = require('../lib/user');
const OIDC = User.prototype;
const Admin = require('../lib/api/admin');

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

class FakeStorage {
	constructor() {
		this.records = new Map();
		this.expirations = new Map();
		this.recordTypes = new Map();
		this.locks = new Set();
		this.waiters = new Map();
	}
	clone(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
	addRecordType(type, handlers) { this.recordTypes.set(type, handlers); }
	put(key, value, callback) {
		this.records.set(key, this.clone(value));
		setImmediate(() => callback && callback(null));
	}
	get(key, callback) {
		setImmediate(() => {
			if (!this.records.has(key)) {
				const err = new Error('File not found');
				err.code = 'NoSuchKey';
				return callback(err);
			}
			callback(null, this.clone(this.records.get(key)));
		});
	}
	delete(key, callback) {
		setImmediate(() => {
			if (!this.records.has(key)) {
				const err = new Error('File not found');
				err.code = 'NoSuchKey';
				return callback && callback(err);
			}
			this.records.delete(key);
			this.expirations.delete(key);
			if (callback) callback(null);
		});
	}
	expire(key, expiration) { this.expirations.set(key, expiration); }
	lock(key, wait, callback) {
		if (!this.locks.has(key)) {
			this.locks.add(key);
			return setImmediate(callback);
		}
		if (!this.waiters.has(key)) this.waiters.set(key, []);
		this.waiters.get(key).push(callback);
	}
	unlock(key) {
		const queue = this.waiters.get(key) || [];
		if (queue.length) return setImmediate(queue.shift());
		this.waiters.delete(key);
		this.locks.delete(key);
	}
	expireNow(key) {
		return new Promise((resolve, reject) => {
			const value = this.clone(this.records.get(key));
			const handler = value && this.recordTypes.get(value.type);
			if (!handler || !handler.delete) {
				return this.delete(key, (err) => err && err.code !== 'NoSuchKey' ? reject(err) : resolve());
			}
			handler.delete(key, value, (err) => err ? reject(err) : resolve());
		});
	}
}

function makeUser(oauth) {
	const user = Object.create(User.prototype);
	const storage = new FakeStorage();
	const logs = [];
	user.storage = storage;
	user.hooks = {};
	user.getOauthConfig = () => oauth;
	user.getBaseLocation = (path) => path || '/';
	user.oidc_logout_ticket_secret = 'test-ticket-secret';
	user.oidc_logout_ticket_replay = new Set();
	user.server = { config: { get: (key) => key === 'secret_key' ? 'test-ticket-secret' : undefined } };
	user.logDebug = (...args) => logs.push(JSON.stringify(args));
	user.logError = (...args) => logs.push(JSON.stringify(args));
	user.logTransaction = (...args) => logs.push(JSON.stringify(args));
	storage.addRecordType('oidc_session', { delete: user.deleteExpiredOidcSession.bind(user) });
	return { user, storage, logs };
}

function call(object, method, ...args) {
	return new Promise((resolve, reject) => {
		object[method](...args, (err, value) => err ? reject(err) : resolve(value));
	});
}

function makeSession(id, issuer, subject, sid) {
	const session = {
		id,
		username: 'alice',
		auth_provider: 'oidc',
		oidc_issuer: issuer,
		oidc_subject: subject,
		oidc_client_id: 'cronicle-edge',
		expires: Math.floor(Date.now() / 1000) + 3600
	};
	if (sid) session.oidc_sid = sid;
	return session;
}

function invokeBackchannel(user, token, overrides) {
	overrides = overrides || {};
	return new Promise((resolve) => {
		const args = {
			request: {
				method: overrides.method || 'POST',
				headers: {
					'content-type': overrides.contentType || 'application/x-www-form-urlencoded',
					'content-length': String(overrides.contentLength || Buffer.byteLength('logout_token=' + token))
				}
			},
			params: { logout_token: '[REDACTED]' },
			query: {},
			cookies: {},
			_oidc_secrets: { logout_token: token }
		};
		user.api_oidc_backchannel_logout(args, function(first, headers, body) {
			if (typeof first === 'string') {
				return resolve({ status: Number(first.split(' ')[0]), headers: headers || {}, body: body ? JSON.parse(body) : null });
			}
			resolve({ status: 200, headers: {}, body: first });
		});
	});
}

function invokeLocalLogout(user, sessionId) {
	return new Promise((resolve) => {
		user.api_logout({
			request: { headers: { 'user-agent': 'test' } },
			response: { setHeader: function() {} },
			params: {}, query: {}, cookies: {}, ip: '127.0.0.1',
			_oidc_secrets: { session_id: sessionId }
		}, resolve);
	});
}

function recordExists(storage, key) { return storage.records.has(key); }

test('RP logout is disabled by default', () => {
	assert.equal(OIDC.buildOidcLogoutLocation({ client_id: 'client' }, {}), null);
});

test('RP logout builds a configuration-only URL without an ID Token hint', () => {
	const oauth = {
		client_id: 'cronicle-edge',
		logout: {
			enabled: true,
			end_session_url: 'https://idp.example/logout?existing=1',
			post_logout_redirect_uri: 'https://cron.example/',
			params: { ui_locales: 'pl', post_logout_redirect_uri: 'https://attacker.example/' }
		}
	};
	const url = new URL(OIDC.buildOidcLogoutLocation(oauth, {}));
	assert.equal(url.origin, 'https://idp.example');
	assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://cron.example/');
	assert.equal(url.searchParams.get('client_id'), 'cronicle-edge');
	assert.equal(url.searchParams.get('id_token_hint'), null);
	assert.equal(url.searchParams.get('ui_locales'), 'pl');
});

test('RP logout automatically includes a verified server-side ID Token hint', () => {
	const oauth = {
		client_id: 'cronicle-edge',
		issuer: 'https://idp.example/',
		jwks_url: 'https://idp.example/jwks',
		logout: { enabled: true, end_session_url: 'https://idp.example/logout' }
	};
	const encrypted = OIDC.encryptOidcSessionToken('signed.id.token', 'session-secret');
	const session = {
		auth_provider: 'oidc', oidc_issuer: oauth.issuer,
		oidc_client_id: oauth.client_id, oidc_id_token_hint_enc: encrypted
	};
	const url = new URL(OIDC.buildOidcLogoutLocation(oauth, session, 'session-secret'));
	assert.equal(url.searchParams.get('id_token_hint'), 'signed.id.token');
	assert.equal(url.searchParams.get('client_id'), null);
	assert.throws(() => OIDC.buildOidcLogoutLocation(Object.assign({}, oauth, { client_id: 'other-client' }),
		session, 'session-secret'), /does not match/);
	assert.throws(() => OIDC.buildOidcLogoutLocation(Object.assign({}, oauth, { issuer: 'https://other.example/' }),
		session, 'session-secret'), /does not match/);
});

test('RP logout never silently falls back for an OIDC session without an ID Token hint', () => {
	const oauth = {
		client_id: 'cronicle-edge',
		logout: {
			enabled: true,
			end_session_url: 'https://idp.example/logout',
			post_logout_redirect_uri: 'https://cron.example/'
		}
	};
	assert.throws(() => OIDC.buildOidcLogoutLocation(oauth, { auth_provider: 'oidc' }, 'session-secret'),
		/requires|does not contain a verified ID Token/);
});

test('Logout redirect tickets hide the ID Token and expire safely', () => {
	const destination = 'https://idp.example/logout?id_token_hint=secret.id.token';
	const ticket = OIDC.createOidcLogoutTicket(destination, 'ticket-secret', 60);
	assert.equal(ticket.includes('secret.id.token'), false);
	assert.equal(OIDC.consumeOidcLogoutTicket(ticket, 'ticket-secret').location, destination);
	assert.throws(() => OIDC.consumeOidcLogoutTicket(ticket, 'wrong-secret'));
});

test('RP logout rejects unsafe and request-controlled URLs', () => {
	assert.throws(() => OIDC.buildOidcLogoutLocation({ logout: {
		enabled: true, end_session_url: 'javascript:alert(1)'
	}}, {}), /HTTPS/);
	assert.throws(() => OIDC.buildOidcLogoutLocation({ logout: {
		enabled: true, end_session_url: 'http://idp.example/logout', allow_http_localhost: true
	}}, {}), /HTTPS/);
	assert.doesNotThrow(() => OIDC.buildOidcLogoutLocation({ logout: {
		enabled: true, end_session_url: 'http://127.0.0.1:9000/logout', allow_http_localhost: true
	}}, {}));
	const localhostRedirect = new URL(OIDC.buildOidcLogoutLocation({ client_id: 'client', logout: {
		enabled: true,
		end_session_url: 'https://idp.example/logout',
		post_logout_redirect_uri: 'http://127.0.0.1:3012',
		allow_http_localhost: true
	}}, {}));
	assert.equal(localhostRedirect.searchParams.get('post_logout_redirect_uri'), 'http://127.0.0.1:3012');
	const literalRedirect = new URL(OIDC.buildOidcLogoutLocation({ client_id: 'client', logout: {
		enabled: true,
		end_session_url: 'https://idp.example/logout',
		post_logout_redirect_uri: 'https://cron.example'
	}}, {}));
	assert.equal(literalRedirect.searchParams.get('post_logout_redirect_uri'), 'https://cron.example');
	assert.throws(() => OIDC.buildOidcLogoutLocation({ logout: {
		enabled: true,
		end_session_url: 'https://idp.example/logout',
		post_logout_redirect_uri: ' https://cron.example'
	}}, {}), /whitespace/);
});

test('OIDC provider allows localhost HTTP without disabling TLS verification', () => {
	const provider = OIDC.validateOidcProviderConfig({
		client_id: 'cronicle-edge',
		issuer: 'http://localhost:9000/application/o/cronicle/',
		jwks_url: 'http://127.0.0.1:9000/application/o/cronicle/jwks/',
		insecure: false,
		allow_http_localhost: true
	});
	assert.equal(provider.issuer, 'http://localhost:9000/application/o/cronicle/');
	assert.throws(() => OIDC.validateOidcProviderConfig({
		client_id: 'cronicle-edge',
		issuer: 'http://idp.example/application/o/cronicle/',
		jwks_url: 'http://idp.example/application/o/cronicle/jwks/',
		insecure: false,
		allow_http_localhost: true
	}), /HTTPS/);
});

test('OIDC session metadata is minimal and validates subject consistency', () => {
	const oauth = {
		client_id: 'cronicle-edge', issuer: 'https://idp.example/realm', jwks_url: 'https://idp.example/jwks',
		logout: { enabled: true }
	};
	const metadata = OIDC.buildOidcSessionMetadata(oauth, { sub: 'alice-id', sid: 'sid-1' }, { sub: 'alice-id' },
		'id.token', 'session-secret');
	assert.equal(metadata.auth_provider, 'oidc');
	assert.equal(metadata.oidc_issuer, 'https://idp.example/realm');
	assert.equal(metadata.oidc_subject, 'alice-id');
	assert.equal(metadata.oidc_client_id, 'cronicle-edge');
	assert.equal(metadata.oidc_sid, 'sid-1');
	assert.equal(OIDC.decryptOidcSessionToken(metadata.oidc_id_token_hint_enc, 'session-secret'), 'id.token');
	assert.equal(JSON.stringify(metadata).includes('id.token'), false);
	assert.equal(metadata.access_token, undefined);
	assert.equal(metadata.refresh_token, undefined);
	assert.throws(() => OIDC.buildOidcSessionMetadata(oauth, { sub: 'one' }, { sub: 'two' }, 'id.token', 'session-secret'), /does not match/);
	assert.throws(() => OIDC.buildOidcSessionMetadata(oauth, { sub: 'alice-id' }, { sub: 'alice-id' }, null,
		'session-secret'), /requires a verified ID Token/);
});

let jose;
let key1;
let key2;
let jwk1;
let jwk2;
let jwks = [];
let jwksServer;
let oauth;

before(async () => {
	jose = await import('jose');
	key1 = await jose.generateKeyPair('RS256', { extractable: true });
	key2 = await jose.generateKeyPair('RS256', { extractable: true });
	jwk1 = Object.assign(await jose.exportJWK(key1.publicKey), { kid: 'key-1', alg: 'RS256', use: 'sig' });
	jwk2 = Object.assign(await jose.exportJWK(key2.publicKey), { kid: 'key-2', alg: 'RS256', use: 'sig' });
	jwks = [jwk1];
	jwksServer = http.createServer((req, res) => {
		if (req.url !== '/jwks') { res.writeHead(404); return res.end(); }
		res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		res.end(JSON.stringify({ keys: jwks }));
	});
	await new Promise((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
	const address = jwksServer.address();
	oauth = {
		enabled: true,
		client_id: 'cronicle-edge',
		issuer: `http://127.0.0.1:${address.port}/issuer`,
		jwks_url: `http://127.0.0.1:${address.port}/jwks`,
		insecure: false,
		allow_http_localhost: true,
		allowed_algs: ['RS256'],
		jwks_cooldown_seconds: 0,
		clock_tolerance_seconds: 1,
		backchannel_logout: { enabled: true, max_token_age_seconds: 300, max_token_size: 16384 }
	};
});

after(async () => {
	await new Promise((resolve) => jwksServer.close(resolve));
});

async function logoutToken(overrides, signingKey, kid) {
	const now = Math.floor(Date.now() / 1000);
	const values = Object.assign({
		iss: oauth.issuer,
		aud: oauth.client_id,
		iat: now,
		exp: now + 300,
		jti: 'jti-' + Math.random(),
		events: { [OIDC.OIDC_BACKCHANNEL_EVENT]: {} },
		sid: 'sid-1'
	}, overrides || {});
	return new jose.SignJWT(values)
		.setProtectedHeader({ alg: 'RS256', kid: kid || 'key-1' })
		.sign((signingKey || key1).privateKey);
}

test('Verified ID Tokens require iat, audience, subject, and the login nonce', async () => {
	OIDC.resetOidcCachesForTests();
	const now = Math.floor(Date.now() / 1000);
	const token = await new jose.SignJWT({
		iss: oauth.issuer, aud: oauth.client_id, sub: 'subject-id', iat: now, exp: now + 300, nonce: 'login-nonce'
	}).setProtectedHeader({ alg: 'RS256', kid: 'key-1' }).sign(key1.privateKey);
	await assert.doesNotReject(OIDC.verifyOidcIdToken(token, oauth, 'login-nonce'));
	await assert.rejects(OIDC.verifyOidcIdToken(token, oauth, 'wrong-nonce'), /nonce/);
});

test('Back-channel JWT validation accepts a valid token and rejects invalid claims', async () => {
	OIDC.resetOidcCachesForTests();
	await assert.doesNotReject(OIDC.verifyOidcLogoutToken(await logoutToken(), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ iss: 'https://wrong.example' }), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ aud: 'wrong-client' }), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ events: {} }), oauth), /events/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ nonce: 'forbidden' }), oauth), /nonce/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ iat: Math.floor(Date.now() / 1000) - 600 }), oauth), /iat/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ exp: Math.floor(Date.now() / 1000) - 10 }), oauth));
	await assert.doesNotReject(OIDC.verifyOidcLogoutToken(await logoutToken({ exp: undefined }), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: undefined, sub: undefined }), oauth), /sid or sub/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: 123, sub: 'subject-id' }), oauth), /sid/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: 'sid-1', sub: 123 }), oauth), /subject/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: undefined, sub: 'ę' }), oauth), /subject/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ aud: [oauth.client_id, 'other'] }), oauth), /audience/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({
		aud: [oauth.client_id, 'other'], azp: 'other'
	}), oauth), /audience/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({
		aud: [oauth.client_id, 'other'], azp: oauth.client_id
	}), oauth), /audience/);
	await assert.doesNotReject(OIDC.verifyOidcLogoutToken(await logoutToken({ aud: [oauth.client_id] }), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: 'ę' }), oauth), /sid/);
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({ sid: 'line\nbreak' }), oauth), /sid/);
});

test('Back-channel JWT validation rejects bad signatures and unknown keys', async () => {
	OIDC.resetOidcCachesForTests();
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({}, key2, 'key-1'), oauth));
	await assert.rejects(OIDC.verifyOidcLogoutToken(await logoutToken({}, key2, 'unknown-key'), oauth));
});

test('Remote JWKS cache supports signing-key rotation', async () => {
	OIDC.resetOidcCachesForTests();
	jwks = [jwk1];
	await OIDC.verifyOidcLogoutToken(await logoutToken({ jti: 'rotation-1' }), oauth);
	jwks = [jwk2];
	await OIDC.verifyOidcLogoutToken(await logoutToken({ jti: 'rotation-2' }, key2, 'key-2'), oauth);
	jwks = [jwk1];
});

test('Session index covers sid and sub and is cleaned on local deletion', async () => {
	const { user, storage } = makeUser(oauth);
	const session = makeSession('session-1', oauth.issuer, 'subject-1', 'sid-1');
	await call(user, 'storeOidcSession', session);
	const sidKey = OIDC.getOidcIndexKey(oauth.issuer, 'sid', 'sid-1');
	const subKey = OIDC.getOidcIndexKey(oauth.issuer, 'sub', 'subject-1');
	assert.equal(storage.records.get(sidKey).sessions['session-1'], session.expires);
	assert.equal(storage.records.get(subKey).sessions['session-1'], session.expires);
	await call(user, 'deleteSessionRecord', session);
	assert.equal(recordExists(storage, 'sessions/session-1'), false);
	assert.equal(recordExists(storage, sidKey), false);
	assert.equal(recordExists(storage, subKey), false);
});

test('Expired OIDC sessions clean their index records', async () => {
	const { user, storage } = makeUser(oauth);
	const session = makeSession('session-expired', oauth.issuer, 'subject-expired', 'sid-expired');
	await call(user, 'storeOidcSession', session);
	await storage.expireNow('sessions/' + session.id);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sid', session.oidc_sid)), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sub', session.oidc_subject)), false);
});

test('Back-channel sid logout deletes only the matching session', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	await call(user, 'storeOidcSession', makeSession('sid-match', oauth.issuer, 'subject-1', 'sid-1'));
	await call(user, 'storeOidcSession', makeSession('sid-other', oauth.issuer, 'subject-1', 'sid-2'));
	const response = await invokeBackchannel(user, await logoutToken({ sid: 'sid-1', sub: 'subject-1' }));
	assert.equal(response.status, 200);
	assert.equal(response.headers['Cache-Control'], 'no-store');
	assert.equal(recordExists(storage, 'sessions/sid-match'), false);
	assert.equal(recordExists(storage, 'sessions/sid-other'), true);
});

test('Back-channel sub logout deletes all user sessions', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	await call(user, 'storeOidcSession', makeSession('sub-one', oauth.issuer, 'subject-all', 'sid-a'));
	await call(user, 'storeOidcSession', makeSession('sub-two', oauth.issuer, 'subject-all', 'sid-b'));
	const token = await logoutToken({ sid: undefined, sub: 'subject-all' });
	const response = await invokeBackchannel(user, token);
	assert.equal(response.status, 200);
	assert.equal(recordExists(storage, 'sessions/sub-one'), false);
	assert.equal(recordExists(storage, 'sessions/sub-two'), false);
});

test('Back-channel replay and unknown target are idempotent HTTP 200', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const session = makeSession('replay-session', oauth.issuer, 'subject-replay', 'sid-replay');
	await call(user, 'storeOidcSession', session);
	const token = await logoutToken({ sid: 'sid-replay', sub: undefined, jti: 'fixed-replay-jti' });
	assert.equal((await invokeBackchannel(user, token)).status, 200);
	assert.equal((await invokeBackchannel(user, token)).status, 200);
	assert.equal(recordExists(storage, 'sessions/replay-session'), false);
	assert.equal((await invokeBackchannel(user, await logoutToken({ sid: 'unknown-sid', sub: undefined }))).status, 200);
});

test('Back-channel logout without exp uses a finite replay and revocation window', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const now = Math.floor(Date.now() / 1000);
	const token = await logoutToken({ exp: undefined, sid: 'sid-no-exp', sub: undefined, jti: 'jti-no-exp' });
	assert.equal((await invokeBackchannel(user, token)).status, 200);

	const replayKey = OIDC.getOidcReplayKey(oauth.issuer, 'jti-no-exp');
	const markerKey = OIDC.getOidcRevocationKey(oauth.issuer, oauth.client_id, 'sid', 'sid-no-exp');
	[replayKey, markerKey].forEach(function(key) {
		const expires = storage.expirations.get(key);
		assert.equal(Number.isFinite(expires), true);
		assert.ok(expires > now && expires <= now + 310);
	});
});

test('Back-channel logout blocks a delayed callback from recreating the revoked session', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const token = await logoutToken({ sid: 'sid-delayed', sub: 'subject-delayed', jti: 'delayed-callback-jti' });
	const response = await invokeBackchannel(user, token);
	assert.equal(response.status, 200);

	const markerKey = OIDC.getOidcRevocationKey(oauth.issuer, oauth.client_id, 'sid', 'sid-delayed');
	assert.equal(recordExists(storage, markerKey), true);
	assert.ok(storage.expirations.get(markerKey) > Math.floor(Date.now() / 1000));

	const session = makeSession('delayed-session', oauth.issuer, 'subject-delayed', 'sid-delayed');
	await assert.rejects(call(user, 'storeOidcSession', session), /revoked before it could be stored/);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sid', session.oidc_sid)), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sub', session.oidc_subject)), false);
});

test('Concurrent callback and back-channel logout cannot leave an active session', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const session = makeSession('callback-race-session', oauth.issuer, 'subject-race', 'sid-race');
	const token = await logoutToken({ sid: 'sid-race', sub: 'subject-race', jti: 'callback-race-jti' });
	const results = await Promise.allSettled([
		call(user, 'storeOidcSession', session),
		invokeBackchannel(user, token)
	]);
	assert.equal(results[1].status, 'fulfilled');
	assert.equal(results[1].value.status, 200);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sid', session.oidc_sid)), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sub', session.oidc_subject)), false);
	assert.equal(recordExists(storage,
		OIDC.getOidcRevocationKey(oauth.issuer, oauth.client_id, 'sid', session.oidc_sid)), true);
});

test('Back-channel logout cannot be undone by an in-flight session resume', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const session = makeSession('resume-race-session', oauth.issuer, 'subject-resume', 'sid-resume');
	await call(user, 'storeOidcSession', session);

	user.config = { get: () => 30 };
	storage.config = { get: () => false };
	user.getClientInfo = () => ({});
	user.doError = (code, description, callback) => callback({ code: 1, description });
	user.loadSession = (args, callback) => callback(null, storage.clone(session), {
		username: 'alice', email: 'alice@example.test', full_name: 'Alice', active: 1
	});

	const token = await logoutToken({ sid: 'sid-resume', sub: 'subject-resume', jti: 'resume-race-jti' });
	let logoutResponse;
	user.fireHook = function(name, args, callback) {
		if (name !== 'before_resume_session') return callback && callback();
		invokeBackchannel(user, token).then(function(response) {
			logoutResponse = response;
			callback();
		}, callback);
	};

	const response = await new Promise((resolve) => user.api_resume_session({
		request: { headers: { 'user-agent': 'test' } }, params: {}, query: {}, cookies: {}, ip: '127.0.0.1',
		_oidc_secrets: { session_id: session.id }
	}, resolve));

	assert.equal(logoutResponse.status, 200);
	assert.equal(response.code, 1);
	assert.match(response.description, /revoked before it could be stored/);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sid', session.oidc_sid)), false);
});

test('Expired logout revocation markers do not block a later valid session', async () => {
	const { user, storage } = makeUser(oauth);
	const session = makeSession('post-expiry-session', oauth.issuer, 'subject-expiry', 'sid-expiry');
	const markerKey = OIDC.getOidcRevocationKey(oauth.issuer, oauth.client_id, 'sid', session.oidc_sid);
	await new Promise((resolve, reject) => storage.put(markerKey, {
		created: Math.floor(Date.now() / 1000) - 600,
		expires: Math.floor(Date.now() / 1000) - 1
	}, (err) => err ? reject(err) : resolve()));
	await call(user, 'storeOidcSession', session);
	assert.equal(recordExists(storage, markerKey), false);
	assert.equal(recordExists(storage, 'sessions/' + session.id), true);
});

test('Back-channel endpoint returns spec-compliant HTTP 400 errors', async () => {
	OIDC.resetOidcCachesForTests();
	const { user } = makeUser(oauth);
	const invalid = await invokeBackchannel(user, '');
	assert.equal(invalid.status, 400);
	assert.equal(invalid.body.error, 'invalid_request');
	assert.equal(invalid.headers['Cache-Control'], 'no-store');
	assert.equal((await invokeBackchannel(user, await logoutToken(), { contentType: 'application/json' })).status, 400);
	assert.equal((await invokeBackchannel(user, await logoutToken(), { method: 'GET' })).status, 400);
	assert.equal((await invokeBackchannel(user, 'x'.repeat(17000))).status, 400);
	assert.equal((await invokeBackchannel(user, await logoutToken(), { contentLength: 20000 })).status, 400);
});

test('Back-channel endpoint surfaces configuration, JWKS, and storage failures', async () => {
	OIDC.resetOidcCachesForTests();
	const misconfigured = Object.assign({}, oauth, { jwks_url: undefined });
	assert.equal((await invokeBackchannel(makeUser(misconfigured).user, await logoutToken())).status, 400);

	const unavailable = Object.assign({}, oauth, { jwks_url: 'http://127.0.0.1:1/jwks' });
	assert.equal((await invokeBackchannel(makeUser(unavailable).user, await logoutToken())).status, 400);

	OIDC.resetOidcCachesForTests();
	const { user, storage, logs } = makeUser(oauth);
	const originalPut = storage.put.bind(storage);
	storage.put = function(key, value, callback) {
		if (key.startsWith('oidc/logout_jti/')) return setImmediate(() => callback(new Error('simulated storage failure')));
		return originalPut(key, value, callback);
	};
	const token = await logoutToken({ sid: 'unknown-storage-target', jti: 'storage-failure-jti' });
	assert.equal((await invokeBackchannel(user, token)).status, 400);
	assert.equal(logs.join('\n').includes(token), false);
});

test('Concurrent local and back-channel logout leaves no session or index', async () => {
	OIDC.resetOidcCachesForTests();
	const { user, storage } = makeUser(oauth);
	const session = makeSession('concurrent-session', oauth.issuer, 'subject-concurrent', 'sid-concurrent');
	await call(user, 'storeOidcSession', session);
	const token = await logoutToken({ sid: 'sid-concurrent', sub: undefined, jti: 'concurrent-jti' });
	await Promise.all([
		call(user, 'deleteSessionRecord', session),
		invokeBackchannel(user, token)
	]);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sid', session.oidc_sid)), false);
	assert.equal(recordExists(storage, OIDC.getOidcIndexKey(oauth.issuer, 'sub', session.oidc_subject)), false);
});

test('Old sessions remain locally deletable and are ignored by OIDC indexes', async () => {
	const { user, storage } = makeUser(oauth);
	const oldSession = { id: 'old-session', username: 'alice', expires: Math.floor(Date.now() / 1000) + 300 };
	await new Promise((resolve, reject) => storage.put('sessions/' + oldSession.id, oldSession, (err) => err ? reject(err) : resolve()));
	await call(user, 'deleteSessionRecord', oldSession);
	assert.equal(recordExists(storage, 'sessions/' + oldSession.id), false);
	assert.equal([...storage.records.keys()].some((key) => key.startsWith('oidc/session_index/')), false);
});

test('Local logout remains unchanged when OIDC logout is disabled', async () => {
	const { user, storage } = makeUser(Object.assign({}, oauth, { logout: { enabled: false } }));
	const session = makeSession('local-only-session', oauth.issuer, 'subject-local', 'sid-local');
	await call(user, 'storeOidcSession', session);
	await new Promise((resolve, reject) => storage.put('users/alice', {
		username: 'alice', active: 1, email: 'a@example.com', full_name: 'Alice'
	}, (err) => err ? reject(err) : resolve()));
	const args = {
		request: { headers: { 'user-agent': 'test' } },
		response: { setHeader: () => {} },
		params: {}, query: {}, cookies: {}, ip: '127.0.0.1',
		_oidc_secrets: { session_id: session.id }
	};
	const response = await new Promise((resolve) => user.api_logout(args, resolve));
	assert.equal(response.code, 0);
	assert.equal(response.logout_location, undefined);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
});

test('Password sessions never trigger the configured OIDC logout', async () => {
	const rpOauth = Object.assign({}, oauth, {
		logout: {
			enabled: true,
			end_session_url: 'https://idp.example/logout',
			post_logout_redirect_uri: 'https://cron.example/'
		}
	});
	const { user, storage } = makeUser(rpOauth);
	const session = {
		id: 'password-session', username: 'alice',
		expires: Math.floor(Date.now() / 1000) + 3600
	};
	await new Promise((resolve, reject) => storage.put('sessions/' + session.id, session,
		(err) => err ? reject(err) : resolve()));
	await new Promise((resolve, reject) => storage.put('users/alice', {
		username: 'alice', active: 1, email: 'a@example.com', full_name: 'Alice'
	}, (err) => err ? reject(err) : resolve()));
	const args = {
		request: { headers: { 'user-agent': 'test' } }, response: { setHeader: () => {} },
		params: {}, query: {}, cookies: {}, ip: '127.0.0.1',
		_oidc_secrets: { session_id: session.id }
	};
	const response = await new Promise((resolve) => user.api_logout(args, resolve));
	assert.equal(response.code, 0);
	assert.equal(response.logout_location, undefined);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
});

test('RP logout does not send an ID Token to a different configured provider', async () => {
	const rpOauth = Object.assign({}, oauth, {
		logout: { enabled: true, end_session_url: 'https://idp.example/logout' }
	});
	const { user, storage } = makeUser(rpOauth);
	const session = Object.assign(makeSession('old-provider-session', 'https://old-idp.example/', 'subject-old', 'sid-old'), {
		oidc_id_token_hint_enc: OIDC.encryptOidcSessionToken('old.id.token', 'test-ticket-secret')
	});
	await call(user, 'storeOidcSession', session);
	await new Promise((resolve, reject) => storage.put('users/alice', {
		username: 'alice', active: 1, email: 'a@example.com', full_name: 'Alice'
	}, (err) => err ? reject(err) : resolve()));
	const response = await invokeLocalLogout(user, session.id);
	assert.equal(response.code, 0);
	assert.equal(response.logout_location, undefined);
	assert.match(response.logout_warning, /Local logout succeeded/);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
});

test('RP logout deletes local state before returning an unreachable IdP URL', async () => {
	const rpOauth = Object.assign({}, oauth, {
		logout: {
			enabled: true,
			end_session_url: 'https://127.0.0.1:9/logout',
			post_logout_redirect_uri: 'https://cron.example/'
		}
	});
	const { user, storage, logs } = makeUser(rpOauth);
	const session = Object.assign(makeSession('rp-session', oauth.issuer, 'subject-rp', 'sid-rp'), {
		oidc_id_token_hint_enc: OIDC.encryptOidcSessionToken('secret.id.token', 'test-ticket-secret')
	});
	await call(user, 'storeOidcSession', session);
	assert.equal(JSON.stringify(storage.records.get('sessions/' + session.id)).includes('secret.id.token'), false);
	await new Promise((resolve, reject) => storage.put('users/alice', {
		username: 'alice', active: 1, email: 'a@example.com', full_name: 'Alice'
	}, (err) => err ? reject(err) : resolve()));
	const headers = {};
	const args = {
		request: { headers: { 'user-agent': 'test', cookie: '[REDACTED]' } },
		response: { setHeader: (name, value) => { headers[name] = value; } },
		params: {
			end_session_url: 'https://attacker.example/logout',
			post_logout_redirect_uri: 'https://attacker.example/'
		}, query: { logout_location: 'https://attacker.example/' }, cookies: {}, ip: '127.0.0.1',
		_oidc_secrets: { session_id: session.id }
	};
	const response = await new Promise((resolve) => user.api_logout(args, resolve));
	assert.equal(response.code, 0);
	assert.match(response.logout_location, /^\/api\/user\/oidc_logout_redirect\?ticket=/);
	assert.equal(response.logout_location.includes('secret.id.token'), false);
	const ticket = new URL(response.logout_location, 'https://cron.example').searchParams.get('ticket');
	const destination = OIDC.consumeOidcLogoutTicket(ticket, 'test-ticket-secret').location;
	assert.match(destination, /^https:\/\/127\.0\.0\.1:9\/logout/);
	assert.equal(destination.includes('attacker.example'), false);
	assert.equal(recordExists(storage, 'sessions/' + session.id), false);
	assert.match(headers['Set-Cookie'], /Max-Age=0/);
	assert.equal(logs.join('\n').includes('secret.id.token'), false);
});

test('Backend logout_location consumes its ticket once and redirects to the configured IdP', async () => {
	const { user } = makeUser(oauth);
	const destination = 'https://idp.example/logout?id_token_hint=secret.id.token';
	const ticket = OIDC.createOidcLogoutTicket(destination, 'test-ticket-secret', 60);
	let redirect;
	const args = {
		request: { method: 'GET', url: '/api/user/oidc_logout_redirect?ticket=' + ticket, headers: {} },
		response: {
			writeHead: (status, headers) => { redirect = { status, headers }; },
			end: () => {}
		},
		params: {}, query: { ticket }, cookies: {}
	};
	const first = await new Promise((resolve) => user.filterOidcRequest(args, (...values) => resolve(values)));
	assert.deepEqual(first, [true]);
	assert.equal(redirect.status, 302);
	assert.equal(redirect.headers.Location, destination);
	assert.equal(JSON.stringify(args).includes('secret.id.token'), false);

	const replayArgs = {
		request: { method: 'GET', url: '/api/user/oidc_logout_redirect?ticket=' + ticket, headers: {} },
		response: { writeHead: () => {}, end: () => {} }, params: {}, query: { ticket }, cookies: {}
	};
	const replay = await new Promise((resolve) => user.filterOidcRequest(replayArgs, (...values) => resolve(values)));
	assert.equal(replay[0], '400 Bad Request');
});

test('Sensitive OIDC request values are redacted before request logging', async () => {
	const { user } = makeUser(oauth);
	const args = {
		request: { url: '/api/user/oidc_backchannel_logout', headers: { authorization: 'Bearer secret' } },
		params: { logout_token: 'very.secret.jwt' }, query: {}, cookies: { session_id: 'cookie-secret' }
	};
	await new Promise((resolve) => user.filterOidcRequest(args, () => resolve()));
	assert.equal(args.params.logout_token, '[REDACTED]');
	assert.equal(args.request.headers.authorization, '[REDACTED]');
	assert.equal(args.cookies.session_id, '[REDACTED]');
	assert.equal(args._oidc_secrets.logout_token, 'very.secret.jwt');
	assert.equal(JSON.stringify(args).includes('very.secret.jwt'), false);
});

test('OAuth callback URL and authentication headers are redacted before webserver logging', () => {
	const user = Object.create(User.prototype);
	let captured;
	user.web = {
		enqueueHTTPRequest: (request) => { captured = request; }
	};
	user.installOidcEarlyRedaction();
	const request = {
		url: '/base/api/user/callback?code=authorization-code&state=state-value',
		headers: {
			cookie: 'session_id=session-secret; other=value',
			'cf-access-jwt-assertion': 'cloudflare-jwt'
		}
	};
	user.web.enqueueHTTPRequest(request, {});
	assert.equal(captured.url.includes('authorization-code'), false);
	assert.equal(captured.url.includes('state-value'), false);
	assert.equal(captured.headers.cookie, '[REDACTED]');
	assert.equal(captured.headers['cf-access-jwt-assertion'], '[REDACTED]');
	assert.deepEqual(captured._oidc_early_secrets, {
		code: 'authorization-code', state: 'state-value', session_id: 'session-secret'
	});
	assert.equal(JSON.stringify(captured).includes('authorization-code'), false);
	const filterArgs = { request: captured, params: {}, query: { code: '[REDACTED]', state: '[REDACTED]' }, cookies: {} };
	user.filterOidcRequest(filterArgs, () => {});
	assert.equal(filterArgs._oidc_secrets.code, 'authorization-code');
	assert.equal(filterArgs._oidc_secrets.state, 'state-value');
});

test('Config Viewer redacts nested secrets and tokens even in debug mode', () => {
	const admin = Object.create(Admin.prototype);
	const config = {
		debug: true,
		secret_key: 'server-secret',
		oauth: { client_secret: 'client-secret', token_url: 'https://idp.example/token', params: { access_token: 'access' } },
		Storage: { SQL: { connection: { password: 'db-secret' } } }
	};
	admin.redactConfigSecrets(config);
	assert.equal(config.secret_key, '[REDACTED]');
	assert.equal(config.oauth.client_secret, '[REDACTED]');
	assert.equal(config.oauth.params.access_token, '[REDACTED]');
	assert.equal(config.Storage.SQL.connection.password, '[REDACTED]');
	assert.equal(config.oauth.token_url, 'https://idp.example/token');
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
