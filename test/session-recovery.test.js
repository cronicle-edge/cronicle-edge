const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pageSource = fs.readFileSync(
	path.join(__dirname, '../htdocs/js/pages/Base.class.js'),
	'utf8'
);

function loadBasePage(sharedStorage, now, storageAvailable) {
	let pageDefinition = null;
	let successCallback = null;
	let errorCallback = null;
	let reloadCount = 0;
	const errors = [];
	const storage = {
		getItem: function(key) {
			if (!storageAvailable) throw new Error('sessionStorage unavailable');
			return Object.prototype.hasOwnProperty.call(sharedStorage, key) ? sharedStorage[key] : null;
		},
		setItem: function(key, value) {
			if (!storageAvailable) throw new Error('sessionStorage unavailable');
			sharedStorage[key] = String(value);
		},
		removeItem: function(key) {
			if (!storageAvailable) throw new Error('sessionStorage unavailable');
			delete sharedStorage[key];
		}
	};
	const sandboxApp = {
		api: {
			post: function(endpoint, params, success, error) {
				assert.equal(endpoint, 'user/resume_session');
				successCallback = success;
				errorCallback = error;
			}
		},
		config: {},
		doError: function(message) { errors.push(message); },
		getPref: function() { return ''; },
		navAfterLogin: ''
	};
	const sandbox = {
		Class: {
			subclass: function(parent, name, definition) { pageDefinition = definition; }
		},
		Date: { now: function() { return now; } },
		Debug: { trace: function() {} },
		Nav: { go: function() {}, refresh: function() {} },
		Page: {},
		app: sandboxApp,
		compose_query_string: function() { return ''; },
		num_keys: function() { return 0; },
		setTimeout: function(callback) { callback(); },
		window: {
			location: {
				href: 'https://cron.example/#Home',
				pathname: '/',
				reload: function() { reloadCount++; }
			},
			sessionStorage: storage
		}
	};

	vm.runInNewContext(pageSource, sandbox);
	const result = pageDefinition.requireLogin.call({
		ID: 'Home',
		div: { hide: function() {} }
	});
	assert.equal(result, false);
	assert.equal(typeof successCallback, 'function');
	assert.equal(typeof errorCallback, 'function');

	return {
		errors: errors,
		error: errorCallback,
		getReloadCount: function() { return reloadCount; },
		succeed: successCallback
	};
}

module.exports = {
	tests: [
		function testExternalProxySessionRecovery(test) {
			const sharedStorage = {};
			const firstPage = loadBasePage(sharedStorage, 100000, true);
			firstPage.error({ code: 401, description: 'Unauthorized' });
			assert.equal(firstPage.getReloadCount(), 1);
			assert.deepEqual(firstPage.errors, []);

			// A new page lifecycle shares sessionStorage with the previous reload.
			const reloadedPage = loadBasePage(sharedStorage, 100001, true);
			reloadedPage.error({ code: 401, description: 'Unauthorized' });
			assert.equal(reloadedPage.getReloadCount(), 0);
			assert.deepEqual(reloadedPage.errors, ['Network Error: 401: Unauthorized']);

			const serverErrorPage = loadBasePage(sharedStorage, 100002, true);
			serverErrorPage.error({ code: 500, description: 'Server Error' });
			assert.equal(serverErrorPage.getReloadCount(), 0);
			assert.deepEqual(serverErrorPage.errors, ['Network Error: 500: Server Error']);

			const applicationErrorPage = loadBasePage(sharedStorage, 100003, true);
			applicationErrorPage.error({ code: 'login', description: 'Login failed' });
			assert.equal(applicationErrorPage.getReloadCount(), 0);
			assert.deepEqual(applicationErrorPage.errors, ['Error: Login failed']);

			const stringStatusPage = loadBasePage(sharedStorage, 100004, true);
			stringStatusPage.error({ code: '401', description: 'Application error' });
			assert.equal(stringStatusPage.getReloadCount(), 0);
			assert.deepEqual(stringStatusPage.errors, ['Error: Application error']);

			const expiredGuardPage = loadBasePage(sharedStorage, 130001, true);
			expiredGuardPage.error({ code: 401, description: 'Unauthorized' });
			assert.equal(expiredGuardPage.getReloadCount(), 1);

			const successPage = loadBasePage(sharedStorage, 130002, true);
			successPage.succeed({ code: 0 });
			const recoveredPage = loadBasePage(sharedStorage, 130003, true);
			recoveredPage.error({ code: 401, description: 'Unauthorized' });
			assert.equal(recoveredPage.getReloadCount(), 1);

			const blockedStoragePage = loadBasePage({}, 130004, false);
			blockedStoragePage.error({ code: 401, description: 'Unauthorized' });
			assert.equal(blockedStoragePage.getReloadCount(), 0);
			assert.deepEqual(blockedStoragePage.errors, ['Network Error: 401: Unauthorized']);
			test.done();
		}
	]
};
