// Helpers for keeping Cronicle's encrypted job metadata and connection
// credentials out of plugin-created child environments.

const PRIVATE_JOB_ENV_KEYS = new Set([
	'JOB_ENV', 'JOB_SECRET', 'JOB_GLOBALENV', 'JOB_CAT_SECRET',
	'JOB_PLUG_SECRET', 'JOB_LOCAL_SECRET', 'JOB_API_KEY',
	'JOB_SESSION_ID', 'JOB_TOKEN'
]);

const CONNECTION_SECRET_ENV_KEYS = new Set([
	'SSH_PASSWORD', 'SSH_KEY', 'SSH_PASSPHRASE',
	'DOCKER_PASSWORD', 'KUBE_CONFIG'
]);

const SENSITIVE_QUERY_FIELDS = new Set([
	'password', 'passwd', 'passphrase', 'privatekey', 'sshkey',
	'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken',
	'secret', 'secretkey', 'clientsecret', 'apikey', 'authorization'
]);

function normalizeCredentialKey(key) {
	return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEnvKey(key) {
	return String(key || '').toUpperCase();
}

function findEnvKey(env, requestedKey) {
	if (!env || !requestedKey) return null;
	if (Object.prototype.hasOwnProperty.call(env, requestedKey)) return requestedKey;
	const normalized = normalizeEnvKey(requestedKey);
	return Object.keys(env).find(function(key) {
		return normalizeEnvKey(key) === normalized;
	}) || null;
}

function isSensitiveQueryField(key) {
	const normalized = normalizeCredentialKey(key);
	return SENSITIVE_QUERY_FIELDS.has(normalized) ||
		normalized.endsWith('password') || normalized.endsWith('passwd') ||
		normalized.endsWith('passphrase') || normalized.endsWith('privatekey') ||
		normalized.endsWith('token') || normalized.endsWith('secret') ||
		normalized.endsWith('apikey');
}

function parseConnectionUri(value) {
	if (typeof value !== 'string' || !value.trim()) return null;
	let candidate = value.trim();
	try {
		if (!candidate.match(/^[a-z][a-z0-9+.-]*:\/\//i)) {
			if (!candidate.includes('@') && !candidate.includes('?')) return null;
			candidate = 'ssh://' + candidate;
		}
		return new URL(candidate);
	}
	catch (err) {
		return null;
	}
}

function isCredentialedConnection(value) {
	const uri = parseConnectionUri(value);
	if (!uri) return false;
	// Userinfo is connection-only even when the URI omits a password.  Some
	// transports place an access token in the username slot.
	if (uri.username || uri.password) return true;
	for (const key of uri.searchParams.keys()) {
		if (isSensitiveQueryField(key)) return true;
	}
	return false;
}

function resolveConnectionEnv(env, key) {
	const keyName = findEnvKey(env, key);
	const raw = keyName ? env[keyName] : undefined;
	if (typeof raw !== 'string' || !raw) {
		return { raw: raw, value: raw, keyName: keyName, refName: null };
	}
	const refName = findEnvKey(env, raw);
	return {
		raw: raw,
		value: refName ? env[refName] : raw,
		keyName: keyName,
		refName: refName
	};
}

function isPrivateJobEnvKey(key) {
	return PRIVATE_JOB_ENV_KEYS.has(String(key || '').toUpperCase());
}

function copyPublicJobFieldsToEnv(job, env) {
	Object.keys(job || {}).forEach(function(key) {
		const envKey = 'JOB_' + key.toUpperCase();
		if (isPrivateJobEnvKey(envKey)) return;
		switch (typeof job[key]) {
			case 'string':
			case 'number':
				env[envKey] = '' + job[key];
				break;
			case 'boolean':
				env[envKey] = job[key] ? 1 : 0;
				break;
		}
	});
	return env;
}

function buildPluginEnvEntries(env, options) {
	options = options || {};
	// Preserve the plugins' existing case-sensitive positive allowlist on POSIX.
	// Only security comparisons below are normalized for Windows semantics.
	const prefixes = options.prefixes || [];
	const include = new Set(options.include || []);
	const blocked = new Set((options.exclude || []).map(normalizeEnvKey));
	const truncatePrefix = options.truncatePrefix || '';

	PRIVATE_JOB_ENV_KEYS.forEach(function(key) { blocked.add(normalizeEnvKey(key)); });
	CONNECTION_SECRET_ENV_KEYS.forEach(function(key) { blocked.add(normalizeEnvKey(key)); });
	(options.consumedKeys || []).forEach(function(key) {
		if (key) blocked.add(normalizeEnvKey(key));
	});
	(options.connectionKeys || []).forEach(function(key) {
		const resolved = resolveConnectionEnv(env, key);
		if (options.consumeConnections || isCredentialedConnection(resolved.value)) {
			blocked.add(normalizeEnvKey(key));
			if (resolved.keyName) blocked.add(normalizeEnvKey(resolved.keyName));
			if (resolved.refName) blocked.add(normalizeEnvKey(resolved.refName));
		}
	});

	return Object.entries(env || {}).filter(function(entry) {
		const key = entry[0];
		const normalizedKey = normalizeEnvKey(key);
		if (blocked.has(normalizedKey) || isPrivateJobEnvKey(normalizedKey)) return false;
		return include.has(key) || prefixes.some(function(prefix) {
			return key.startsWith(prefix);
		});
	}).map(function(entry) {
		let key = entry[0];
		if (truncatePrefix && key.startsWith(truncatePrefix)) {
			key = key.substring(truncatePrefix.length);
		}
		return [key, entry[1]];
	});
}

function buildDockerPluginEnv(env, truncatePrefix) {
	return buildPluginEnvEntries(env, {
		prefixes: ['JOB_', 'DOCKER_', 'ARG'],
		include: [
			'BASE_URL', 'BASE_APP_URL', 'DOCKER_HOST', 'PULL_IMAGE',
			'KEEP_CONTAINER', 'IMAGE', 'ENTRYPOINT_PATH'
		],
		exclude: ['SSH_HOST'],
		// Keep credential-free endpoints for compatibility with jobs that run a
		// Docker client inside the child container.  Credentialed endpoints and
		// their environment references remain private to this transport plugin.
		connectionKeys: ['DOCKER_HOST'],
		truncatePrefix: truncatePrefix ? 'DOCKER_' : ''
	});
}

function buildKubePluginEnv(env, truncatePrefix) {
	return buildPluginEnvEntries(env, {
		prefixes: ['JOB_', 'KUBE_', 'ARG'],
		include: ['BASE_URL', 'BASE_APP_URL', 'NAMESPACE', 'KEEP_POD', 'IMAGE'],
		// JOB_ARG is user runtime input for this plugin, not a Kubernetes
		// connection selector, so it remains available to the child pod.
		connectionKeys: [],
		truncatePrefix: truncatePrefix ? 'KUBE_' : ''
	});
}

function buildSSHXPluginEnv(env, truncatePrefix) {
	const sshHost = resolveConnectionEnv(env || {}, 'SSH_HOST');
	const selectedKey = sshHost.raw ? 'SSH_HOST' : 'JOB_ARG';
	const selected = selectedKey === 'SSH_HOST' ? sshHost :
		resolveConnectionEnv(env || {}, selectedKey);
	return buildPluginEnvEntries(env, {
		prefixes: ['JOB_', 'SSH_', 'ARG'],
		include: ['BASE_URL', 'BASE_APP_URL'],
		connectionKeys: ['SSH_HOST', 'JOB_ARG'],
		consumedKeys: [selected.keyName || selectedKey, selected.refName],
		truncatePrefix: truncatePrefix ? 'SSH_' : ''
	});
}

function sanitizeProcessEnv(env, options) {
	options = options || {};
	const blocked = new Set((options.exclude || []).map(normalizeEnvKey));
	PRIVATE_JOB_ENV_KEYS.forEach(function(key) { blocked.add(normalizeEnvKey(key)); });
	CONNECTION_SECRET_ENV_KEYS.forEach(function(key) { blocked.add(normalizeEnvKey(key)); });
	(options.connectionKeys || []).forEach(function(key) {
		const resolved = resolveConnectionEnv(env, key);
		blocked.add(normalizeEnvKey(key));
		if (resolved.keyName) blocked.add(normalizeEnvKey(resolved.keyName));
		if (resolved.refName) blocked.add(normalizeEnvKey(resolved.refName));
	});
	const result = {};
	Object.keys(env || {}).forEach(function(key) {
		const normalizedKey = normalizeEnvKey(key);
		if (!blocked.has(normalizedKey) && !isPrivateJobEnvKey(normalizedKey)) {
			result[key] = env[key];
		}
	});
	return result;
}

function sanitizeSSHLocalEnv(env) {
	return sanitizeProcessEnv(env, { connectionKeys: ['SSH_HOST', 'JOB_ARG'] });
}

module.exports = {
	CONNECTION_SECRET_ENV_KEYS,
	PRIVATE_JOB_ENV_KEYS,
	buildDockerPluginEnv,
	buildKubePluginEnv,
	buildPluginEnvEntries,
	buildSSHXPluginEnv,
	copyPublicJobFieldsToEnv,
	isCredentialedConnection,
	isPrivateJobEnvKey,
	resolveConnectionEnv,
	sanitizeProcessEnv,
	sanitizeSSHLocalEnv
};
