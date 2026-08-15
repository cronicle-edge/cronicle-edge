// Cronicle OpenID Connect Layer
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const crypto = require('crypto');
const Class = require('pixl-class');
const Tools = require('pixl-tools');

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const DEFAULT_ALGORITHMS = ['RS256'];

let josePromise;
const remoteJwks = new Map();

function getJose() {
	// Load the ESM-only jose package once from this CommonJS module.
	if (!josePromise) josePromise = import('jose');
	return josePromise;
}

function isLocalhost(hostname) {
	// Keep the HTTP development exception limited to the local machine.
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function parseSecureUrl(value, name, allowHttpLocalhost) {
	// Reject credentials and plaintext remote endpoints; localhost HTTP is opt-in for testing.
	if (!value || typeof value !== 'string') throw new Error(name + ' must be an absolute URL');

	let url;
	try { url = new URL(value); }
	catch (err) { throw new Error(name + ' must be an absolute URL'); }

	if (url.username || url.password) throw new Error(name + ' must not contain credentials');
	if (url.protocol === 'https:') return url;
	if (url.protocol === 'http:' && allowHttpLocalhost && isLocalhost(url.hostname)) return url;
	throw new Error(name + ' must use HTTPS (HTTP is only allowed for localhost when explicitly enabled)');
}

function getAlgorithms(oauth) {
	// Normalize the configured asymmetric JWT signature allowlist.
	const configured = oauth.allowed_algs || oauth.algorithms || DEFAULT_ALGORITHMS;
	const algorithms = Array.isArray(configured) ? configured.slice() : [configured];
	if (!algorithms.length || algorithms.some((alg) => typeof alg !== 'string' || !/^(?:RS|PS|ES)\d{3}$/.test(alg))) {
		throw new Error('oauth.allowed_algs must contain asymmetric signing algorithms');
	}
	return algorithms;
}

function validateProviderConfig(oauth) {
	// Normalize the provider identity and JWT verification policy in one place.
	if (!oauth || typeof oauth !== 'object') throw new Error('OAuth is not configured');
	if (!oauth.client_id || typeof oauth.client_id !== 'string') throw new Error('oauth.client_id is required');
	if (!oauth.issuer || typeof oauth.issuer !== 'string') throw new Error('oauth.issuer is required');
	if (!oauth.jwks_url || typeof oauth.jwks_url !== 'string') throw new Error('oauth.jwks_url is required');

	const allowHttpLocalhost = !!oauth.allow_http_localhost;
	const issuerUrl = parseSecureUrl(oauth.issuer, 'oauth.issuer', allowHttpLocalhost);
	if (issuerUrl.search || issuerUrl.hash) throw new Error('oauth.issuer must not contain query or fragment components');
	const issuer = oauth.issuer.trim();
	const jwksUrl = parseSecureUrl(oauth.jwks_url, 'oauth.jwks_url', allowHttpLocalhost);

	const configuredTolerance = Number(oauth.clock_tolerance_seconds);
	const configuredCooldown = Number(oauth.jwks_cooldown_seconds);
	return {
		issuer,
		jwksUrl,
		clientId: oauth.client_id,
		algorithms: getAlgorithms(oauth),
		clockTolerance: Number.isFinite(configuredTolerance) ? Math.max(0, configuredTolerance) : 5,
		jwksCooldown: (Number.isFinite(configuredCooldown) ? Math.max(0, configuredCooldown) : 30) * 1000
	};
}

async function getRemoteJwkSet(provider) {
	// Reuse remote key sets while rejecting redirects to an unexpected JWKS endpoint.
	const jose = await getJose();
	const key = provider.jwksUrl.toString() + '|' + provider.jwksCooldown;
	if (!remoteJwks.has(key)) {
		remoteJwks.set(key, jose.createRemoteJWKSet(provider.jwksUrl, {
			cooldownDuration: provider.jwksCooldown,
			[jose.customFetch]: function(url, options) {
				return fetch(url, Object.assign({}, options, { redirect: 'error' }));
			}
		}));
	}
	return remoteJwks.get(key);
}

async function verifyJwt(token, oauth, options) {
	// Apply the shared issuer, audience, signature, and time-claim policy.
	const provider = validateProviderConfig(oauth);
	const jose = await getJose();
	const jwks = await getRemoteJwkSet(provider);
	const result = await jose.jwtVerify(token, jwks, {
		algorithms: provider.algorithms,
		issuer: provider.issuer,
		audience: provider.clientId,
		clockTolerance: provider.clockTolerance,
		requiredClaims: options.requiredClaims
	});
	return { payload: result.payload, protectedHeader: result.protectedHeader, provider };
}

async function verifyIdToken(token, oauth, expectedNonce) {
	// Bind the provider identity to the browser login nonce before creating a session.
	if (!token || typeof token !== 'string') throw new Error('Missing ID Token');
	const result = await verifyJwt(token, oauth, { requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub'] });
	if (!isValidSubject(result.payload.sub)) throw new Error('Invalid ID Token subject');
	if (!Number.isFinite(result.payload.iat) || result.payload.iat > Math.floor(Date.now() / 1000) + result.provider.clockTolerance) {
		throw new Error('Invalid ID Token iat');
	}
	if (expectedNonce && result.payload.nonce !== expectedNonce) throw new Error('Invalid ID Token nonce');
	validateAudience(result.payload, result.provider, 'ID Token');
	return result;
}

function isValidSubject(subject) {
	// OIDC Subject Identifiers are non-empty ASCII strings of at most 255 characters.
	return typeof subject === 'string' && subject.length > 0 && subject.length <= 255 && !/[^\x00-\x7f]/.test(subject);
}

function validateAudience(payload, provider, name) {
	// No additional trusted audiences are configured, so every aud value must identify this client.
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audiences.length || audiences.some((audience) => audience !== provider.clientId)) {
		throw new Error(name + ' contains an untrusted audience');
	}
	if (Object.prototype.hasOwnProperty.call(payload, 'azp') && payload.azp !== provider.clientId) {
		throw new Error('Invalid ' + name + ' authorized party');
	}
}

async function verifyLogoutToken(token, oauth) {
	// Validate the signed claims required by OIDC Back-Channel Logout.
	const backchannel = oauth.backchannel_logout || {};
	const maxTokenSize = Math.max(1024, Number(backchannel.max_token_size) || 16384);
	if (!token || typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > maxTokenSize) {
		throw new Error('Invalid logout token size');
	}

	const result = await verifyJwt(token, oauth, {
		requiredClaims: ['iss', 'aud', 'iat', 'jti', 'events']
	});
	const payload = result.payload;
	const now = Math.floor(Date.now() / 1000);
	const maxAge = Math.max(1, Number(backchannel.max_token_age_seconds) || 300);
	const tolerance = result.provider.clockTolerance;

	if (!Number.isFinite(payload.iat) || payload.iat > now + tolerance || payload.iat < now - maxAge - tolerance) {
		throw new Error('Logout Token iat is outside the accepted window');
	}
	if (!payload.jti || typeof payload.jti !== 'string') throw new Error('Logout Token jti is required');
	validateAudience(payload, result.provider, 'Logout Token');
	if (Object.prototype.hasOwnProperty.call(payload, 'nonce')) throw new Error('Logout Token must not contain nonce');
	if (!payload.events || typeof payload.events !== 'object' || Array.isArray(payload.events) ||
		!Object.prototype.hasOwnProperty.call(payload.events, BACKCHANNEL_EVENT) ||
		typeof payload.events[BACKCHANNEL_EVENT] !== 'object' || payload.events[BACKCHANNEL_EVENT] === null ||
		Array.isArray(payload.events[BACKCHANNEL_EVENT])) {
		throw new Error('Logout Token events claim is invalid');
	}
	const hasSid = Object.prototype.hasOwnProperty.call(payload, 'sid');
	const hasSub = Object.prototype.hasOwnProperty.call(payload, 'sub');
	if (hasSid && (typeof payload.sid !== 'string' || !/^[\x20-\x7e]+$/.test(payload.sid))) {
		throw new Error('Logout Token sid is invalid');
	}
	if (hasSub && !isValidSubject(payload.sub)) throw new Error('Logout Token subject is invalid');
	if (!hasSid && !hasSub) {
		throw new Error('Logout Token must contain sid or sub');
	}

	// exp is optional; retain replay state only through the configured acceptance window.
	const replayWindowEnd = payload.iat + maxAge + tolerance;
	const tokenEnd = Number.isFinite(payload.exp) ? payload.exp + tolerance : replayWindowEnd;
	result.replayExpires = Math.max(now + 1, Math.min(tokenEnd, replayWindowEnd));

	return result;
}

function encryptSessionToken(token, secret) {
	// Encrypt the verified ID Token before persisting it for RP-initiated logout.
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
	return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptSessionToken(value, secret) {
	// Authenticate and decrypt an ID Token stored in the server-side session.
	const packed = Buffer.from(String(value), 'base64url');
	if (packed.length < 30 || packed[0] !== 1) throw new Error('Invalid encrypted ID Token');
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(1, 13));
	decipher.setAuthTag(packed.subarray(13, 29));
	return Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]).toString('utf8');
}

