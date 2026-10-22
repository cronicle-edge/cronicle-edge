#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PixlServer = require('pixl-server');
const ClusterSecret = require('../../lib/cluster-secret');

function digest(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(err) {
	fs.writeSync(2, (err && err.code || 'ERROR') + ': ' + (err && err.message || err) + '\n');
	process.exit(2);
}

try {
	const root = process.env.CLUSTER_SECRET_PROBE_ROOT;
	if (!root) throw new Error('Missing CLUSTER_SECRET_PROBE_ROOT');
	process.chdir(root);

	const secretFile = process.env.CRONICLE_secret_key_file || 'conf/secret_key';
	const bootstrapSecret = ClusterSecret.loadSecretFile(process.env, secretFile);

	const configFile = process.env.CRONICLE_config_file || 'conf/config.json';
	const configFiles = fs.existsSync(configFile) ? [{ file: configFile }] : [];
	const server = new PixlServer({
		__name: 'Cronicle',
		__version: 'cluster-secret-probe',
		multiConfig: configFiles,
		components: []
	});
	ClusterSecret.guardServerConfig(server, bootstrapSecret);

	server.startup(function() {
		try {
			const initialSecret = server.config.get('secret_key');
			let reloadedSecret = initialSecret;
			const replacementSecret = 'replacement-that-must-not-appear';

			if (process.env.CLUSTER_SECRET_PROBE_RELOAD === '1') {
				delete process.env.CRONICLE_secret_key;
				if (process.env.CLUSTER_SECRET_PROBE_RELOAD_OVERRIDE) {
					fs.writeFileSync(process.env.CLUSTER_SECRET_PROBE_RELOAD_OVERRIDE,
						JSON.stringify({ secret_key: replacementSecret }));
				}
				else {
					const source = JSON.parse(fs.readFileSync(configFile, 'utf8'));
					source.secret_key = replacementSecret;
					fs.writeFileSync(configFile, JSON.stringify(source, null, 2));
					server.multiConfig[0].config.load();
					server.remergeAllConfigs();
				}
				server.config.emit('reload');
				server.config.refreshSubs();
				reloadedSecret = server.config.get('secret_key');
			}
			if (process.env.CLUSTER_SECRET_PROBE_DAEMON_LOG === '1') {
				server.logDebug(2, 'Spawning background daemon process (probe)', process.argv);
			}

			const logFile = path.join(server.config.get('log_dir'), server.config.get('log_filename'));
			const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';

			fs.writeSync(1, JSON.stringify({
				initial: digest(String(initialSecret)),
				reloaded: digest(String(reloadedSecret)),
				logContainsInitial: logText.includes(String(initialSecret)),
				logContainsReplacement: logText.includes(replacementSecret)
			}) + '\n');
			server.shutdown(function() { process.exit(0); });
		}
		catch (err) { fail(err); }
	});
}
catch (err) { fail(err); }
