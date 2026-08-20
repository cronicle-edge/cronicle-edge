const assert = require('node:assert/strict');

const Admin = require('../lib/api/admin');
const Engine = require('../lib/engine');

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

test('Config Viewer redacts legacy and nested AWS session credentials', async () => {
	const sourceConfig = {
		debug: true,
		Storage: {
			AWS: {
				secretAccessKey: 'legacy-secret',
				sessionToken: 'legacy-session',
				region: 'eu-central-1',
				credentials: {
					accessKeyId: 'visible-id',
					secretAccessKey: 'nested-secret',
					sessionToken: 'nested-session'
				}
			}
		}
	};
	const admin = Object.create(Admin.prototype);
	admin.server = { config: { get: () => sourceConfig } };
	admin.loadSession = (args, callback) => callback(null, {}, {});
	admin.requireAdmin = () => true;

	const response = await new Promise((resolve) => {
		admin.api_get_config({ params: {} }, resolve);
	});
	const aws = response.config.Storage.AWS;
	assert.equal(response.code, 0);
	assert.equal(aws.secretAccessKey, '[REDACTED]');
	assert.equal(aws.sessionToken, '[REDACTED]');
	assert.equal(aws.credentials.secretAccessKey, '[REDACTED]');
	assert.equal(aws.credentials.sessionToken, '[REDACTED]');
	assert.equal(aws.credentials.accessKeyId, 'visible-id');
	assert.equal(aws.region, 'eu-central-1');
	assert.equal(sourceConfig.Storage.AWS.sessionToken, 'legacy-session');
});

test('startup scrub removes both supported AWS credential layouts', () => {
	const env = {
		CRONICLE_Storage__AWS__secretAccessKey: 'legacy-secret',
		CRONICLE_Storage__AWS__sessionToken: 'legacy-session',
		CRONICLE_Storage__AWS__credentials__secretAccessKey: 'nested-secret',
		CRONICLE_Storage__AWS__credentials__sessionToken: 'nested-session',
		CRONICLE_Storage__AWS__region: 'eu-central-1',
		PUBLIC_VALUE: 'visible'
	};
	const engine = Object.create(Engine.prototype);
	engine.scrubStartupEnvSecrets(env);

	assert.deepEqual(env, {
		CRONICLE_Storage__AWS__region: 'eu-central-1',
		PUBLIC_VALUE: 'visible'
	});
});

module.exports = {
	setUp: function(callback) { callback(); },
	tests: tests,
	tearDown: function(callback) { callback(); }
};