function buildSessionMetadata(oauth, idTokenClaims, userInfo, idToken, secret) {
	// Store only the provider identifiers needed for targeted revocation.
	userInfo = userInfo || {};
	const rpLogoutEnabled = !!((oauth.logout || {}).enabled);
	if (rpLogoutEnabled && (!idTokenClaims || !idToken)) {
		throw new Error('OIDC RP-initiated logout requires a verified ID Token');
	}
	if (idTokenClaims && userInfo.sub && idTokenClaims.sub !== userInfo.sub) {
		throw new Error('OIDC UserInfo subject does not match the ID Token subject');
	}
	const subject = (idTokenClaims && idTokenClaims.sub) || userInfo.sub;
	if (!subject) return null;
	if (typeof subject !== 'string') throw new Error('OIDC subject must be a string');

	const provider = validateProviderConfig(oauth);
	const metadata = {
		auth_provider: 'oidc',
		oidc_issuer: provider.issuer,
		oidc_subject: subject,
		oidc_client_id: provider.clientId
	};
	if (idTokenClaims && typeof idTokenClaims.sid === 'string' && idTokenClaims.sid) metadata.oidc_sid = idTokenClaims.sid;
	if (rpLogoutEnabled) {
		metadata.oidc_id_token_hint_enc = encryptSessionToken(idToken, secret);
	}
	return metadata;
}

