// Shared SSH target and host-key trust policy for the bundled SSH plugins.
//
// SSH_HOST and the fingerprint settings are operator-controlled plugin/event
// configuration.  JOB_ARG is runtime input and may be supplied by a run-only
// caller, so it can select a remote target only when SSH_HOST is blank.  It can
// never opt into local execution or provide its own host-key fingerprint.

const { createHash, timingSafeEqual } = require('crypto');

class SshHostPolicyError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'SshHostPolicyError';
		this.code = code;
	}
}

function parseBoolean(value, name) {
	if ((value === undefined) || (value === null) || (String(value).trim() === '')) return false;
	const normalized = String(value).trim().toLowerCase();
	if (['1', 'true', 'yes', 'on', 'strict', 'require', 'required'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off', 'compat', 'optional'].includes(normalized)) return false;
	throw new SshHostPolicyError('SSH_HOST_KEY_POLICY_INVALID', `${name} must be a boolean value`);
}

function resolveEnvironmentReference(value, env) {
	const reference = String(value || '').trim();
	if (!reference) return '';
	if (Object.prototype.hasOwnProperty.call(env, reference)) return String(env[reference] || '').trim();
	return reference;
}

function normalizeFingerprint(value) {
	const text = String(value || '').trim();
	const match = text.match(/^SHA256:([A-Za-z0-9+/]{43}=?)$/);
	if (!match) {
		throw new SshHostPolicyError(
			'SSH_HOST_FINGERPRINT_INVALID',
			'SSH host key fingerprints must use the OpenSSH SHA256:<base64> format'
		);
	}

	const unpadded = match[1].replace(/=+$/, '');
	const digest = Buffer.from(unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4), 'base64');
	if ((digest.length !== 32) || (digest.toString('base64').replace(/=+$/, '') !== unpadded)) {
		throw new SshHostPolicyError('SSH_HOST_FINGERPRINT_INVALID', 'SSH host key fingerprint is not canonical SHA-256 base64');
	}
	return digest;
}

function parseFingerprintList(value) {
	if (Array.isArray(value)) {
		if (!value.length) return [];
		return value.map(normalizeFingerprint);
	}

	const text = String(value || '').trim();
	if (!text) return [];
	return text.split(/[\s,]+/).filter(Boolean).map(normalizeFingerprint);
}

function parseFingerprintMap(value) {
	const text = String(value || '').trim();
	if (!text) return null;

	let parsed;
	try { parsed = JSON.parse(text); }
	catch (err) {
		throw new SshHostPolicyError('SSH_HOST_FINGERPRINT_MAP_INVALID', 'SSH_HOST_FINGERPRINT_MAP must be valid JSON');
	}
	if (!parsed || (typeof parsed !== 'object') || Array.isArray(parsed)) {
		throw new SshHostPolicyError('SSH_HOST_FINGERPRINT_MAP_INVALID', 'SSH_HOST_FINGERPRINT_MAP must be a JSON object');
	}

	const result = new Map();
	for (const key of Object.keys(parsed)) {
		const normalizedKey = String(key).trim().toLowerCase();
		if (!normalizedKey) {
			throw new SshHostPolicyError('SSH_HOST_FINGERPRINT_MAP_INVALID', 'SSH host fingerprint map contains an empty host key');
		}
		const pins = parseFingerprintList(parsed[key]);
		if (!pins.length) {
			throw new SshHostPolicyError('SSH_HOST_FINGERPRINT_MAP_INVALID', `SSH host fingerprint map entry ${normalizedKey} is empty`);
		}
		result.set(normalizedKey, pins);
	}
	return result;
}

function normalizeHostname(hostname) {
	return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function hostMapKeys(hostname, port) {
	const host = normalizeHostname(hostname);
	const portNumber = parseInt(port, 10) || 22;
	const hostWithPort = host.includes(':') ? `[${host}]:${portNumber}` : `${host}:${portNumber}`;
	return [hostWithPort, host];
}

function uniqueDigests(digests) {
	const seen = new Set();
	return digests.filter((digest) => {
		const key = digest.toString('hex');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function createHostVerifier(expectedDigests) {
	const pins = expectedDigests.map((digest) => Buffer.from(digest));
	return function verifyHostKey(key) {
		const actual = createHash('sha256').update(key).digest();
		return pins.some((expected) => (
			actual.length === expected.length && timingSafeEqual(actual, expected)
		));
	};
}

function parseRemoteUri(hostInfo, defaultProtocol) {
	let uriText = String(hostInfo || '').trim();
	if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(uriText)) uriText = `${defaultProtocol}://${uriText}`;

	let uri;
	try { uri = new URL(uriText); }
	catch (err) {
		throw new SshHostPolicyError('SSH_HOST_URI_INVALID', 'SSH host configuration is not a valid URI');
	}
	if (!['ssh:', 'sftp:'].includes(uri.protocol) || !uri.hostname) {
		throw new SshHostPolicyError('SSH_HOST_URI_INVALID', 'SSH host URI must use ssh:// or sftp:// and include a hostname');
	}
	return uri;
}

function resolveSshTarget(env, options) {
	options = options || {};
	env = env || {};
	const configuredHost = String(env.SSH_HOST || '').trim();
	const jobArgument = String(env.JOB_ARG || '').trim();
	const source = configuredHost ? 'configured' : (jobArgument ? 'job_arg' : 'none');
	const selected = configuredHost || jobArgument;

	if (!selected) {
		throw new SshHostPolicyError(
			'SSH_HOST_REQUIRED',
			'Host info is not provided. Configure SSH_HOST or pass a remote host via Workflow argument'
		);
	}

	const resolved = resolveEnvironmentReference(selected, env);
	if (!resolved) {
		throw new SshHostPolicyError(
			'SSH_HOST_REQUIRED',
			'The selected SSH host environment reference is empty'
		);
	}
	const localRequested = resolved.toLowerCase() === 'localhost';
	if ((source === 'job_arg') && localRequested) {
		throw new SshHostPolicyError(
			'SSH_LOCAL_FROM_JOB_ARG',
			'Workflow/job arguments cannot select local SSH execution; configure SSH_HOST=localhost explicitly'
		);
	}
	if ((source === 'configured') && localRequested && options.allowConfiguredLocal) {
		return {
			mode: 'local',
			source,
			selected,
			resolved,
			verification: 'not-applicable'
		};
	}

	const uri = parseRemoteUri(resolved, options.defaultProtocol || 'ssh');
	const strict = parseBoolean(env.SSH_HOST_KEY_STRICT, 'SSH_HOST_KEY_STRICT');
	const directFingerprintValue = String(env.SSH_HOST_FINGERPRINT || '').trim();
	const mapValue = String(env.SSH_HOST_FINGERPRINT_MAP || '').trim();
	const directPins = parseFingerprintList(directFingerprintValue);
	const fingerprintMap = parseFingerprintMap(mapValue);
	let mappedPins = [];
	if (fingerprintMap) {
		for (const key of hostMapKeys(uri.hostname, uri.port || 22)) {
			if (fingerprintMap.has(key)) {
				mappedPins = fingerprintMap.get(key);
				break;
			}
		}
	}
	const pins = uniqueDigests(directPins.concat(mappedPins));
	const pinConfigurationPresent = !!(directFingerprintValue || mapValue);

	if (!pins.length && (strict || pinConfigurationPresent)) {
		throw new SshHostPolicyError(
			'SSH_HOST_FINGERPRINT_REQUIRED',
			`No trusted SSH host key fingerprint is configured for ${uri.hostname}:${parseInt(uri.port, 10) || 22}`
		);
	}

	return {
		mode: 'remote',
		source,
		selected,
		resolved,
		uri,
		verification: pins.length ? 'pinned' : 'compatibility',
		warning: pins.length ? '' : 'SSH host key verification is disabled for compatibility; configure SSH_HOST_FINGERPRINT (or SSH_HOST_FINGERPRINT_MAP) and then enable SSH_HOST_KEY_STRICT',
		hostVerifier: pins.length ? createHostVerifier(pins) : null,
		pinCount: pins.length
	};
}

function buildConnectionOptions(target, extra) {
	if (!target || target.mode !== 'remote' || !target.uri) {
		throw new SshHostPolicyError('SSH_HOST_URI_INVALID', 'A remote SSH target is required');
	}
	const conf = Object.assign({
		host: target.uri.hostname,
		port: parseInt(target.uri.port, 10) || 22,
		username: target.uri.username,
		pty: true
	}, extra || {});
	if (target.hostVerifier) conf.hostVerifier = target.hostVerifier;
	return conf;
}

function formatOpenSshFingerprint(key) {
	return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

module.exports = {
	SshHostPolicyError,
	buildConnectionOptions,
	createHostVerifier,
	formatOpenSshFingerprint,
	hostMapKeys,
	normalizeFingerprint,
	parseFingerprintList,
	resolveSshTarget
};
