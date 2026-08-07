// OpenID Connect logout helpers

const crypto = require('crypto');

const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const DEFAULT_ALGORITHMS = ['RS256'];

let josePromise;
const remoteJwks = new Map();

function getJose() {
	if (!josePromise) josePromise = import('jose');
	return josePromise;
}

function isLocalhost(hostname) {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function parseSecureUrl(value, name, allowHttpLocalhost) {
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
	const configured = oauth.allowed_algs || oauth.algorithms || DEFAULT_ALGORITHMS;
	const algorithms = Array.isArray(configured) ? configured.slice() : [configured];
	if (!algorithms.length || algorithms.some((alg) => typeof alg !== 'string' || !/^(?:RS|PS|ES)\d{3}$/.test(alg))) {
		throw new Error('oauth.allowed_algs must contain asymmetric signing algorithms');
	}
	return algorithms;
}

function validateProviderConfig(oauth) {
	if (!oauth || typeof oauth !== 'object') throw new Error('OAuth is not configured');
	if (!oauth.client_id || typeof oauth.client_id !== 'string') throw new Error('oauth.client_id is required');
	if (!oauth.issuer || typeof oauth.issuer !== 'string') throw new Error('oauth.issuer is required');
	if (!oauth.jwks_url || typeof oauth.jwks_url !== 'string') throw new Error('oauth.jwks_url is required');

	const allowHttpLocalhost = !!oauth.insecure && !!oauth.allow_http_localhost;
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
	if (!token || typeof token !== 'string') throw new Error('Missing ID Token');
	const result = await verifyJwt(token, oauth, { requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub'] });
	if (!result.payload.sub || typeof result.payload.sub !== 'string') throw new Error('Invalid ID Token subject');
	if (!Number.isFinite(result.payload.iat) || result.payload.iat > Math.floor(Date.now() / 1000) + result.provider.clockTolerance) {
		throw new Error('Invalid ID Token iat');
	}
	if (expectedNonce && result.payload.nonce !== expectedNonce) throw new Error('Invalid ID Token nonce');
	if (result.payload.azp && result.payload.azp !== result.provider.clientId) throw new Error('Invalid ID Token authorized party');
	if (Array.isArray(result.payload.aud) && result.payload.aud.length > 1 && result.payload.azp !== result.provider.clientId) {
		throw new Error('ID Token with multiple audiences requires matching azp');
	}
	return result;
}

async function verifyLogoutToken(token, oauth) {
	const backchannel = oauth.backchannel_logout || {};
	const maxTokenSize = Math.max(1024, Number(backchannel.max_token_size) || 16384);
	if (!token || typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > maxTokenSize) {
		throw new Error('Invalid logout token size');
	}

	const result = await verifyJwt(token, oauth, {
		requiredClaims: ['iss', 'aud', 'iat', 'exp', 'jti', 'events']
	});
	const payload = result.payload;
	const now = Math.floor(Date.now() / 1000);
	const maxAge = Math.max(1, Number(backchannel.max_token_age_seconds) || 300);
	const tolerance = result.provider.clockTolerance;

	if (!Number.isFinite(payload.iat) || payload.iat > now + tolerance || payload.iat < now - maxAge - tolerance) {
		throw new Error('Logout Token iat is outside the accepted window');
	}
	if (!payload.jti || typeof payload.jti !== 'string') throw new Error('Logout Token jti is required');
	if (Object.prototype.hasOwnProperty.call(payload, 'nonce')) throw new Error('Logout Token must not contain nonce');
	if (!payload.events || typeof payload.events !== 'object' || Array.isArray(payload.events) ||
		!Object.prototype.hasOwnProperty.call(payload.events, BACKCHANNEL_EVENT) ||
		typeof payload.events[BACKCHANNEL_EVENT] !== 'object' || payload.events[BACKCHANNEL_EVENT] === null ||
		Array.isArray(payload.events[BACKCHANNEL_EVENT])) {
		throw new Error('Logout Token events claim is invalid');
	}
	if ((!payload.sid || typeof payload.sid !== 'string') && (!payload.sub || typeof payload.sub !== 'string')) {
		throw new Error('Logout Token must contain sid or sub');
	}

	return result;
}

function encryptSessionToken(token, secret) {
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
	return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptSessionToken(value, secret) {
	const packed = Buffer.from(String(value), 'base64url');
	if (packed.length < 30 || packed[0] !== 1) throw new Error('Invalid encrypted ID Token');
	const key = crypto.createHash('sha256').update(String(secret)).digest();
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(1, 13));
	decipher.setAuthTag(packed.subarray(13, 29));
	return Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]).toString('utf8');
}

function buildSessionMetadata(oauth, idTokenClaims, userInfo, idToken, secret) {
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
		const redirect = parseSecureUrl(
			logout.post_logout_redirect_uri,
			'oauth.logout.post_logout_redirect_uri',
			allowHttpLocalhost
		);
		url.searchParams.set('post_logout_redirect_uri', redirect.toString());
	}

	if (session && session.oidc_id_token_hint_enc) {
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
	const digest = crypto.createHash('sha256').update(issuer + '\0' + claimType + '\0' + claimValue).digest('hex');
	return 'oidc/session_index/' + claimType + '/' + digest;
}

function replayKey(issuer, jti) {
	const digest = crypto.createHash('sha256').update(issuer + '\0' + jti).digest('hex');
	return 'oidc/logout_jti/' + digest;
}

function createLogoutTicket(location, secret, ttlSeconds) {
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

module.exports = {
	BACKCHANNEL_EVENT,
	buildSessionMetadata,
	buildLogoutLocation,
	consumeLogoutTicket,
	createLogoutTicket,
	decryptSessionToken,
	encryptSessionToken,
	indexKey,
	parseSecureUrl,
	replayKey,
	validateProviderConfig,
	verifyIdToken,
	verifyLogoutToken,
	_resetCachesForTests: function() { remoteJwks.clear(); josePromise = null; }
};