function buildLogoutLocation(oauth, session, secret) {
	// Build the provider logout URL without allowing reserved parameters to be overridden.
	const logout = (oauth && oauth.logout) || {};
	if (!logout.enabled) return null;

	const allowHttpLocalhost = !!logout.allow_http_localhost;
	const url = parseSecureUrl(logout.end_session_url, 'oauth.logout.end_session_url', allowHttpLocalhost);
	const reserved = new Set(['id_token_hint', 'post_logout_redirect_uri', 'client_id']);
	reserved.forEach((key) => url.searchParams.delete(key));

	if (logout.params !== undefined) {
		if (!logout.params || typeof logout.params !== 'object' || Array.isArray(logout.params)) {
			throw new Error('oauth.logout.params must be an object');
		}
		Object.keys(logout.params).forEach((key) => {
			const value = logout.params[key];
			if (reserved.has(key) || value === undefined || value === null) return;
			if (!['string', 'number', 'boolean'].includes(typeof value)) {
				throw new Error('oauth.logout.params values must be scalar');
			}
			url.searchParams.set(key, String(value));
		});
	}

	if (logout.post_logout_redirect_uri) {
		const redirectUri = logout.post_logout_redirect_uri;
		if (typeof redirectUri !== 'string') throw new Error('oauth.logout.post_logout_redirect_uri must be an absolute URL');
		if (redirectUri !== redirectUri.trim()) throw new Error('oauth.logout.post_logout_redirect_uri must not contain whitespace');
		parseSecureUrl(
			redirectUri,
			'oauth.logout.post_logout_redirect_uri',
			allowHttpLocalhost
		);
		url.searchParams.set('post_logout_redirect_uri', redirectUri);
	}

	if (session && session.oidc_id_token_hint_enc) {
		const provider = validateProviderConfig(oauth);
		if (session.auth_provider !== 'oidc' || session.oidc_issuer !== provider.issuer ||
			session.oidc_client_id !== provider.clientId) {
			throw new Error('OIDC session does not match the configured provider');
		}
		url.searchParams.set('id_token_hint', decryptSessionToken(session.oidc_id_token_hint_enc, secret));
	}
	else if (session && session.auth_provider === 'oidc') {
		throw new Error('OIDC session does not contain a verified ID Token for RP-initiated logout');
	}
	else if (logout.post_logout_redirect_uri && oauth.client_id) {
		url.searchParams.set('client_id', oauth.client_id);
	}

	return url.toString();
}

function indexKey(issuer, claimType, claimValue) {
	// Hash external identifiers before using them in storage paths.
	const digest = crypto.createHash('sha256').update(issuer + '\0' + claimType + '\0' + claimValue).digest('hex');
	return 'oidc/session_index/' + claimType + '/' + digest;
}

function replayKey(issuer, jti) {
	// Keep raw provider token identifiers out of storage paths.
	const digest = crypto.createHash('sha256').update(issuer + '\0' + jti).digest('hex');
	return 'oidc/logout_jti/' + digest;
}

function revocationKey(issuer, clientId, claimType, claimValue) {
	// Bind callback barriers to one provider, client, and sid/sub identity.
	const digest = crypto.createHash('sha256').update(
		issuer + '\0' + clientId + '\0' + claimType + '\0' + claimValue
	).digest('hex');
	return 'oidc/logout_revocation/' + claimType + '/' + digest;
}

function createLogoutTicket(location, secret, ttlSeconds) {
	// Keep the ID Token inside a short-lived authenticated redirect ticket.
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const payload = Buffer.from(JSON.stringify({
		location,
		exp: Math.floor(Date.now() / 1000) + Math.max(10, Number(ttlSeconds) || 60),
		jti: crypto.randomBytes(16).toString('hex')
	}), 'utf8');
	const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString('base64url');
}

function consumeLogoutTicket(ticket, secret) {
	// Authenticate, decrypt, and expire the same-origin redirect ticket.
	if (!ticket || typeof ticket !== 'string' || ticket.length > 16384) throw new Error('Invalid logout ticket');
	const packed = Buffer.from(ticket, 'base64url');
	if (packed.length < 30 || packed[0] !== 1) throw new Error('Invalid logout ticket');
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const iv = packed.subarray(1, 13);
	const tag = packed.subarray(13, 29);
	const encrypted = packed.subarray(29);
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	const payload = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
	if (!payload.location || !payload.jti || !Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) {
		throw new Error('Expired or invalid logout ticket');
	}
	return payload;
}

module.exports = Class.create({

	OIDC_BACKCHANNEL_EVENT: BACKCHANNEL_EVENT,
	buildOidcSessionMetadata: buildSessionMetadata,
	buildOidcLogoutLocation: buildLogoutLocation,
	consumeOidcLogoutTicket: consumeLogoutTicket,
	createOidcLogoutTicket: createLogoutTicket,
	decryptOidcSessionToken: decryptSessionToken,
	encryptOidcSessionToken: encryptSessionToken,
	getOidcIndexKey: indexKey,
	parseOidcSecureUrl: parseSecureUrl,
	getOidcReplayKey: replayKey,
	getOidcRevocationKey: revocationKey,
	validateOidcProviderConfig: validateProviderConfig,
	verifyOidcIdToken: verifyIdToken,
	verifyOidcLogoutToken: verifyLogoutToken,

	resetOidcCachesForTests: function() {
		remoteJwks.clear();
		josePromise = null;
	},

	setupOidc: function() {
		// Register OIDC storage cleanup and redact credentials before request logging.
		const self = this;
		this.storage.addRecordType('oidc_session', {
			'delete': this.deleteExpiredOidcSession.bind(this)
		});
		this.installOidcEarlyRedaction();
		this.web.addURIFilter(/\/api\/user\/(?:oauth|callback|logout|oidc_logout_redirect|oidc_backchannel_logout)(?:\?|$)/,
			'OIDC Secret Filter', this.filterOidcRequest.bind(this));
		this.oidc_logout_ticket_secret = Tools.generateUniqueID(64);
		this.oidc_logout_ticket_replay = new Set();
		this.server.on('day', function() { self.oidc_logout_ticket_replay.clear(); });
	},

	installOidcEarlyRedaction: function() {
		// Remove OIDC credentials before raw request and API debug logging.
		const web = this.web;
		if (web._oidcEarlyRedactionInstalled) return;
		web._oidcEarlyRedactionInstalled = true;
		const enqueue = web.enqueueHTTPRequest;
		const sensitivePath = /\/api\/user\/(?:oauth|callback|logout|oidc_logout_redirect|oidc_backchannel_logout)$/;

		web.enqueueHTTPRequest = function(request, response) {
			let parsed;
			try { parsed = new URL(request.url, 'http://localhost'); }
			catch (err) { return enqueue.call(web, request, response); }
			if (!sensitivePath.test(parsed.pathname)) return enqueue.call(web, request, response);

			const secrets = {};
			['code', 'state', 'session_id', 'ticket'].forEach(function(name) {
				if (!parsed.searchParams.has(name)) return;
				secrets[name] = parsed.searchParams.get(name);
				parsed.searchParams.set(name, '[REDACTED]');
			});
			request.url = parsed.pathname + parsed.search + parsed.hash;

			const headers = request.headers || {};
			if (headers['x-session-id']) secrets.session_id = headers['x-session-id'];
			if (headers.cookie) {
				const match = String(headers.cookie).match(/(?:^|;\s*)session_id=([^;]+)/);
				if (match && !secrets.session_id) {
					try { secrets.session_id = decodeURIComponent(match[1]); }
					catch (err) { secrets.session_id = match[1]; }
				}
			}
			['authorization', 'cookie', 'cf-access-jwt-assertion', 'x-api-key', 'x-session-id'].forEach(function(name) {
				if (headers[name]) headers[name] = '[REDACTED]';
			});
			Object.defineProperty(request, '_oidc_early_secrets', {
				value: secrets,
				enumerable: false,
				configurable: false
			});
			return enqueue.call(web, request, response);
		};
	},

	filterOidcRequest: function(args, callback) {
		// Recover redacted values in a non-enumerable bag for the handlers.
		const path = String(args.request.url || '').replace(/\?.*$/, '');
		const action = path.split('/').pop();
		const params = args.params || {};
		const query = args.query || {};
		const headers = args.request.headers || {};
		const cookies = args.cookies || {};
		const early = args.request._oidc_early_secrets || {};
		const secrets = {};

		if (action === 'callback') {
			secrets.code = early.code || params.code || query.code;
			secrets.state = early.state || params.state || query.state;
			if (params.code) params.code = '[REDACTED]';
			if (params.state) params.state = '[REDACTED]';
			if (query.code) query.code = '[REDACTED]';
			if (query.state) query.state = '[REDACTED]';
		}

		if (action === 'oidc_backchannel_logout') {
			secrets.logout_token = params.logout_token;
			if (Object.prototype.hasOwnProperty.call(params, 'logout_token')) params.logout_token = '[REDACTED]';
		}

		if (action === 'oidc_logout_redirect') {
			secrets.ticket = early.ticket || params.ticket || query.ticket;
			if (params.ticket) params.ticket = '[REDACTED]';
			if (query.ticket) query.ticket = '[REDACTED]';
		}

		if (action === 'oauth' || action === 'logout') {
			secrets.session_id = early.session_id || cookies.session_id || headers['x-session-id'] || params.session_id || query.session_id;
			if (cookies.session_id) cookies.session_id = '[REDACTED]';
			if (headers['x-session-id']) headers['x-session-id'] = '[REDACTED]';
			if (params.session_id) params.session_id = '[REDACTED]';
			if (query.session_id) query.session_id = '[REDACTED]';
		}

		['authorization', 'cookie', 'cf-access-jwt-assertion', 'x-api-key'].forEach((name) => {
			if (headers[name]) headers[name] = '[REDACTED]';
		});
		Object.keys(cookies).forEach((name) => { cookies[name] = '[REDACTED]'; });

		Object.defineProperty(args, '_oidc_secrets', {
			value: secrets,
			enumerable: false,
			configurable: false
		});

		if (action === 'oidc_logout_redirect') {
			if (args.request.method !== 'GET') {
				return callback('405 Method Not Allowed', { 'Content-Type': 'text/plain', 'Allow': 'GET', 'Cache-Control': 'no-store' },
					'Method not allowed.');
			}
			let payload;
			try {
				payload = this.consumeOidcLogoutTicket(secrets.ticket, this.getOidcLogoutTicketSecret());
				if (this.oidc_logout_ticket_replay.has(payload.jti)) throw new Error('Logout ticket was already used');
				this.parseOidcSecureUrl(payload.location, 'OIDC logout redirect', true);
				this.oidc_logout_ticket_replay.add(payload.jti);
			}
			catch (err) {
				this.logError('oauth', 'Invalid OIDC logout redirect ticket');
				return callback('400 Bad Request', { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
					'Invalid logout request.');
			}

			args.response.writeHead(302, {
				'Location': payload.location,
				'Cache-Control': 'no-store',
				'Referrer-Policy': 'no-referrer'
			});
			args.response.end();
			return callback(true);
		}
		callback(false);
	},

	getOidcLogoutTicketSecret: function() {
		// Prefer the persistent server secret so tickets survive only the intended process lifetime.
		return (this.server && this.server.config && this.server.config.get('secret_key')) ||
			this.oidc_logout_ticket_secret;
	},


	getOidcIndexEntries: function(session) {
		// Index OIDC sessions by sid and sub for targeted provider logout.
		if (!session || session.auth_provider !== 'oidc' || !session.oidc_issuer) return [];
		const entries = [];
		if (session.oidc_sid) entries.push({ type: 'sid', value: session.oidc_sid });
		if (session.oidc_subject) entries.push({ type: 'sub', value: session.oidc_subject });
		return entries;
	},

	withOidcRevocationLocks: function(keys, worker, callback) {
		// Stable lock ordering serializes callback storage with logout revocation.
		const self = this;
		keys = Array.from(new Set(keys)).sort();
		const acquired = [];
		let pos = 0;
		let released = false;

		const release = function(err, value) {
			if (released) return;
			released = true;
			while (acquired.length) self.storage.unlock('oidc-revocation-lock/' + acquired.pop());
			callback(err || null, value);
		};
		const acquire = function() {
			if (pos >= keys.length) {
				try { return worker(release); }
				catch (err) { return release(err); }
			}
			const key = keys[pos++];
			self.storage.lock('oidc-revocation-lock/' + key, true, function() {
				acquired.push(key);
				acquire();
			});
		};
		acquire();
	},

	findActiveOidcRevocation: function(keys, callback) {
		// Reject a delayed callback while a matching logout marker is active.
		const self = this;
		const now = Tools.timeNow(true);
		let pos = 0;
		const next = function(err) {
			if (err) return callback(err);
			if (pos >= keys.length) return callback(null, null);
			const key = keys[pos++];
			self.storage.get(key, function(getErr, marker) {
				if (getErr && self.isMissingStorageError(getErr)) return next();
				if (getErr) return callback(getErr);
				if (!marker || !Number.isFinite(marker.expires)) {
					return callback(new Error('Invalid OIDC logout revocation marker'));
				}
				if (marker.expires >= now) return callback(null, marker);
				self.storage.delete(key, function(deleteErr) {
					if (self.isMissingStorageError(deleteErr)) deleteErr = null;
					next(deleteErr);
				});
			});
		};
		next();
	},

	mutateOidcIndexKey: function(key, sessionId, expires, add, callback) {
		// Serialize each index read-modify-write operation.
		const self = this;
		const lockKey = 'oidc-index-lock/' + key;

		self.storage.lock(lockKey, true, function() {
			let finished = false;
			const finish = function(err) {
				if (finished) return;
				finished = true;
				self.storage.unlock(lockKey);
				callback(err || null);
			};

			self.storage.get(key, function(err, record) {
				if (err && !self.isMissingStorageError(err)) return finish(err);
				record = record || { sessions: {} };
				if (!record.sessions || typeof record.sessions !== 'object' || Array.isArray(record.sessions)) {
					return finish(new Error('Invalid OIDC session index record'));
				}

				if (add) record.sessions[sessionId] = expires || 0;
				else delete record.sessions[sessionId];

				if (!Object.keys(record.sessions).length) {
					if (err) return finish();
					return self.storage.delete(key, function(deleteErr) {
						if (self.isMissingStorageError(deleteErr)) deleteErr = null;
						finish(deleteErr);
					});
				}

				self.storage.put(key, record, finish);
			});
		});
	},

	updateOidcSessionIndexes: function(session, add, callback) {
		// Keep sid/sub indexes consistent, rolling back a partial update.
		const self = this;
		const entries = self.getOidcIndexEntries(session);
		let pos = 0;
		const completed = [];

		const next = function(err) {
			if (err) {
				if (!completed.length) return callback(err);
				let rollbackPos = completed.length - 1;
				let rollbackError = null;
				const rollback = function(currentError) {
					if (currentError && !rollbackError) rollbackError = currentError;
					if (rollbackPos < 0) {
						if (rollbackError) return callback(new Error(err.message + '; index rollback failed: ' + rollbackError.message));
						return callback(err);
					}
					const entry = completed[rollbackPos--];
					self.mutateOidcIndexKey(
						indexKey(session.oidc_issuer, entry.type, entry.value),
						session.id, session.expires, !add, rollback
					);
				};
				return rollback();
			}
			if (pos >= entries.length) return callback();
			const entry = entries[pos++];
			self.mutateOidcIndexKey(
				indexKey(session.oidc_issuer, entry.type, entry.value),
				session.id, session.expires, add,
				function(indexErr) {
					if (!indexErr) completed.push(entry);
					next(indexErr);
				}
			);
		};
		next();
	},

	storeOidcSession: function(session, callback) {
		// Store the session only when no matching back-channel marker exists.
		const self = this;
		session.type = 'oidc_session';
		const revocationKeys = self.getOidcIndexEntries(session).map(function(entry) {
			return revocationKey(session.oidc_issuer, session.oidc_client_id, entry.type, entry.value);
		});
		if (!session.oidc_client_id || !revocationKeys.length) {
			return callback(new Error('OIDC session is missing revocation identity metadata'));
		}
		self.withOidcRevocationLocks(revocationKeys, function(done) {
			self.findActiveOidcRevocation(revocationKeys, function(revocationErr, marker) {
				if (revocationErr) return done(revocationErr);
				if (marker) return done(new Error('OIDC session was revoked before it could be stored'));
				self.storage.put('sessions/' + session.id, session, function(err) {
					if (err) return done(err);
					self.updateOidcSessionIndexes(session, true, function(indexErr) {
						if (!indexErr) {
							self.storage.expire('sessions/' + session.id, session.expires);
							return done();
						}
						self.storage.delete('sessions/' + session.id, function(deleteErr) {
							done(indexErr || deleteErr);
						});
					});
				});
			});
		}, callback);
	},

	deleteExpiredOidcSession: function(key, session, callback) {
		// Called by pixl-server-storage maintenance for an expired custom record.
		this.deleteSessionRecord(session, callback);
	},

	processLogoutJti: function(issuer, jti, expires, worker, callback) {
		// Persist Logout Token jti values so provider retries are idempotent.
		const self = this;
		const key = replayKey(issuer, jti);
		const lockKey = 'oidc-replay-lock/' + key;
		self.storage.lock(lockKey, true, function() {
			const finish = function(err, replay) {
				self.storage.unlock(lockKey);
				callback(err || null, !!replay);
			};
			self.storage.get(key, function(err) {
				if (!err) return finish(null, true);
				if (!self.isMissingStorageError(err)) return finish(err);
				worker(function(workerErr) {
					if (workerErr) return finish(workerErr);
					self.storage.put(key, { created: Tools.timeNow(true), expires: expires }, function(putErr) {
						if (putErr) return finish(putErr);
						self.storage.expire(key, expires);
						finish(null, false);
					});
				});
			});
		});
	},

	revokeOidcSessionsForClaim: function(issuer, claimType, claimValue, clientId, expires, callback) {
		// Write the callback barrier before removing every indexed session.
		const self = this;
		const key = indexKey(issuer, claimType, claimValue);
		const markerKey = revocationKey(issuer, clientId, claimType, claimValue);
		self.withOidcRevocationLocks([markerKey], function(done) {
			self.storage.put(markerKey, { created: Tools.timeNow(true), expires: expires }, function(markerErr) {
				if (markerErr) return done(markerErr);
				self.storage.expire(markerKey, expires);
				self.storage.get(key, function(err, record) {
					if (err && self.isMissingStorageError(err)) return done(null, 0);
					if (err) return done(err);
					if (!record || !record.sessions || typeof record.sessions !== 'object') {
						return done(new Error('Invalid OIDC session index record'));
					}

					const ids = Object.keys(record.sessions);
					let pos = 0;
					let deleted = 0;
					const next = function(deleteErr) {
						if (deleteErr) return done(deleteErr);
						if (pos >= ids.length) return done(null, deleted);
						const id = ids[pos++];
						self.storage.get('sessions/' + id, function(sessionErr, session) {
							if (sessionErr && self.isMissingStorageError(sessionErr)) {
								return self.mutateOidcIndexKey(key, id, 0, false, next);
							}
							if (sessionErr) return next(sessionErr);
							const identityMatches = session.auth_provider === 'oidc' && session.oidc_issuer === issuer &&
								((claimType === 'sid' && session.oidc_sid === claimValue) ||
								(claimType === 'sub' && session.oidc_subject === claimValue));
							if (!identityMatches) return self.mutateOidcIndexKey(key, id, 0, false, next);
							if (session.oidc_client_id !== clientId) return next();
							self.deleteSessionRecord(session, function(removeErr) {
								if (!removeErr) deleted++;
								next(removeErr);
							});
						});
					};
					next();
				});
			});
		}, callback);
	},

	api_oidc_backchannel_logout: async function(args, callback) {
		// Validate one Logout Token and revoke the matching sid or sub sessions.
		const self = this;
		const badRequest = function(description) {
			callback('400 Bad Request', { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
				JSON.stringify({ error: 'invalid_request', error_description: description || 'Invalid logout request.' }));
		};

		if (args.request.method !== 'POST') return badRequest('The logout request must use POST.');
		if (!String(args.request.headers['content-type'] || '').match(/^application\/x-www-form-urlencoded(?:\s*;|$)/i)) {
			return badRequest();
		}

		const oauth = self.getOauthConfig();
		if (!oauth || !(oauth.backchannel_logout || {}).enabled) return badRequest();
		const maxTokenSize = Math.max(1024, Number(oauth.backchannel_logout.max_token_size) || 16384);
		const contentLength = Number(args.request.headers['content-length']);
		if (Number.isFinite(contentLength) && contentLength > maxTokenSize + 1024) return badRequest();

		try { self.validateOidcProviderConfig(oauth); }
		catch (configErr) {
			self.logError('oauth', 'OIDC back-channel logout is misconfigured: ' + configErr.message);
			return badRequest('OIDC logout is not configured correctly.');
		}

		const token = args._oidc_secrets && args._oidc_secrets.logout_token;
		let verified;
		try {
			verified = await self.verifyOidcLogoutToken(token, oauth);
		}
		catch (verifyErr) {
			const code = String(verifyErr.code || '');
			self.logError('oauth', 'OIDC back-channel logout validation failed: ' + (code || verifyErr.message));
			return badRequest();
		}

		const payload = verified.payload;
		const claimType = payload.sid ? 'sid' : 'sub';
		const claimValue = payload.sid || payload.sub;

		self.processLogoutJti(verified.provider.issuer, payload.jti, verified.replayExpires, function(done) {
			self.revokeOidcSessionsForClaim(verified.provider.issuer, claimType, claimValue,
				verified.provider.clientId, verified.replayExpires, done);
		}, function(processErr, replay) {
			if (processErr) {
				self.logError('oauth', 'OIDC back-channel logout storage failure: ' + processErr.message);
				return badRequest('OIDC logout could not be completed.');
			}
			self.logDebug(6, replay ? 'OIDC back-channel logout replay handled idempotently' :
				'OIDC back-channel logout completed');
			callback('200 OK', { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
				JSON.stringify({ code: 0 }));
		});
	}

});
