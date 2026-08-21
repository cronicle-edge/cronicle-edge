// Unit tests for Cronicle (run using `npm test`)
// Copyright (c) 2016 - 2017 Joseph Huckaby
// Released under the MIT License

var cp = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var Readable = require('stream').Readable;
var zlib = require('zlib');
var async = require('async');
var moment = require('moment-timezone');

var Tools = require('pixl-tools');
var glob = Tools.glob;
var PixlServer = require("pixl-server");

// we need a few config files
var config = require('../sample_conf/config.json');
var setup = require('../sample_conf/setup.json');

// override things for the unit tests
config.debug = true;
config.echo = false;
config.color = false;
config.manager = false;

config.WebServer.http_port = 4012;
config.base_app_url = "http://localhost:4012";
config.udp_broadcast_port = 4014;

config.email_from = "test@localhost";
config.smtp_hostname = "localhost";
config.secret_key = "UNIT_TEST";
config.log_filename = "unit.log";
config.pid_file = "logs/unit.pid";
config.debug_level = 10;
config.scheduler_startup_grace = 0;
config.job_startup_grace = 1;
config.Storage.Filesystem.base_dir = "data/unittest";
config.web_hook_config_keys = ["base_app_url", "something_custom"];
config.something_custom = "nonstandard property";
config.track_manual_jobs = true;
config.queue_dir = 'data/unitqueue';

// chdir to the proper server root dir
process.chdir( require('path').dirname( __dirname ) );

// Windows compatibility items
function pingPID(pid) { 
	return (process.platform == 'win32' ? cp.execSync(`powershell -c "Get-Process -Id ${pid} -ErrorAction SilentlyContinue"`) : process.kill(parseInt(pid), 0))
}
function cleanUp() {
	if( process.platform == 'win32') {
		cp.execSync('if exist logs\\unit.pid del logs\\unit.pid')
		cp.execSync('if exist data\\unit* rmdir /s /q data\\unittest data\\unitqueue')
	}
	else {
		cp.execSync('rm -rf logs/unit.pid data/unittest data/unitqueue')
	}
}

let testScript = process.platform == 'win32' ? "#!powershell\n\necho \"UNIT TEST STRING\"" : "#!/bin/sh\n\necho \"UNIT TEST STRING\""

// global refs
var server = null;
var storage = null;
var cronicle = null;
var request = null;
var api_url = '';
var session_id = '';
var log_auth_sessions = {
	category_denied: 'unit_log_category_denied',
	group_denied: 'unit_log_group_denied',
	allowed: 'unit_log_allowed'
};

module.exports = {
	logDebug: function(level, msg, data) {
		// proxy request to system logger with correct component
		if (cronicle && cronicle.logger) {
			cronicle.logger.set( 'component', 'UnitTest' );
			cronicle.logger.debug( level, msg, data );
		}
	},
	
	setUp: function (callback) {
		// always called before tests start
		var self = this;
		
		// make sure another unit test isn't running
		var pid = false;
		try { pid = fs.readFileSync('logs/unit.pid', { encoding: 'utf8' }); }
		catch (e) {;}
		if (pid) {
			var alive = true;
			try { pingPID(pid) }
			catch (e) { alive = false; }
			if (alive) {
				console.warn("Another unit test is already running (PID " + pid + "). Exiting.");
				process.exit(1);
			}
		}
		
		// clean out data from last time
		try { cleanUp()}
		catch (e) {;}
		
		// construct server object
		server = new PixlServer({
			
			__name: 'Cronicle',
			__version: require('../package.json').version,
			
			config: config,
			
			components: [
				require('pixl-server-storage'),
				require('pixl-server-web'),
				require('pixl-server-api'),
				require('./user.js'),
				require('./engine.js')
			]
			
		});

		server.startup( function() {
			// server startup complete
			storage = server.Storage;
			cronicle = server.Cronicle;
			
			// prepare to make api calls
			request = cronicle.request;
			api_url = server.config.get('base_app_url') + server.API.config.get('base_uri');
			
			// cancel auto ticks, so we can send our own later
			clearTimeout( server.tickTimer );
			delete server.tickTimer;
			
			// bootstrap storage with initial records
			async.eachSeries( setup.storage,
				function(params, callback) {
					var func = params.shift();
					params.push( callback );
					
					// massage a few params
					if (typeof(params[1]) == 'object') {
						var obj = params[1];
						if (obj.created) obj.created = Tools.timeNow(true);
						if (obj.modified) obj.modified = Tools.timeNow(true);
						if (obj.regexp && (obj.regexp == '_HOSTNAME_')) obj.regexp = '^(' + Tools.escapeRegExp( server.hostname ) + ')$';
						if (obj.hostname && (obj.hostname == '_HOSTNAME_')) obj.hostname = server.hostname;
						if (obj.ip && (obj.ip == '_IP_')) obj.ip = server.ip;
					}
					
					// call storage directly
					storage[func].apply( storage, params );
				},
				function(err) {
					if (err) throw err;
					
					// begin unit tests
					callback();
				}
			); // async.eachSeries
		} ); // server.startup
	}, // setUp
	
	beforeEach: function(test) {
		// called just before each test
		this.logDebug(10, "Starting unit test: " + test.name );
	},
	
	afterEach: function(test) {
		// called after each test completes
		this.logDebug(10, "Unit test complete: " + test.name );
	},
	
	//
	// Tests Array:
	//
	
	tests: [
		
		function testServerStarted(test) {
			test.ok( server.started > 0, 'Cronicle started up successfully');
			test.done();
		},

		function testLDAPMissingCredentialsDoesNotCrash(test) {
			server.User.do_ldap_auth('admin', false, false, false).then(function(result) {
				test.ok( result === undefined, 'Missing LDAP credentials return without authenticating');
				test.done();
			}).catch(function(err) {
				test.ok( false, 'Missing LDAP credentials must not throw: ' + err.message);
				test.done();
			});
		},
		
		function testStorage(test) {
			storage.get( 'users/admin', function(err, user) {
				test.ok( !err, "No error fetching admin user" );
				test.ok( !!user, "User record is non-null" );
				test.ok( user.username == "admin", "Username is correct" );
				test.ok( user.created > 0, "User creation date is non-zero" );
				
				test.done();
			} );
		},
		
		function testcheckmanagerEligibility(test) {
			cronicle.checkmanagerEligibility( function() {
				test.ok( cronicle.multi.cluster == true, "Server found in cluster" );
				test.ok( cronicle.multi.eligible == true, "Server is eligible for manager" );
				test.ok( cronicle.multi.manager == false, "Server is not yet manager" );
				test.ok( cronicle.multi.worker == false, "Server is not a worker" );
				
				test.done();
			} );
		},
		
		function testGomanager(test) {
			cronicle.gomanager();
			
			test.ok( cronicle.multi.manager == true, "Server became manager" );
			test.ok( cronicle.multi.worker == false, "Server is not a worker" );
			test.ok( cronicle.multi.cluster == true, "Server is still found in cluster" );
			test.ok( cronicle.multi.managerHostname == server.hostname, "Server managerHostname is self" );
			test.ok( !!cronicle.multi.lastPingSent, "Server lastPingSent is non-zero" );
			test.ok( !!cronicle.tz, "Server has a timezone set" );
			
			// need a rest here, so async sub-components can start up
			setTimeout( function() { test.done(); }, 500 );
		},

		function testPendingQueueActionChecks(test) {
			// make sure pending job scans only match launchLocalJob tasks
			// a regression here can mutate unrelated internal queue tasks
			var old_queue = cronicle.internalQueue;
			
			var other_task = { action: 'someOtherAction', id: 'unit-pending-job' };
			var launch_task = { action: 'launchLocalJob', id: 'unit-pending-job', hostname: server.hostname };
			cronicle.internalQueue = { other: other_task, launch: launch_task };
			
			var result = cronicle.updateLocalJob({ id: 'unit-pending-job', something_custom: 'updated' });
			test.ok( !!result, "Pending launch job was updated" );
			test.ok( other_task.action == 'someOtherAction', "Non-launch update task action was not mutated" );
			test.ok( !other_task.something_custom, "Non-launch update task was not selected" );
			test.ok( launch_task.something_custom == 'updated', "Launch task received pending update" );
			
			other_task = { action: 'someOtherAction', id: 'unit-abort-job' };
			launch_task = { action: 'launchLocalJob', id: 'unit-abort-job', hostname: server.hostname };
			cronicle.internalQueue = { other: other_task, launch: launch_task };
			
			cronicle.abortLocalPendingJob({ id: 'unit-abort-job', reason: 'unit test' });
			test.ok( other_task.action == 'someOtherAction', "Non-launch abort task action was not mutated" );
			test.ok( !!cronicle.internalQueue.other, "Non-launch abort task remained queued" );
			test.ok( !cronicle.internalQueue.launch, "Launch abort task was removed from queue" );
			test.ok( launch_task.abort_reason == 'unit test', "Launch abort task received abort reason" );
			
			other_task = { action: 'someOtherAction', id: 'unitwatchjob' };
			launch_task = { action: 'launchLocalJob', id: 'unitwatchjob', hostname: server.hostname };
			cronicle.internalQueue = { other: other_task, launch: launch_task };
			
			cronicle.watchJobLog(
				{ id: 'unitwatchjob' },
				{ id: 'unitSocket', request: { connection: { remoteAddress: '127.0.0.1' } } }
			);
			test.ok( other_task.action == 'someOtherAction', "Non-launch watch task action was not mutated" );
			test.ok(cronicle.getManagerJobLogSnapshot('unitwatchjob') === launch_task, "Manager log authorization found the canonical pending launch task");

			// Existing prototype pollution must not extend the API update allowlist
			// when updateLocalJob later iterates its stub with `for...in`.
			launch_task.log_file = 'ORIGINAL-PENDING-LOG';
			Object.defineProperty(Object.prototype, 'log_file', {
				value: 'POLLUTED-PROTOTYPE-LOG', enumerable: true, configurable: true, writable: true
			});
			try {
				var clean_updates = cronicle.getMutableJobUpdates({ notify_fail: 'safe@example.invalid' }, function () {});
				var safe_stub = cronicle.buildMutableJobStub('unitwatchjob', clean_updates);
				cronicle.updateLocalJob(safe_stub);
				test.ok(Object.getPrototypeOf(clean_updates) === null, "Sanitized updates have no polluted prototype");
				test.ok(Object.getPrototypeOf(safe_stub) === null, "Job update stub has no polluted prototype");
				test.ok(launch_task.log_file == 'ORIGINAL-PENDING-LOG', "Inherited protected field did not mutate pending job");
				test.ok(launch_task.notify_fail == 'safe@example.invalid', "Own allowlisted field still updated pending job");
			}
			finally {
				delete Object.prototype.log_file;
			}

			var protected_manager_update = cronicle.updateLocalJobFromManager({
				id: 'unitwatchjob',
				log_file: 'FORGED-MANAGER-LOG'
			});
			test.ok(!protected_manager_update, "Worker rejected a protected field from a legacy manager update");
			test.ok(launch_task.log_file == 'ORIGINAL-PENDING-LOG', "Legacy manager could not mutate the worker log path");
			var allowed_manager_update = cronicle.updateLocalJobFromManager({
				id: 'unitwatchjob',
				suspended: true
			});
			test.ok(!!allowed_manager_update, "Worker accepted an allowlisted field from its manager");
			test.ok(launch_task.suspended === true, "Allowlisted manager update reached the pending job");

			// A locally polluted prototype must not supply the job identity for a
			// manager update that omitted its own id field.
			Object.defineProperty(Object.prototype, 'id', {
				value: 'unitwatchjob', enumerable: true, configurable: true, writable: true
			});
			try {
				var inherited_id_update = cronicle.updateLocalJobFromManager({
					notify_fail: 'polluted-id@example.invalid'
				});
				test.ok(!inherited_id_update, "Worker rejected an update with only an inherited job ID");
				test.ok(launch_task.notify_fail == 'safe@example.invalid', "Inherited job ID could not select and mutate a pending job");
			}
			finally {
				delete Object.prototype.id;
			}

			var array_id_update = cronicle.updateLocalJobFromManager({
				id: [ 'unitwatchjob' ],
				notify_success: 'array-id@example.invalid'
			});
			test.ok(!array_id_update, "Worker rejected a coerced array job ID");
			test.ok(!launch_task.notify_success, "Array job ID could not select and mutate a pending job");

			var proto_had_suspended = Object.prototype.hasOwnProperty.call(Object.prototype, 'suspended');
			var proto_suspended = Object.prototype.suspended;
			try {
				var magic_id_update = cronicle.updateLocalJobFromManager({
					id: '__proto__',
					suspended: false
				});
				test.ok(!magic_id_update, "Worker rejected the __proto__ job ID");
				test.ok(
					(Object.prototype.hasOwnProperty.call(Object.prototype, 'suspended') === proto_had_suspended) &&
					(Object.prototype.suspended === proto_suspended),
					"Magic job ID did not mutate Object.prototype"
				);
				test.ok(!cronicle.updateLocalJob({ id: '__proto__', suspended: false }), "Local job lookup rejected an inherited prototype target");
				test.ok(
					(Object.prototype.hasOwnProperty.call(Object.prototype, 'suspended') === proto_had_suspended) &&
					(Object.prototype.suspended === proto_suspended),
					"Direct local lookup did not mutate Object.prototype"
				);
			}
			finally {
				if (proto_had_suspended) Object.prototype.suspended = proto_suspended;
				else delete Object.prototype.suspended;
			}
			
			cronicle.internalQueue = old_queue;
			test.done();
		},

		function testWorkerRunAsLifecycle(test) {
			// Manager-side serialization is platform-neutral, so this models a
			// Windows manager dispatching Plugin identity to a Unix worker.
			var canonical = {
				id: 'unitdebugsudodispatch',
				hostname: server.hostname,
				plugin: 'shellplug',
				command: '/bin/sh',
				cwd: '/srv/cronicle',
				params: {
					script: 'echo safe',
					nested: { answer: 42, enabled: true },
					array_like: { 0: 'zero', length: 1, forEach: 'payload data' },
					_cronicle_run_as: 'nested payload data'
				},
				env: {
					PATH: '/usr/bin', SAFE_VALUE: '1',
					NODE_OPTIONS: '--no-deprecation', LD_PRELOAD: ''
				},
				stdin: true,
				stdin_script: 'echo safe',
				args: 'safe-argument',
				files: [
					{ name: 'first.txt', content: 'first' },
					{ name: 'second.txt', content: 'second' }
				],
				workflow: [
					{ id: 'step-one', title: 'First' },
					{ id: 'step-two', title: 'Second' }
				],
				chain_data: { source: 'trusted', count: 2 },
				secret: 'encrypted-event-secret',
				globalenv: 'encrypted-global-secret',
				cat_secret: 'encrypted-category-secret',
				plug_secret: 'encrypted-plugin-secret'
			};
			cronicle.setJobRunAsFromPlugin(canonical, { uid: 'restricted-user', gid: 'restricted-group' });
			test.ok(canonical.uid == 'restricted-user', 'Manager serialized Plugin UID into the job');
			test.ok(canonical.gid == 'restricted-group', 'Manager serialized Plugin GID into the job');

			var unix_options = cronicle.getChildRunAsOptions(canonical, 'linux', 501, 502);
			test.ok(unix_options.uid == 'restricted-user', 'Unix worker passes Plugin UID to spawn');
			test.ok(unix_options.gid == 'restricted-group', 'Unix worker passes Plugin GID to spawn');

			var windows_options = cronicle.getChildRunAsOptions(canonical, 'win32', 501, 502);
			test.ok(!Object.prototype.hasOwnProperty.call(windows_options, 'uid'), 'Windows worker omits the Unix UID spawn option');
			test.ok(!Object.prototype.hasOwnProperty.call(windows_options, 'gid'), 'Windows worker omits the Unix GID spawn option');

			var zero_job = { id: 'unitzerotype', hostname: server.hostname, plugin: 'shellplug' };
			cronicle.setJobRunAsFromPlugin(zero_job, { uid: 0, gid: 0 });
			var zero_options = cronicle.getChildRunAsOptions(zero_job, 'linux', 501, 502);
			test.ok(zero_options.uid === 0, 'Numeric Plugin UID zero survives manager and worker handling');
			test.ok(zero_options.gid === 0, 'Numeric Plugin GID zero survives manager and worker handling');

			var string_zero_job = { id: 'unitzerotype', hostname: server.hostname, plugin: 'shellplug' };
			cronicle.setJobRunAsFromPlugin(string_zero_job, { uid: '0', gid: '0' });
			var string_zero_options = cronicle.getChildRunAsOptions(string_zero_job, 'linux', 501, 502);
			test.ok(string_zero_options.uid === '0', 'String Plugin UID zero remains compatible');
			test.ok(string_zero_options.gid === '0', 'String Plugin GID zero remains compatible');

			var dispatch_session = new Array(65).join('a');
			var capable_worker = {
				hostname: server.hostname,
				job_dispatch_capabilities: cronicle.getJobDispatchCapabilities(),
				job_dispatch_session: dispatch_session,
				job_dispatch_sequence: 0
			};
			var zero_worker = {
				hostname: server.hostname,
				job_dispatch_capabilities: cronicle.getJobDispatchCapabilities(),
				job_dispatch_session: dispatch_session,
				job_dispatch_sequence: 0
			};
			var string_zero_worker = Tools.copyHash(zero_worker, true);
			var zero_dispatch = cronicle.createJobDispatchPayload(zero_job, zero_worker, false);
			var string_zero_dispatch = cronicle.createJobDispatchPayload(string_zero_job, string_zero_worker, false);
			test.ok(!!cronicle.verifyJobRunAsContext(zero_dispatch, server.hostname, { session: dispatch_session }), 'Numeric zero dispatch signature verified');
			test.ok(!!cronicle.verifyJobRunAsContext(string_zero_dispatch, server.hostname, { session: dispatch_session }), 'String zero dispatch signature verified');
			test.ok(
				zero_dispatch._cronicle_run_as.signature !== string_zero_dispatch._cronicle_run_as.signature,
				'Typed HMAC input distinguishes numeric and string zero'
			);

			var dispatch = cronicle.createJobDispatchPayload(canonical, capable_worker, true);
			test.ok(dispatch !== canonical, 'Trusted debug launch uses an isolated dispatch copy');
			test.ok(!Object.prototype.hasOwnProperty.call(canonical, 'debug_sudo'), 'Manager canonical job has no debug_sudo marker');
			test.ok(!Object.prototype.hasOwnProperty.call(canonical, '_cronicle_run_as'), 'Manager canonical job has no signed transport context');
			test.ok(!Object.prototype.hasOwnProperty.call(dispatch, 'debug_sudo'), 'Wire copy has no legacy debug_sudo marker');
			test.ok(Object.prototype.hasOwnProperty.call(dispatch, '_cronicle_run_as'), 'Wire copy carries a distinct signed transport context');
			test.ok(dispatch._cronicle_run_as.version === 2, 'Wire context uses full-payload dispatch protocol v2');
			test.ok(!!dispatch._cronicle_run_as.payload_sha256.match(/^[a-f0-9]{64}$/), 'Wire context carries a canonical payload digest');
			var dispatch_state = { session: dispatch_session, last_sequence: 0 };
			var verified_context = cronicle.verifyJobRunAsContext(dispatch, server.hostname, dispatch_state);
			test.ok(verified_context && verified_context.mode == 'service', 'Worker verified the signed service run-as context');
			test.ok(dispatch.params.array_like.length === 1, 'Canonical serializer accepts ordinary objects with a length field');

			var tamper_cases = [
				{ name: 'Plugin UID', mutate: function(payload) { payload.uid = 'attacker'; } },
				{ name: 'command', mutate: function(payload) { payload.command = '/bin/sh -c id'; } },
				{ name: 'cwd', mutate: function(payload) { payload.cwd = '/tmp'; } },
				{ name: 'nested params', mutate: function(payload) { payload.params.nested.answer = 7; } },
				{ name: 'nested param type', mutate: function(payload) { payload.params.nested.answer = '42'; } },
				{ name: 'nested context-named param', mutate: function(payload) { payload.params._cronicle_run_as = 'tampered'; } },
				{ name: 'environment', mutate: function(payload) { payload.env.PATH = '/tmp/attacker'; } },
				{ name: 'NODE_OPTIONS environment', mutate: function(payload) { payload.env.NODE_OPTIONS = '--require=/tmp/attacker.js'; } },
				{ name: 'LD_PRELOAD environment', mutate: function(payload) { payload.env.LD_PRELOAD = '/tmp/attacker.so'; } },
				{ name: 'stdin mode', mutate: function(payload) { payload.stdin = false; } },
				{ name: 'stdin script', mutate: function(payload) { payload.stdin_script = 'id'; } },
				{ name: 'detached mode', mutate: function(payload) { payload.detached = 1; } },
				{ name: 'arguments', mutate: function(payload) { payload.args = 'attacker-argument'; } },
				{ name: 'files', mutate: function(payload) { payload.files[0].content = 'replacement'; } },
				{ name: 'files array order', mutate: function(payload) { payload.files.reverse(); } },
				{ name: 'workflow', mutate: function(payload) { payload.workflow[0].id = 'attacker-step'; } },
				{ name: 'workflow array order', mutate: function(payload) { payload.workflow.reverse(); } },
				{ name: 'chain data', mutate: function(payload) { payload.chain_data.source = 'attacker'; } },
				{ name: 'event secret', mutate: function(payload) { payload.secret = 'replacement'; } },
				{ name: 'global secret', mutate: function(payload) { payload.globalenv = 'replacement'; } },
				{ name: 'category secret', mutate: function(payload) { payload.cat_secret = 'replacement'; } },
				{ name: 'Plugin secret', mutate: function(payload) { payload.plug_secret = 'replacement'; } },
				{ name: 'added field', mutate: function(payload) { payload.attacker_field = 'replacement'; } },
				{ name: 'deleted field', mutate: function(payload) { delete payload.cwd; } }
			];
			tamper_cases.forEach(function(tamper_case) {
				var tampered_payload = cronicle.createJobDispatchPayload(canonical, capable_worker, true);
				tamper_case.mutate(tampered_payload);
				test.ok(
					!cronicle.verifyJobRunAsContext(tampered_payload, server.hostname, dispatch_state),
					'Full-payload HMAC rejected tampered ' + tamper_case.name
				);
			});

			var reordered_dispatch = {};
			Object.keys(dispatch).reverse().forEach(function(key) { reordered_dispatch[key] = dispatch[key]; });
			reordered_dispatch.params = {};
			Object.keys(dispatch.params).reverse().forEach(function(key) {
				reordered_dispatch.params[key] = dispatch.params[key];
			});
			reordered_dispatch.env = {};
			Object.keys(dispatch.env).reverse().forEach(function(key) {
				reordered_dispatch.env[key] = dispatch.env[key];
			});
			test.ok(
				!!cronicle.verifyJobRunAsContext(reordered_dispatch, server.hostname, dispatch_state),
				'Canonical digest accepts semantically identical object key ordering'
			);

			var wire_semantics_job = {
				id: 'unitwiresemantics', hostname: server.hostname, plugin: 'shellplug',
				ignored: undefined,
				ignored_function: function() { return 'not on the wire'; },
				values: [ undefined, function() {}, NaN, Infinity, -Infinity, -0 ]
			};
			var wire_semantics_worker = {
				hostname: server.hostname,
				job_dispatch_capabilities: cronicle.getJobDispatchCapabilities(),
				job_dispatch_session: dispatch_session,
				job_dispatch_sequence: 0
			};
			var wire_semantics_dispatch = cronicle.createJobDispatchPayload(
				wire_semantics_job, wire_semantics_worker, false
			);
			test.ok(
				!Object.prototype.hasOwnProperty.call(wire_semantics_dispatch, 'ignored') &&
				!Object.prototype.hasOwnProperty.call(wire_semantics_dispatch, 'ignored_function') &&
				(JSON.stringify(wire_semantics_dispatch.values) == '[null,null,null,null,null,0]'),
				'Manager normalizes undefined, functions and non-finite numbers to exact JSON wire semantics before signing'
			);
			test.ok(
				!!cronicle.verifyJobRunAsContext(wire_semantics_dispatch, server.hostname, { session: dispatch_session }),
				'Worker verifies the normalized Socket.IO JSON payload'
			);

			var cyclic_job = Tools.copyHash(canonical, true);
			cyclic_job.params.cycle = cyclic_job;
			var cyclic_create_failed = false;
			try { cronicle.createJobDispatchPayload(cyclic_job, capable_worker, true); }
			catch (err) { cyclic_create_failed = true; }
			test.ok(cyclic_create_failed, 'Manager fails closed instead of signing a cyclic non-JSON payload');
			var cyclic_wire_job = Tools.copyHash(dispatch, true);
			cyclic_wire_job.params.cycle = cyclic_wire_job;
			test.ok(
				!cronicle.verifyJobRunAsContext(cyclic_wire_job, server.hostname, dispatch_state),
				'Worker fails closed without throwing on a cyclic non-wire payload'
			);

			var bigint_job = Tools.copyHash(canonical, true);
			bigint_job.params.count = BigInt(1);
			var bigint_create_failed = false;
			try { cronicle.createJobDispatchPayload(bigint_job, capable_worker, true); }
			catch (err) { bigint_create_failed = true; }
			test.ok(bigint_create_failed, 'Manager fails closed instead of signing a BigInt non-JSON payload');
			var bigint_wire_job = Tools.copyHash(dispatch, true);
			bigint_wire_job.params.count = BigInt(1);
			test.ok(
				!cronicle.verifyJobRunAsContext(bigint_wire_job, server.hostname, dispatch_state),
				'Worker fails closed without throwing on a BigInt non-wire payload'
			);

			var tampered_signature = cronicle.createJobDispatchPayload(canonical, capable_worker, true);
			var first_signature_char = tampered_signature._cronicle_run_as.signature.charAt(0);
			tampered_signature._cronicle_run_as.signature =
				(first_signature_char == '0' ? '1' : '0') + tampered_signature._cronicle_run_as.signature.slice(1);
			test.ok(!cronicle.verifyJobRunAsContext(tampered_signature, server.hostname, dispatch_state), 'Worker rejected a modified dispatch signature');
			var wrong_job = cronicle.createJobDispatchPayload(canonical, capable_worker, true);
			wrong_job.id = 'unitdebugsudowrongjob';
			test.ok(!cronicle.verifyJobRunAsContext(wrong_job, server.hostname, dispatch_state), 'Signed context could not be rebound to another job ID');
			var wrong_worker = {
				hostname: 'different-worker.example',
				job_dispatch_capabilities: cronicle.getJobDispatchCapabilities(),
				job_dispatch_session: dispatch_session,
				job_dispatch_sequence: 0
			};
			var wrong_worker_dispatch = cronicle.createJobDispatchPayload(canonical, wrong_worker, true);
			test.ok(!cronicle.verifyJobRunAsContext(wrong_worker_dispatch, server.hostname, dispatch_state), 'Context signed for another worker was rejected');
			test.ok(!cronicle.verifyJobRunAsContext(dispatch, 'different-manager.example', dispatch_state), 'Context signed for another manager was rejected');
			var v1_service_dispatch = Tools.copyHash(dispatch, true);
			v1_service_dispatch._cronicle_run_as.version = 1;
			v1_service_dispatch._cronicle_run_as.signature = new Array(65).join('b');
			test.ok(
				!cronicle.verifyJobRunAsContext(v1_service_dispatch, server.hostname, dispatch_state),
				'Worker fails closed for an incoming v1 service-mode context'
			);
			var v1_plugin_dispatch = Tools.copyHash(v1_service_dispatch, true);
			v1_plugin_dispatch._cronicle_run_as.mode = 'plugin';
			test.ok(
				!cronicle.verifyJobRunAsContext(v1_plugin_dispatch, server.hostname, dispatch_state),
				'Worker rejects v1 contexts even when they request only Plugin identity'
			);
			var replayed_dispatch = Tools.copyHash(dispatch, true);

			var original_launch_local_job = cronicle.launchLocalJob;
			var verified_launch_options = null;
			cronicle.launchLocalJob = function(job, launch_options) {
				verified_launch_options = launch_options;
				cronicle.consumeJobDispatchContext(job, launch_options, 'linux', 601);
			};
			try {
				test.ok(cronicle.launchJobFromManager(dispatch, server.hostname, dispatch_state), 'New worker accepted a valid signed dispatch from the new manager');
				test.ok(!cronicle.launchJobFromManager(replayed_dispatch, server.hostname, dispatch_state), 'Worker rejected a replayed sequence in the same dispatch session');
			}
			finally { cronicle.launchLocalJob = original_launch_local_job; }
			test.ok(verified_launch_options && verified_launch_options.service_uid === true, 'Verified service mode became an in-memory launch decision');
			test.ok(dispatch.uid === 601, 'Unix worker materialized its own service UID');
			test.ok(dispatch.gid == 'restricted-group', 'Worker-local debug launch preserved Plugin GID');
			test.ok(!Object.prototype.hasOwnProperty.call(dispatch, '_cronicle_run_as'), 'Worker consumed signed context before persistence');

			// The same object is used for a delayed/retry launch.  Consuming it again
			// must retain the already materialized worker identity without a marker.
			cronicle.consumeJobDispatchContext(dispatch, null, 'linux', 999);
			test.ok(dispatch.uid === 601, 'Retry retained the original worker-local service UID');
			test.ok(!Object.prototype.hasOwnProperty.call(dispatch, 'debug_sudo'), 'Retry state contains no debug_sudo marker');
			test.ok(!Object.prototype.hasOwnProperty.call(dispatch, '_cronicle_run_as'), 'Retry state contains no signed transport context');

			// Manager-first rolling upgrade: a legacy worker never receives an unknown
			// marker.  An admin debug request safely falls back to the Plugin identity.
			var legacy_job = Tools.copyHash(canonical, true);
			legacy_job.hostname = 'legacy-worker.example';
			legacy_job.debug_sudo = 1;
			legacy_job._cronicle_run_as = { forged: true };
			var legacy_payload = cronicle.createJobDispatchPayload(legacy_job, {
				hostname: 'legacy-worker.example',
				job_dispatch_capabilities: Object.create(null)
			}, true);
			test.ok(legacy_payload !== legacy_job, 'Legacy worker receives an isolated clean payload');
			test.ok(legacy_payload.uid == 'restricted-user', 'Legacy worker retains the Plugin UID');
			test.ok(!Object.prototype.hasOwnProperty.call(legacy_payload, 'debug_sudo'), 'Legacy worker receives no debug_sudo marker');
			test.ok(!Object.prototype.hasOwnProperty.call(legacy_payload, '_cronicle_run_as'), 'Legacy worker receives no unknown signed context');

			// Worker-first rolling upgrade: legacy top-level authority is never trusted,
			// and unsigned jobs are rejected before launch.
			var unsigned_launches = 0;
			var unsigned_job = Tools.copyHash(canonical, true);
			unsigned_job.debug_sudo = 1;
			cronicle.launchLocalJob = function() { unsigned_launches++; };
			try {
				test.ok(!cronicle.launchJobFromManager(unsigned_job, server.hostname, { session: dispatch_session, last_sequence: 0 }), 'New worker rejected an unsigned legacy-manager dispatch');
			}
			finally { cronicle.launchLocalJob = original_launch_local_job; }
			test.ok(unsigned_launches === 0, 'Rejected legacy-manager dispatch never reached launchLocalJob');
			cronicle.consumeJobDispatchContext(unsigned_job, null, 'linux', 777);
			test.ok(unsigned_job.uid == 'restricted-user', 'Legacy debug_sudo did not replace the Plugin UID');
			test.ok(!Object.prototype.hasOwnProperty.call(unsigned_job, 'debug_sudo'), 'Legacy debug_sudo was removed defensively');

			var pending_job = cronicle.createJobDispatchPayload({
				id: 'unitdebugsudopending',
				hostname: server.hostname,
				plugin: 'shellplug',
				uid: 'restricted-user',
				gid: 'restricted-group',
				when: Tools.timeNow() + 60
			}, capable_worker, true);
			var pending_context = cronicle.verifyJobRunAsContext(pending_job, server.hostname, { session: dispatch_session });
			var old_enqueue_internal = cronicle.enqueueInternal;
			var captured_pending = null;
			var pending_enqueues = 0;
			cronicle.enqueueInternal = function(job) { captured_pending = job; pending_enqueues++; };
			try {
				cronicle.launchLocalJob(pending_job, { service_uid: pending_context.mode == 'service' });
				cronicle.launchLocalJob(pending_job);
			}
			finally { cronicle.enqueueInternal = old_enqueue_internal; }
			test.ok(captured_pending === pending_job, 'Delayed job entered the worker pending queue');
			test.ok(!Object.prototype.hasOwnProperty.call(pending_job, 'debug_sudo'), 'Worker pending queue contains no debug_sudo marker');
			test.ok(!Object.prototype.hasOwnProperty.call(pending_job, '_cronicle_run_as'), 'Worker pending queue contains no signed transport context');
			test.ok(pending_enqueues === 2, 'Retry re-entered launchLocalJob through the same worker boundary');
			test.ok(!Object.prototype.hasOwnProperty.call(pending_job, 'debug_sudo'), 'Worker retry queue contains no debug_sudo marker');
			test.ok(!Object.prototype.hasOwnProperty.call(pending_job, '_cronicle_run_as'), 'Worker retry queue contains no signed transport context');
			if (process.platform != 'win32') {
				test.ok(pending_job.uid === process.getuid(), 'Pending job stored the executing worker service UID');
			}

			var debug_descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'debug_sudo');
			var uid_descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'uid');
			var gid_descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'gid');
			Object.defineProperty(Object.prototype, 'debug_sudo', { value: 1, enumerable: true, configurable: true, writable: true });
			Object.defineProperty(Object.prototype, 'uid', { value: 0, enumerable: true, configurable: true, writable: true });
			Object.defineProperty(Object.prototype, 'gid', { value: 0, enumerable: true, configurable: true, writable: true });
			try {
				var polluted_job = {};
				cronicle.setJobRunAsFromPlugin(polluted_job, { uid: 'restricted-user', gid: 'restricted-group' });
				cronicle.consumeJobDispatchContext(polluted_job, null, 'linux', 901);
				var polluted_options = cronicle.getChildRunAsOptions(polluted_job, 'linux', 901, 902);
				test.ok(polluted_options.uid == 'restricted-user', 'Inherited debug_sudo did not bypass the Plugin UID');
				test.ok(polluted_options.gid == 'restricted-group', 'Inherited GID did not replace the Plugin GID');

				var inherited_plugin_job = {};
				cronicle.setJobRunAsFromPlugin(inherited_plugin_job, {});
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_plugin_job, 'uid'), 'Inherited Plugin UID was not serialized');
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_plugin_job, 'gid'), 'Inherited Plugin GID was not serialized');

				var inherited_dispatch = cronicle.createJobDispatchPayload(inherited_plugin_job, capable_worker, true);
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_dispatch, 'uid'), 'Wire copy did not materialize an inherited UID');
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_dispatch, 'gid'), 'Wire copy did not materialize an inherited GID');
				cronicle.consumeJobDispatchContext(inherited_dispatch, { service_uid: true }, 'linux', 903);
				test.ok(inherited_dispatch.uid === 903, 'Polluted wire job still materialized the local worker UID');
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_dispatch, '_cronicle_run_as'), 'Polluted wire job consumed its signed context');

				var inherited_capabilities = Object.create({ signed_job_run_as_v2: 2 });
				test.ok(!cronicle.supportsSignedJobDispatch(inherited_capabilities), 'Inherited capability did not enable signed dispatch');
				var inherited_worker_capability = Object.create({
					job_dispatch_capabilities: cronicle.getJobDispatchCapabilities(),
					job_dispatch_ready: false
				});
				inherited_worker_capability.hostname = server.hostname;
				var inherited_capability_payload = cronicle.createJobDispatchPayload(
					canonical, inherited_worker_capability, true
				);
				test.ok(!Object.prototype.hasOwnProperty.call(inherited_capability_payload, '_cronicle_run_as'), 'Inherited worker capability did not authorize a signed context');
				test.ok(cronicle.isWorkerJobDispatchReady(inherited_worker_capability), 'Inherited readiness flag did not disable an otherwise legacy worker object');

				var v1_only_worker = {
					hostname: server.hostname,
					job_dispatch_capabilities: { signed_job_run_as_v1: 1 },
					job_dispatch_session: dispatch_session
				};
				var v1_fallback_payload = cronicle.createJobDispatchPayload(canonical, v1_only_worker, true);
				test.ok(!cronicle.supportsSignedJobDispatch(v1_only_worker.job_dispatch_capabilities), 'V1-only capability is not accepted as full-payload signing');
				test.ok(!Object.prototype.hasOwnProperty.call(v1_fallback_payload, '_cronicle_run_as'), 'V1-only worker receives a clean legacy Plugin-mode payload');
				test.ok(v1_fallback_payload.uid == 'restricted-user', 'V1-only fallback retains the administrator-controlled Plugin UID');
			}
			finally {
				if (debug_descriptor) Object.defineProperty(Object.prototype, 'debug_sudo', debug_descriptor);
				else delete Object.prototype.debug_sudo;
				if (uid_descriptor) Object.defineProperty(Object.prototype, 'uid', uid_descriptor);
				else delete Object.prototype.uid;
				if (gid_descriptor) Object.defineProperty(Object.prototype, 'gid', gid_descriptor);
				else delete Object.prototype.gid;
			}

			test.done();
		},

		function testMixedVersionJobDispatchHandshake(test) {
			var make_socket = function(id) {
				var handlers = Object.create(null);
				var outbound = [];
				return {
					id: id,
					request: { connection: { remoteAddress: '127.0.0.1' } },
					client: { conn: { remoteAddress: '127.0.0.1' } },
					handlers: handlers,
					outbound: outbound,
					on: function(name, handler) { handlers[name] = handler; },
					emit: function(name, data) { outbound.push({ name: name, data: data }); },
					disconnect: function() {}
				};
			};

			var manager_hostname = 'legacy-manager.example';
			var now = Tools.timeNow(true);
			var token = Tools.digestHex(manager_hostname + now + server.config.get('secret_key'));
			var legacy_socket = make_socket('unit-legacy-manager');
			cronicle.handleNewSocket(legacy_socket);
			legacy_socket.handlers.authenticate({
				manager_hostname: manager_hostname,
				now: now,
				token: token
			});
			test.ok(!legacy_socket._pixl_manager, 'New worker rejected an old manager without signed-dispatch capability');
			test.ok(legacy_socket.outbound.some(function(item) {
				return (item.name == 'auth_failure') && item.data && item.data.description.match(/Upgrade managers before workers/);
			}), 'Worker returned an explicit fail-closed rolling-order error');
			legacy_socket.handlers.disconnect();

			var v1_socket = make_socket('unit-v1-manager');
			cronicle.handleNewSocket(v1_socket);
			v1_socket.handlers.authenticate({
				manager_hostname: manager_hostname,
				now: now,
				token: token,
				job_dispatch_capabilities: { signed_job_run_as_v1: 1 }
			});
			test.ok(!v1_socket._pixl_manager, 'New worker rejected a v1-only manager without full-payload signing');
			test.ok(v1_socket.outbound.some(function(item) {
				return (item.name == 'auth_failure') && item.data && item.data.description.match(/Upgrade managers before workers/);
			}), 'V1-only manager received the same fail-closed rolling-order error');
			v1_socket.handlers.disconnect();

			var original_multi = cronicle.multi;
			var original_goworker = cronicle.goworker;
			var original_check_eligibility = cronicle.checkmanagerEligibility;
			var ack = null;
			var current_socket = make_socket('unit-current-manager');
			cronicle.multi = { worker: true, manager: false };
			cronicle.goworker = function() {};
			cronicle.checkmanagerEligibility = function() {};
			try {
				cronicle.handleNewSocket(current_socket);
				current_socket.handlers.authenticate({
					manager_hostname: server.hostname,
					now: now,
					token: Tools.digestHex(server.hostname + now + server.config.get('secret_key')),
					job_dispatch_capabilities: cronicle.getJobDispatchCapabilities()
				}, function(response) { ack = response; });
				test.ok(current_socket._pixl_manager, 'New worker authenticated a capability-advertising manager');
				test.ok(ack && !ack.code && cronicle.supportsSignedJobDispatch(ack.job_dispatch_capabilities), 'Worker acknowledged the exact signed-dispatch capability');
				test.ok(ack && cronicle.isValidJobDispatchSession(ack.job_dispatch_session), 'Worker issued a fresh replay-bound dispatch session');
				current_socket.handlers.disconnect();
			}
			finally {
				cronicle.multi = original_multi;
				cronicle.goworker = original_goworker;
				cronicle.checkmanagerEligibility = original_check_eligibility;
			}

			var worker = { socket: current_socket };
			cronicle.resetWorkerJobDispatchNegotiation(worker);
			test.ok(worker.job_dispatch_ready === false, 'Manager gates a worker while capability negotiation is pending');
			test.ok(cronicle.completeWorkerJobDispatchNegotiation(
				worker, current_socket, cronicle.getJobDispatchCapabilities(), ack.job_dispatch_session
			), 'Manager accepted the current socket capability ACK');
			test.ok(worker.job_dispatch_ready && cronicle.supportsSignedJobDispatch(worker.job_dispatch_capabilities), 'Manager enabled signed dispatch after ACK');
			test.ok(worker.job_dispatch_session === ack.job_dispatch_session && worker.job_dispatch_sequence === 0, 'Manager bound sequence zero to the negotiated socket session');
			var stale_socket = {};
			test.ok(!cronicle.completeWorkerJobDispatchNegotiation(worker, stale_socket, null, null), 'Stale socket could not downgrade negotiated capabilities');

			var invalid_session_worker = { socket: current_socket };
			cronicle.resetWorkerJobDispatchNegotiation(invalid_session_worker);
			test.ok(!cronicle.completeWorkerJobDispatchNegotiation(
				invalid_session_worker, current_socket, cronicle.getJobDispatchCapabilities(), 'invalid'
			), 'Manager rejected a malformed signed-dispatch session');
			test.ok(invalid_session_worker.job_dispatch_ready === false, 'Malformed session kept the worker dispatch gate closed');

			worker = { socket: current_socket };
			cronicle.resetWorkerJobDispatchNegotiation(worker);
			test.ok(cronicle.completeWorkerJobDispatchNegotiation(
				worker, current_socket, { signed_job_run_as_v1: 1 }, null
			), 'Manager treats a v1-only worker as legacy because v1 does not bind the payload');
			test.ok(worker.job_dispatch_ready && !cronicle.supportsSignedJobDispatch(worker.job_dispatch_capabilities), 'V1-only worker was enabled only in clean Plugin-identity mode');

			worker = { socket: current_socket };
			cronicle.resetWorkerJobDispatchNegotiation(worker);
			test.ok(cronicle.completeWorkerJobDispatchNegotiation(worker, current_socket, null, null), 'Manager completed bounded negotiation for an old worker');
			test.ok(worker.job_dispatch_ready && !cronicle.supportsSignedJobDispatch(worker.job_dispatch_capabilities), 'Old worker was enabled only in legacy Plugin-identity mode');
			test.done();
		},

		function testDebugSudoAuthorizationIsNotPersistedInEventQueue(test) {
			var event_id = 'unitdebugsudoqueue';
			var list_path = 'global/event_queue/' + event_id;
			var original_launch_job = cronicle.launchJob;
			var initial_options = null;
			cronicle.launchJob = function(event, callback, options) {
				initial_options = options;
				callback(new Error('Unit test launch deferral'));
			};

			cronicle.launchOrQueueJob({
				id: event_id,
				queue: 1,
				debug_sudo: 1
			}, function(err, jobs) {
				cronicle.launchJob = original_launch_job;
				test.ok(!err, 'Failed launch was queued');
				test.ok(!!jobs && (jobs.length == 0), 'Queued launch returned the zero-job response');
				test.ok(initial_options && initial_options.debug_sudo, 'Initial launch received trusted debug_sudo authorization');

				async.retry({ times: 20, interval: 10 }, function(callback) {
					storage.listGet(list_path, 0, 1, function(queue_err, events) {
						if (queue_err || !events || !events[0]) return callback(queue_err || new Error('Queue item not ready'));
						callback(null, events[0]);
					});
				}, function(queue_err, queued_event) {
					test.ok(!queue_err && !!queued_event, 'Persistent event queue item was stored');
					test.ok(queued_event && !Object.prototype.hasOwnProperty.call(queued_event, 'debug_sudo'), 'Persistent event queue omitted debug_sudo authorization');
					test.ok(queued_event && !Object.prototype.hasOwnProperty.call(queued_event, '_cronicle_run_as'), 'Persistent event queue omitted signed dispatch context');
					delete cronicle.eventQueue[event_id];
					storage.listDelete(list_path, true, function() { test.done(); });
				});
			}, { debug_sudo: true });
		},

		function testJobLogTransferBoundary(test) {
			var outside_log = path.join(os.tmpdir(), 'cronicle-edge-unit-outside-' + process.pid + '.log');
			var traversal_id = '../cronicle-edge-unit-outside-' + process.pid;
			var symlink_id = 'unitfetchsymlink';
			var hardlink_id = 'unitfetchhardlink';
			var legacy_id = 'unitfetchlegacy';
			var valid_id = 'unitfetchvalid';
			var empty_id = 'unitfetchempty';
			var symlink_log = cronicle.getJobLogFilePath(symlink_id, false);
			var hardlink_log = cronicle.getJobLogFilePath(hardlink_id, false);
			var hardlink_copy = hardlink_log + '.copy';
			var legacy_log = cronicle.getJobLogFilePath(legacy_id, false);
			var valid_log = cronicle.getJobLogFilePath(valid_id, false);
			var empty_log = cronicle.getJobLogFilePath(empty_id, false);

			[ outside_log, symlink_log, hardlink_log, hardlink_copy, legacy_log, valid_log, empty_log ].forEach(function (file) {
				try { fs.unlinkSync(file); }
				catch (err) { if (err.code != 'ENOENT') throw err; }
			});
			fs.writeFileSync(outside_log, 'OUTSIDE SECRET');

			var original_request_get = cronicle.request.get;
			var fetch_calls = [];
			var source_worker = {
				hostname: 'real-worker.example',
				ip: '127.0.0.1',
				active_jobs: {
					unitsourcebinding: { id: 'unitsourcebinding', hostname: 'real-worker.example', detached: 0 },
					unitunknownsource: { id: 'unitunknownsource', hostname: 'real-worker.example', detached: 0 }
				}
			};
			cronicle.remoteLogFetchJobs.unitsourcebinding = {
				id: 'unitsourcebinding',
				hostname: 'real-worker.example',
				detached: 0,
				category: 'general',
				target: 'maingrp'
			};
			cronicle.request.get = function () { fetch_calls.push(true); };
			cronicle.fetchStoreJobLog({
				id: 'unitsourcebinding',
				hostname: 'forged-worker.example',
				log_file: outside_log
			}, source_worker);
			test.ok(fetch_calls.length == 0, "Worker payload cannot redirect a fetch to another host");
			cronicle.fetchStoreJobLog({
				id: 'unitunknownsource',
				hostname: 'real-worker.example'
			}, source_worker);
			test.ok(fetch_calls.length == 0, "Worker cannot choose an ID absent from the manager snapshot");
			cronicle.request.get = original_request_get;

			cronicle.remoteLogFetchJobs.unitfinishbinding = {
				id: 'unitfinishbinding',
				hostname: 'real-worker.example',
				detached: 1,
				category: 'manager-category',
				target: 'manager-group',
				event: 'manager-event',
				event_title: 'Manager Event',
				plugin: 'manager-plugin'
			};
			var bound_finished_job = cronicle.bindRemoteFinishedJob({
				id: 'unitfinishbinding',
				hostname: 'real-worker.example',
				detached: 0,
				category: 'forged-category',
				target: 'forged-group',
				event: 'forged-event',
				event_title: 'Forged Event',
				plugin: 'forged-plugin',
				code: 7,
				description: 'worker result'
			}, source_worker);
			test.ok(!!bound_finished_job, "Assigned worker completion was accepted");
			test.ok(bound_finished_job.hostname == 'real-worker.example', "Completion hostname came from the manager snapshot");
			test.ok(bound_finished_job.detached == 1, "Completion detached mode came from the manager snapshot");
			test.ok(bound_finished_job.category == 'manager-category', "Completion category came from the manager snapshot");
			test.ok(bound_finished_job.target == 'manager-group', "Completion group came from the manager snapshot");
			test.ok(bound_finished_job.event == 'manager-event', "Completion event came from the manager snapshot");
			test.ok(bound_finished_job.event_title == 'Manager Event', "Completion title came from the manager snapshot");
			test.ok(bound_finished_job.plugin == 'manager-plugin', "Completion plugin came from the manager snapshot");
			test.ok((bound_finished_job.code == 7) && (bound_finished_job.description == 'worker result'), "Worker result fields were retained");
			test.ok(!cronicle.bindRemoteFinishedJob({ id: 'unitfinishbinding' }, {
				hostname: 'different-worker.example'
			}), "A different worker could not finish the assigned job");
			delete cronicle.remoteLogFetchJobs.unitfinishbinding;

			async.series([
				function (callback) {
					// Descriptor close must wait for delayed read and write callbacks on
					// protocol/storage error paths.
					var events = [];
					var fake_io = {
						read: function (fd, buffer, offset, length, position, done) {
							setTimeout(function () {
								buffer.write('R', offset);
								events.push('read');
								done(null, 1, buffer);
							}, 30);
						},
						write: function (fd, buffer, offset, length, position, done) {
							setTimeout(function () {
								events.push('write');
								done(null, length, buffer);
							}, 20);
						},
						close: function (fd, done) {
							events.push('close');
							done();
						}
					};
					var owner = cronicle.createJobLogDescriptorOwner(123, fake_io);
					owner.read(Buffer.alloc(1), 0, 1, 0, function (err) { test.ok(!err, "Delayed descriptor read completed"); });
					owner.write(Buffer.from('W'), 0, 1, 0, function (err) { test.ok(!err, "Delayed descriptor write completed"); });
					owner.close(function (err) {
						test.ok(!err, "Descriptor owner closed without error");
						test.ok(events.indexOf('close') > events.indexOf('read'), "Descriptor close waited for pending read");
						test.ok(events.indexOf('close') > events.indexOf('write'), "Descriptor close waited for pending write");
						callback();
					});
					test.ok(events.indexOf('close') < 0, "Descriptor did not close synchronously over pending I/O");
				},
				function (callback) {
					var original_delete = cronicle.deleteJobLogIfUnchanged;
					var delete_calls = 0;
					cronicle.deleteJobLogIfUnchanged = function () { delete_calls++; };
					var failed_response = new EventEmitter();
					var failed_source = new EventEmitter();
					cronicle.deleteJobLogAfterCompleteTransfer(failed_response, failed_source, 'failed.log', {});
					failed_response.emit('finish');
					failed_source.emit('error', new Error('deliberate read failure'));
					test.ok(delete_calls == 0, "Response finish after source error did not delete worker log");

					var good_response = new EventEmitter();
					var good_source = new EventEmitter();
					cronicle.deleteJobLogAfterCompleteTransfer(good_response, good_source, 'good.log', {});
					good_source.emit('end');
					test.ok(delete_calls == 0, "Clean source EOF alone did not delete before response finish");
					good_response.emit('finish');
					test.ok(delete_calls == 1, "Clean source EOF plus response finish deleted exactly once");

					var short_response = new EventEmitter();
					var short_source = new EventEmitter();
					short_source.jobLogComplete = false;
					short_source.jobLogBytesRead = 4;
					cronicle.deleteJobLogAfterCompleteTransfer(short_response, short_source, 'short.log', {}, 10);
					short_source.emit('end');
					short_response.emit('finish');
					test.ok(delete_calls == 1, "Clean EOF shorter than the committed size preserved the worker log");
					cronicle.deleteJobLogIfUnchanged = original_delete;
					callback();
				},
				function (callback) {
					// A disconnected HTTP client must destroy a paused source and close
					// its held descriptor after any pending positional read, without
					// deleting the worker log.
					var original_delete = cronicle.deleteJobLogIfUnchanged;
					var delete_calls = 0;
					var events = [];
					cronicle.deleteJobLogIfUnchanged = function () { delete_calls++; };
					var fake_io = {
						read: function (fd, buffer, offset, length, position, done) {
							setTimeout(function () {
								buffer.write('R', offset);
								events.push('read');
								done(null, 1, buffer);
							}, 20);
						},
						close: function (fd, done) {
							events.push('close');
							test.ok(events.indexOf('close') > events.indexOf('read'), "Aborted transfer waited for pending descriptor read");
							test.ok(delete_calls == 0, "Aborted transfer preserved the worker log");
							cronicle.deleteJobLogIfUnchanged = original_delete;
							done();
							callback();
						}
					};
					var owner = cronicle.createJobLogDescriptorOwner(456, fake_io);
					var source = cronicle.createJobLogDescriptorStream(owner, 1024);
					var close_descriptor = function () { owner.close(function () {}); };
					source.once('end', close_descriptor);
					source.once('error', close_descriptor);
					source.once('close', close_descriptor);
					var response = new EventEmitter();
					cronicle.deleteJobLogAfterCompleteTransfer(response, source, 'aborted.log', {}, 1024);
					source.read(1);
					response.emit('close');
					test.ok(source.destroyed, "Response close destroyed the paused source stream");
					test.ok(events.indexOf('close') < 0, "Descriptor remained open while its read was pending");
				},
				function (callback) {
					var original_upload = cronicle.uploadJobLog;
					var upload_calls = 0;
					cronicle.uploadJobLog = function () { upload_calls++; };
					cronicle.request.get = function (url, options, request_callback) {
						fetch_calls.push({ url: url, options: options });
						cronicle.request.get = original_request_get;
						var private_dir = path.dirname(options.download.path);
						test.ok(url.indexOf('path=') < 0, "Manager protocol has no path parameter");
						test.ok((url.indexOf(outside_log) < 0) && (url.indexOf(encodeURIComponent(outside_log)) < 0), "Manager did not forward worker-supplied log_file");
						test.ok(path.basename(options.download.path) == 'unitsourcebinding.log', "Manager tied the temporary filename to the known job ID");
						test.ok((fs.statSync(private_dir).mode & 0o777) == 0o700, "Manager download directory is private");
						var response_aborted = false;
						var response = {
							statusCode: 200,
							headers: { 'content-type': 'application/json' },
							destroy: function () { response_aborted = true; this.destroyed = true; }
						};
						var accepted = options.preflight(null, response, options.download);
						test.ok(accepted === false, "Manager rejected HTTP 200 without the transfer protocol header");
						test.ok(response_aborted, "Manager aborted incompatible response instead of buffering its body");
						request_callback(null, response, Buffer.from('{"code":"api"}'));
						setTimeout(function () {
							test.ok(upload_calls == 0, "Incompatible HTTP 200 body was not uploaded as a job log");
							test.ok(!fs.existsSync(private_dir), "Rejected manager download was cleaned from the private directory");
							cronicle.uploadJobLog = original_upload;
							callback();
						}, 50);
					};
					cronicle.fetchStoreJobLog({
						id: 'unitsourcebinding',
						hostname: 'real-worker.example',
						log_file: outside_log
					}, source_worker);
				},
				function (callback) {
					// A protocol-valid 200 response is not sufficient: storage must only
					// begin after the downloaded bytes exactly match Content-Length.
					cronicle.remoteLogFetchJobs.unitsourcebinding = {
						id: 'unitsourcebinding',
						hostname: 'real-worker.example',
						detached: 0,
						category: 'general',
						target: 'maingrp'
					};
					var original_descriptor_store = cronicle.storeJobLogFromDescriptor;
					var store_calls = 0;
					var private_dir = '';
					cronicle.storeJobLogFromDescriptor = function () { store_calls++; };
					cronicle.request.get = function (url, options, request_callback) {
						cronicle.request.get = original_request_get;
						private_dir = path.dirname(options.download.path);
						var response = Readable.from([ 'SHORT' ]);
						response.statusCode = 200;
						response.headers = {
							'content-type': 'text/plain; charset=utf-8',
							'x-cronicle-job-log-protocol': '2',
							'content-length': '6'
						};
						options.download.once('finish', function () {
							request_callback(null, response);
							setTimeout(function () {
								test.ok(store_calls == 0, "Short manager download was not stored");
								test.ok(!fs.existsSync(private_dir), "Short manager download was cleaned up");
								cronicle.storeJobLogFromDescriptor = original_descriptor_store;
								callback();
							}, 50);
						});
						options.preflight(null, response, options.download);
					};
					cronicle.fetchStoreJobLog({
						id: 'unitsourcebinding',
						hostname: 'real-worker.example'
					}, source_worker);
				},
				function (callback) {
					// A same-UID job can discover and replace a manager temp pathname.
					// Prove the storage upload remains bound to the O_EXCL descriptor.
					cronicle.remoteLogFetchJobs.unitsourcebinding = {
						id: 'unitsourcebinding',
						hostname: 'real-worker.example',
						detached: 0,
						category: 'general',
						target: 'maingrp'
					};
					var original_put_stream = cronicle.storage.putStream;
					var original_descriptor_store = cronicle.storeJobLogFromDescriptor;
					var original_copy_dir = server.config.get('copy_job_logs_to');
					var archive_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-job-archive-'));
					server.config.set('copy_job_logs_to', archive_dir);
					var manager_temp_path = '';
					var held_path = '';
					var stored_bytes = '';
					var descriptor_store_done = false;
					var replacement_skipped = false;
					cronicle.storeJobLogFromDescriptor = function (job, fd, store_callback) {
						original_descriptor_store.call(cronicle, job, fd, function (err) {
							descriptor_store_done = true;
							store_callback(err);
						});
					};
					cronicle.storage.putStream = function (key, gzip_stream, put_callback) {
						var chunks = [];
						test.ok(key == 'jobs/unitsourcebinding/log.txt.gz', "Manager stored the known job ID slot");
						gzip_stream.on('data', function (chunk) { chunks.push(chunk); });
						gzip_stream.on('end', function () {
							zlib.gunzip(Buffer.concat(chunks), function (err, data) {
								test.ok(!err, "Descriptor-backed manager upload produced valid gzip");
								stored_bytes = String(data || '');
								put_callback(err);
							});
						});
					};
					cronicle.request.get = function (url, options, request_callback) {
						cronicle.request.get = original_request_get;
						manager_temp_path = options.download.path;
						held_path = manager_temp_path + '.held';
						var response = Readable.from([ 'ORIGINAL MANAGER DOWNLOAD' ]);
						response.statusCode = 200;
						response.headers = {
							'content-type': 'text/plain; charset=utf-8',
							'x-cronicle-job-log-protocol': '2',
							'content-length': String(Buffer.byteLength('ORIGINAL MANAGER DOWNLOAD'))
						};
						options.download.once('finish', function () {
							fs.renameSync(manager_temp_path, held_path);
							try { fs.symlinkSync(outside_log, manager_temp_path); }
							catch (err) {
								if ((err.code != 'EPERM') && (err.code != 'EACCES') && (err.code != 'ENOTSUP')) throw err;
								replacement_skipped = true;
								test.ok(true, "Manager replacement regression skipped because this platform forbids symlink creation");
							}
							request_callback(null, response);
						});
						options.preflight(null, response, options.download);
					};
					cronicle.fetchStoreJobLog({
						id: 'unitsourcebinding',
						hostname: 'real-worker.example',
						event_title: 'Descriptor Archive',
						log_file: outside_log
					}, source_worker);

					var check_upload = function () {
						var archive_files = fs.readdirSync(archive_dir);
						if (!stored_bytes || !descriptor_store_done || !archive_files.length) return setTimeout(check_upload, 10);
						test.ok(stored_bytes == 'ORIGINAL MANAGER DOWNLOAD', "Path replacement could not change manager upload bytes");
						if (!replacement_skipped) test.ok(stored_bytes.indexOf('OUTSIDE SECRET') < 0, "Manager did not upload replacement symlink contents");
						test.ok(archive_files.length == 1, "Descriptor-backed manager upload created one optional archive");
						test.ok(fs.readFileSync(path.join(archive_dir, archive_files[0]), 'utf8') == 'ORIGINAL MANAGER DOWNLOAD', "Optional archive used the same held descriptor bytes");
						cronicle.storage.putStream = original_put_stream;
						cronicle.storeJobLogFromDescriptor = original_descriptor_store;
						server.config.set('copy_job_logs_to', original_copy_dir);
						fs.unlinkSync(path.join(archive_dir, archive_files[0]));
						fs.rmdirSync(archive_dir);
						try { fs.unlinkSync(manager_temp_path); } catch (err) { if (err.code != 'ENOENT') return callback(err); }
						try { fs.unlinkSync(held_path); } catch (err) { if (err.code != 'ENOENT') return callback(err); }
						try { fs.rmdirSync(path.dirname(manager_temp_path)); } catch (err) { if (err.code != 'ENOENT') return callback(err); }
						callback();
					};
					check_upload();
				},
				function (callback) {
					// The old protocol allowed an authenticated caller to select any path.
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						path: outside_log,
						auth: Tools.digestHex(outside_log + config.secret_key)
					});
					request.get(url, function (err, resp, data) {
						test.ok(!err, "Signed outside-path request completed");
						test.ok(resp.statusCode == 403, "Signed outside path was rejected");
						test.ok(String(data).indexOf('OUTSIDE SECRET') < 0, "Outside file contents were not disclosed");
						test.ok(fs.existsSync(outside_log), "Outside file was not deleted");
						callback();
					});
				},
				function (callback) {
					// A new worker safely accepts the exact canonical request from an old
					// manager, allowing worker-first rolling upgrades.
					fs.writeFileSync(legacy_log, 'LEGACY CANONICAL LOG');
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						path: legacy_log,
						auth: Tools.digestHex(legacy_log + config.secret_key)
					});
					request.get(url, function (err, resp, data) {
						test.ok(!err, "Canonical legacy request completed");
						test.ok(resp.statusCode == 200, "Canonical legacy request remained compatible");
						test.ok(String(data) == 'LEGACY CANONICAL LOG', "Canonical legacy request returned exact bytes");
						test.ok(resp.headers['x-cronicle-job-log-protocol'] == '2', "Compatible worker advertises protocol v2");
						setTimeout(function () {
							test.ok(!fs.existsSync(legacy_log), "Canonical legacy job log was deleted after transfer");
							callback();
						}, 50);
					});
				},
				function (callback) {
					// Canonical equality, not a restrictive character allowlist, is the
					// security boundary for worker-first compatibility.
					var old_log_dir = server.config.get('log_dir');
					var spaced_log_dir = path.join(os.tmpdir(), 'cronicle edge logs ' + process.pid);
					fs.mkdirSync(path.join(spaced_log_dir, 'jobs'), { recursive: true });
					server.config.set('log_dir', spaced_log_dir);
					var spaced_id = 'unitfetchlegacyspace';
					var spaced_log = cronicle.getJobLogFilePath(spaced_id, false);
					fs.writeFileSync(spaced_log, 'LEGACY PATH WITH SPACE');
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						path: spaced_log,
						auth: Tools.digestHex(spaced_log + config.secret_key)
					});
					request.get(url, function (err, resp, data) {
						test.ok(!err, "Canonical legacy path with spaces completed");
						test.ok(resp.statusCode == 200, "Canonical legacy path with spaces remained compatible");
						test.ok(String(data) == 'LEGACY PATH WITH SPACE', "Legacy path with spaces returned exact bytes");
						setTimeout(function () {
							test.ok(!fs.existsSync(spaced_log), "Legacy path with spaces was deleted after complete transfer");
							server.config.set('log_dir', old_log_dir);
							fs.rmdirSync(path.join(spaced_log_dir, 'jobs'));
							fs.rmdirSync(spaced_log_dir);
							callback();
						}, 50);
					});
				},
				function (callback) {
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						id: traversal_id,
						detached: 0,
						auth: cronicle.getJobLogFetchAuth(traversal_id, false)
					});
					request.get(url, function (err, resp, data) {
						test.ok(!err, "Traversal request completed");
						test.ok(resp.statusCode == 200, "Traversal ID returned an API error");
						test.ok(String(data).indexOf('OUTSIDE SECRET') < 0, "Traversal did not disclose outside contents");
						test.ok(fs.existsSync(outside_log), "Traversal did not delete the outside file");
						callback();
					});
				},
				function (callback) {
					try { fs.symlinkSync(outside_log, symlink_log); }
					catch (err) {
						if ((err.code == 'EPERM') || (err.code == 'EACCES') || (err.code == 'ENOTSUP')) {
							test.ok(true, "Symlink regression skipped because this platform forbids symlink creation");
							return callback();
						}
						return callback(err);
					}
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						id: symlink_id,
						detached: 0,
						auth: cronicle.getJobLogFetchAuth(symlink_id, false)
					});
					request.get(url, function (err, resp, data) {
						test.ok(!err, "Symlink request completed");
						test.ok(resp.statusCode == 404, "Symlink job log was rejected");
						test.ok(String(data).indexOf('OUTSIDE SECRET') < 0, "Symlink target contents were not disclosed");
						test.ok(fs.lstatSync(symlink_log).isSymbolicLink(), "Rejected symlink was preserved");
						test.ok(fs.existsSync(outside_log), "Symlink target was preserved");
						fs.unlinkSync(symlink_log);
						callback();
					});
				},
				function (callback) {
					fs.writeFileSync(hardlink_log, 'HARD LINK LOG');
					try { fs.linkSync(hardlink_log, hardlink_copy); }
					catch (err) {
						fs.unlinkSync(hardlink_log);
						if ((err.code == 'EPERM') || (err.code == 'EACCES') || (err.code == 'ENOTSUP')) {
							test.ok(true, "Hardlink regression skipped because this platform forbids hardlink creation");
							return callback();
						}
						return callback(err);
					}
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						id: hardlink_id,
						detached: 0,
						auth: cronicle.getJobLogFetchAuth(hardlink_id, false)
					});
					request.get(url, function (err, resp) {
						test.ok(!err, "Hardlink request completed");
						test.ok(resp.statusCode == 404, "Multiply linked job log was rejected");
						test.ok(fs.existsSync(hardlink_log) && fs.existsSync(hardlink_copy), "Rejected hardlinks were preserved");
						fs.unlinkSync(hardlink_log);
						fs.unlinkSync(hardlink_copy);
						callback();
					});
				},
				function (callback) {
					fs.writeFileSync(valid_log, 'VALID JOB LOG');
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						id: valid_id,
						detached: 0,
						auth: cronicle.getJobLogFetchAuth(valid_id, false)
					});
					request.get(url, { headers: { 'Accept-Encoding': 'identity' } }, function (err, resp, data) {
						test.ok(!err, "Valid job-log request completed");
						test.ok(resp.statusCode == 200, "Valid in-directory job log was served");
						test.ok(String(data) == 'VALID JOB LOG', "Valid job log bytes matched");
						test.ok(/^text\/plain/i.test(resp.headers['content-type']), "Worker log is text/plain");
						test.ok(resp.headers['content-length'] == String(Buffer.byteLength('VALID JOB LOG')), "Worker committed the exact log byte count");
						test.ok(resp.headers['x-content-type-options'] == 'nosniff', "Worker log disables MIME sniffing");
						test.ok(/no-store/.test(resp.headers['cache-control']), "Worker log is not cacheable");
						setTimeout(function () {
							test.ok(!fs.existsSync(valid_log), "Valid job log was deleted after the complete response");
							callback();
						}, 50);
					});
				},
				function (callback) {
					fs.writeFileSync(empty_log, '');
					var url = api_url + '/app/fetch_delete_job_log' + Tools.composeQueryString({
						id: empty_id,
						detached: 0,
						auth: cronicle.getJobLogFetchAuth(empty_id, false)
					});
					request.get(url, { headers: { 'Accept-Encoding': 'identity' } }, function (err, resp, data) {
						test.ok(!err, "Empty job-log request completed");
						test.ok(resp.statusCode == 200, "Empty in-directory job log was served");
						test.ok(Buffer.byteLength(data || '') == 0, "Empty job log returned zero bytes");
						test.ok(resp.headers['content-length'] == '0', "Empty job log committed a zero-byte length");
						setTimeout(function () {
							test.ok(!fs.existsSync(empty_log), "Empty job log was deleted after the complete response");
							callback();
						}, 50);
					});
				},
				function (callback) {
					// Reproduce a path replacement after the safe descriptor is opened.
					var race_id = 'unitfetchrace';
					var race_log = cronicle.getJobLogFilePath(race_id, false);
					var opened_log = race_log + '.opened';
					try { fs.unlinkSync(race_log); } catch (err) { if (err.code != 'ENOENT') throw err; }
					try { fs.unlinkSync(opened_log); } catch (err) { if (err.code != 'ENOENT') throw err; }
					fs.writeFileSync(race_log, 'ORIGINAL DESCRIPTOR');
					cronicle.openJobLogFile(race_log, function (err, fd, opened) {
						test.ok(!err, "Race test opened the original regular file");
						fs.renameSync(race_log, opened_log);
						fs.writeFileSync(race_log, 'REPLACEMENT FILE');
						var buffer = Buffer.alloc(64);
						fs.read(fd, buffer, 0, buffer.length, 0, function (err, bytes_read) {
							test.ok(!err, "Race test read from the opened descriptor");
							test.ok(String(buffer.subarray(0, bytes_read)) == 'ORIGINAL DESCRIPTOR', "Replacement could not change streamed bytes");
							fs.close(fd, function () {
								cronicle.deleteJobLogIfUnchanged(race_log, opened);
								setTimeout(function () {
									test.ok(fs.readFileSync(race_log, 'utf8') == 'REPLACEMENT FILE', "Cleanup did not delete a replacement path");
									fs.unlinkSync(race_log);
									fs.unlinkSync(opened_log);
									callback();
								}, 50);
							});
						});
					});
				}
			], function (err) {
				delete cronicle.remoteLogFetchJobs.unitsourcebinding;
				try { fs.unlinkSync(outside_log); } catch (cleanup_err) { if (cleanup_err.code != 'ENOENT') throw cleanup_err; }
				test.ok(!err, "Job log transfer boundary checks completed");
				test.done();
			});
		},
	
		
		function testAPIPing(test) {
			// make basic REST API call, check response
			request.json( api_url + '/app/ping', {}, function(err, resp, data) {
				
				test.ok( !err, "No error requesting ping API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from ping API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				test.done();
			} );
		},
		
		function testAPILoginBadUsername(test) {
			// login with unknown username
			var params = { 
				username: "nobody", 
				password: "foo" 
			};
			request.json( api_url + '/user/login', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting user/login API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from user/login API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code != 0, "Code is non-zero (we expect an error)" );
				test.ok( !data.session_id, "No session_id in response" );
				
				test.done();
			} );
		},
		
		function testAPILoginBadPassword(test) {
			// login with good user but bad password
			var params = { 
				username: "admin", 
				password: "adminnnnnnn" 
			};
			request.json( api_url + '/user/login', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting user/login API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from user/login API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code != 0, "Code is non-zero (we expect an error)" );
				test.ok( !data.session_id, "No session_id in response" );
				
				test.done();
			} );
		},

		function testAPIOAuthOnlyRejectsPasswordLogin(test) {
			// oauth-only mode must reject even a valid local password
			var oauth = server.config.get('oauth');
			oauth.enabled = true;
			oauth.only = true;

			var params = {
				username: "admin",
				password: "admin"
			};
			request.json( api_url + '/user/login', params, function(err, resp, data) {
				oauth.only = false;
				oauth.enabled = false;

				test.ok( !err, "No error requesting user/login API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from user/login API" );
				test.ok( data.code == 'login', "Password login is rejected in OAuth-only mode" );
				test.ok( !data.session_id, "No session_id in response" );

				test.done();
			} );
		},

		function testDisabledGroupUserCannotLogin(test) {
			var username = 'disabled_ldap_user';
			var userPath = 'users/' + username;
			var oldGroups = server.config.get('groups');
			var userComponent = server.User;
			var oldLDAPAuth = userComponent.do_ldap_auth;
			var ldapCalls = 0;
			var disabledUser = {
				username: username,
				active: 0,
				ext_auth: true,
				group_auth: true,
				email: 'disabled@example.invalid',
				full_name: 'Disabled LDAP User',
				privileges: { admin: 1 }
			};

			server.config.set('groups', { allow: 1 });
			userComponent.do_ldap_auth = async function() {
				ldapCalls++;
				return {
					username: username,
					active: 1,
					ext_auth: true,
					email: 'disabled@example.invalid',
					full_name: 'Disabled LDAP User',
					privileges: { admin: 1 }
				};
			};

			storage.put(userPath, disabledUser, function(err) {
				test.ok(!err, "Disabled LDAP group user was stored");
				userComponent.api_login({
					params: { username: username, password: 'valid' },
					ip: '127.0.0.1',
					request: { headers: { 'user-agent': 'unit-test' } }
				}, function(data) {
					test.ok(data.code != 0, "Disabled LDAP group user login was rejected");
					test.ok(ldapCalls == 0, "LDAP was not called for the disabled user");
					storage.get(userPath, function(err, storedUser) {
						test.ok(!err, "Disabled LDAP group user still exists");
						test.ok(storedUser.active === 0, "Disabled LDAP group user remained disabled");

						userComponent.do_ldap_auth = oldLDAPAuth;
						server.config.set('groups', oldGroups);
						storage.delete(userPath, function() { test.done(); });
					});
				});
			});
		},

		function testGroupUserIgnoresLocalPasswordReset(test) {
			var username = 'ldap_user_with_local_lock';
			var userPath = 'users/' + username;
			var oldGroups = server.config.get('groups');
			var userComponent = server.User;
			var oldLDAPAuth = userComponent.do_ldap_auth;
			var ldapCalls = 0;
			var groupUser = {
				username: username,
				active: 1,
				ext_auth: true,
				group_auth: true,
				force_password_reset: 1,
				email: 'ldap-user@example.invalid',
				full_name: 'LDAP User',
				privileges: { admin: 1 }
			};

			server.config.set('groups', { allow: 1 });
			userComponent.do_ldap_auth = async function() {
				ldapCalls++;
				return {
					username: username,
					active: 1,
					ext_auth: true,
					email: 'ldap-user@example.invalid',
					full_name: 'LDAP User',
					privileges: { admin: 1 }
				};
			};

			storage.put(userPath, groupUser, function(err) {
				test.ok(!err, "LDAP group user with a local lock was stored");
				userComponent.api_login({
					params: { username: username, password: 'valid' },
					ip: '127.0.0.1',
					request: { headers: { 'user-agent': 'unit-test' } }
				}, function(data) {
					test.ok(data.code == 0, "LDAP group user ignored the local password reset lock");
					test.ok(ldapCalls == 1, "LDAP authenticated the group user");
					storage.get(userPath, function(err, storedUser) {
						test.ok(!err, "LDAP group user still exists");
						test.ok(!storedUser.force_password_reset, "Local password reset lock was not retained");

						userComponent.do_ldap_auth = oldLDAPAuth;
						server.config.set('groups', oldGroups);
						var cleanupUser = function() {
							storage.delete(userPath, function() { test.done(); });
						};
						if (data.session_id) storage.delete('sessions/' + data.session_id, cleanupUser);
						else cleanupUser();
					});
				});
			});
		},
		
		function testAPIUserLogin(test) {
			// login as admin (successfully), save session id for downstream tests
			var params = { 
				username: "admin", 
				password: "admin" 
			};
			request.json( api_url + '/user/login', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting user/login API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from user/login API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.session_id, "Found session_id in response" );
				
				// save session_id for later
				session_id = data.session_id;
				
				test.done();
			} );
		},

		function testCreateScopedLogSessions(test) {
			var records = [
				[ 'category_denied', {
					username: 'unit_log_category_denied',
					full_name: 'Category Denied',
					email: 'category-denied@example.invalid',
					active: 1,
					privileges: { cat_limit: 1, grp_limit: 1, grp_maingrp: 1 }
				} ],
				[ 'group_denied', {
					username: 'unit_log_group_denied',
					full_name: 'Group Denied',
					email: 'group-denied@example.invalid',
					active: 1,
					privileges: { cat_limit: 1, cat_general: 1, grp_limit: 1 }
				} ],
				[ 'allowed', {
					username: 'unit_log_allowed',
					full_name: 'Log Allowed',
					email: 'log-allowed@example.invalid',
					active: 1,
					privileges: { cat_limit: 1, cat_general: 1, grp_limit: 1, grp_maingrp: 1 }
				} ]
			];

			async.eachSeries(records, function (record, callback) {
				var session_key = log_auth_sessions[record[0]];
				storage.put('users/' + record[1].username, record[1], function (err) {
					if (err) return callback(err);
					storage.put('sessions/' + session_key, {
						id: session_key,
						username: record[1].username,
						created: Tools.timeNow(true),
						modified: Tools.timeNow(true)
					}, callback);
				});
			}, function (err) {
				test.ok(!err, "Scoped log users and sessions were created");
				test.done();
			});
		},
		
		function testAPIConfig(test) {
			// test app/config api
			var params = {};
			request.get( api_url + '/app/config', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( data.indexOf('"oauth_button_label":"SSO"') >= 0, "OAuth button label is included in client config" );
				test.ok( data.indexOf('"oauth_only":0') >= 0, "OAuth-only mode defaults to disabled" );
				test.ok( data.indexOf('"oauth_auto_login":0') >= 0, "OAuth auto-login defaults to disabled" );
				
				test.done();
			} );
		},
		
		// app/create_plugin
		
		function testAPICreatePlugin(test) {
			// test app/create_plugin api
			var self = this;
			var params = {"params":[{"type":"textarea","id":"script","title":"Script Source","rows":10,"value":"#!/bin/sh\n\n# Enter your shell script code here"}],"title":"Copy of Shell Script","command":"bin/shell-plugin.js","enabled":1,"uid":0,"gid":"0","session_id":session_id};
			
			request.json( api_url + '/app/create_plugin', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.id, "Found new id in data" );
				
				// save plugin id for later
				self.plugin_id = data.id;
				
				// check to see that plugin actually got saved to storage
				storage.listFind( 'global/plugins', { id: data.id }, function(err, plugin) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!plugin, "Data record record is non-null" );
					test.ok( plugin.username == "admin", "Username is correct" );
					test.ok( plugin.created > 0, "Record creation date is non-zero" );
					test.ok( plugin.uid === 0, "Numeric UID zero was stored" );
					test.ok( plugin.gid === '0', "String GID zero was stored without losing its type" );
					
					test.done();
				} );
			} );
		},
		
		// app/update_plugin
		
		function testAPIUpdatePlugin(test) {
			// test app/update_plugin api
			var self = this;
			var params = {"id":this.plugin_id, "title":"Updated Plugin Title","uid":"0","gid":0,"session_id":session_id};
			
			request.json( api_url + '/app/update_plugin', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that plugin actually got saved to storage
				storage.listFind( 'global/plugins', { id: self.plugin_id }, function(err, plugin) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!plugin, "Data record is non-null" );
					test.ok( plugin.username == "admin", "Username is correct" );
					test.ok( plugin.created > 0, "Record creation date is non-zero" );
					test.ok( plugin.title == "Updated Plugin Title", "Title was updated correctly" );
					test.ok( plugin.uid === '0', "String UID zero was accepted on update" );
					test.ok( plugin.gid === 0, "Numeric GID zero was accepted on update" );
					
					test.done();
				} );
			} );
		},
		
		// app/delete_plugin
		
		function testAPIDeletePlugin(test) {
			// test app/delete_plugin api
			var self = this;
			var params = {"id":this.plugin_id, "session_id":session_id};
			
			request.json( api_url + '/app/delete_plugin', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that plugin actually got deleted from storage
				storage.listFind( 'global/plugins', { id: self.plugin_id }, function(err, plugin) {
					test.ok( !err, "No error expected for missing data" );
					test.ok( !plugin, "Data record should be null (deleted)" );
					
					delete self.plugin_id;
					
					test.done();
				} );
			} );
		},
		
		// app/create_category
		
		function testAPICreateCategory(test) {
			// test app/create_category api
			var self = this;
			var params = {"title":"test will del cat","description":"yo","max_children":0,"enabled":1,"notify_success":"","notify_fail":"","web_hook":"","cpu_limit":0,"cpu_sustain":0,"memory_limit":0,"memory_sustain":0,"log_max_size":0,"session_id":session_id};
			
			request.json( api_url + '/app/create_category', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.id, "Found new id in data" );
				
				// save cat id for later
				self.cat_id = data.id;
				
				// check to see that cat actually got saved to storage
				storage.listFind( 'global/categories', { id: data.id }, function(err, cat) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!cat, "Data record record is non-null" );
					test.ok( cat.username == "admin", "Username is correct" );
					test.ok( cat.created > 0, "Record creation date is non-zero" );
					
					test.done();
				} );
			} );
		},
		
		// app/update_category
		
		function testAPIUpdateCategory(test) {
			// test app/update_category api
			var self = this;
			var params = {"id":this.cat_id, "title":"Updated Category Title","session_id":session_id};
			
			request.json( api_url + '/app/update_category', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that cat actually got saved to storage
				storage.listFind( 'global/categories', { id: self.cat_id }, function(err, cat) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!cat, "Data record is non-null" );
					test.ok( cat.username == "admin", "Username is correct" );
					test.ok( cat.created > 0, "Record creation date is non-zero" );
					test.ok( cat.title == "Updated Category Title", "Title was updated correctly" );
					
					test.done();
				} );
			} );
		},
		
		// app/delete_category
		
		function testAPIDeleteCategory(test) {
			// test app/delete_category api
			var self = this;
			var params = {"id":this.cat_id, "session_id":session_id};
			
			request.json( api_url + '/app/delete_category', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that cat actually got deleted from storage
				storage.listFind( 'global/categories', { id: self.cat_id }, function(err, cat) {
					test.ok( !err, "No error expected for missing data" );
					test.ok( !cat, "Data record should be null (deleted)" );
					
					delete self.cat_id;
					
					test.done();
				} );
			} );
		},
		
		// app/create_server_group
		
		function testAPICreateServerGroup(test) {
			// test app/create_server_group api
			var self = this;
			var params = {"title":"del gap","regexp":"dasds","manager":0,"session_id":session_id};
			
			request.json( api_url + '/app/create_server_group', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.id, "Found new id in data" );
				
				// save group id for later
				self.group_id = data.id;
				
				// check to see that group actually got saved to storage
				storage.listFind( 'global/server_groups', { id: data.id }, function(err, group) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!group, "Data record record is non-null" );
					test.ok( group.title == "del gap", "Title is correct" );
					test.ok( group.regexp == "dasds", "Regexp is correct" );
					
					test.done();
				} );
			} );
		},
		
		// app/update_server_group
		
		function testAPIUpdateServerGroup(test) {
			// test app/update_server_group api
			var self = this;
			var params = {"id":this.group_id, "title":"Updated Group Title","session_id":session_id};
			
			request.json( api_url + '/app/update_server_group', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that group actually got saved to storage
				storage.listFind( 'global/server_groups', { id: self.group_id }, function(err, group) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!group, "Data record is non-null" );
					test.ok( group.title == "Updated Group Title", "Title was updated correctly" );
					
					test.done();
				} );
			} );
		},
		
		// app/delete_server_group
		
		function testAPIDeleteServerGroup(test) {
			// test app/delete_server_group api
			var self = this;
			var params = {"id":this.group_id, "session_id":session_id};
			
			request.json( api_url + '/app/delete_server_group', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that group actually got deleted from storage
				storage.listFind( 'global/server_groups', { id: self.group_id }, function(err, group) {
					test.ok( !err, "No error expected for missing data" );
					test.ok( !group, "Data record should be null (deleted)" );
					
					delete self.group_id;
					
					test.done();
				} );
			} );
		},
		
		// app/create_api_key
		
		function testAPICreateAPIKey(test) {
			// test app/create_api_key api
			var self = this;
			var params = {"key":"35b60c12892dd4503cf3a8dbf22d3354","privileges":{"admin":0,"create_events":0,"edit_events":0,"delete_events":1,"run_events":0,"abort_events":0,"state_update":0},"active":"1","title":"test will delete","description":"dshfdwsfs","session_id":session_id};
			
			request.json( api_url + '/app/create_api_key', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.id, "Found new id in data" );
				test.ok( !!data.key, "Found new api key in data" );
				
				// save api key id for later
				self.apikey_id = data.id;
				self.apikey_key = data.key;
				
				// check to see that api key actually got saved to storage
				storage.listFind( 'global/api_keys', { id: data.id }, function(err, api_key) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!api_key, "Data record is non-null" );
					test.ok( api_key.username == "admin", "Username is correct" );
					test.ok( api_key.created > 0, "Record creation date is non-zero" );
					test.ok( !!api_key.key, "API Key record has key" );
					test.ok( api_key.key == "35b60c12892dd4503cf3a8dbf22d3354", "API Key is correct" );
					
					test.done();
				} );
			} );
		},
		
		function testAPIKeyUsage(test) {
			// try to hit an API using the API Key as auth (not a user session id)
			var self = this;
			var params = { "api_key": this.apikey_key, offset: 0, limit: 100 };
			
			request.json( api_url + '/app/get_schedule', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				test.done();
			} );
		},
		
		function testAPIKeyUnauthorized(test) {
			// try to access an API that is unauthorized for an API Key
			// an error is expected here
			var self = this;
			var params = {"title":"this should fail","description":"yo key","max_children":0,"enabled":1,"notify_success":"","notify_fail":"","web_hook":"","cpu_limit":0,"cpu_sustain":0,"memory_limit":0,"memory_sustain":0,"api_key":this.apikey_key};
			
			request.json( api_url + '/app/create_category', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API", err );
				test.ok( resp.statusCode == 200, "HTTP 200 from API", resp.statusCode );
				test.ok( "code" in data, "Found code prop in JSON response", data );
				test.ok( data.code != 0, "Code is non-zero (error is expected)", data );
				
				test.done();
			} );
		},
		
		// app/update_api_key
		
		function testAPIUpdateAPIKey(test) {
			// test app/update_api_key api
			var self = this;
			var params = {"id":this.apikey_id, "title":"Updated API Key Title","session_id":session_id};
			
			request.json( api_url + '/app/update_api_key', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that api key actually got saved to storage
				storage.listFind( 'global/api_keys', { id: self.apikey_id }, function(err, api_key) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!api_key, "Data record is non-null" );
					test.ok( api_key.username == "admin", "Username is correct" );
					test.ok( api_key.created > 0, "Record creation date is non-zero" );
					test.ok( api_key.title == "Updated API Key Title", "Title was updated correctly" );
					
					test.done();
				} );
			} );
		},
		
		// app/get_api_keys
		
		function testAPIGetAPIKeys(test) {
			// test app/get_api_keys api
			var self = this;
			var params = { "session_id": session_id, offset: 0, limit: 100 };
			
			request.json( api_url + '/app/get_api_keys', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.rows, "Found rows in response" );
				test.ok( !!data.rows.length, "Rows has length" );
				
				var api_key = Tools.findObject( data.rows, { id: self.apikey_id } );
				test.ok( !!api_key, "Found our API Key in rows" );
				test.ok( api_key.id == self.apikey_id, "API Key ID matches our query" );
				test.ok( api_key.username == "admin", "Username is correct" );
				test.ok( api_key.created > 0, "Record creation date is non-zero" );
				test.ok( !!api_key.key, "API Key record has key" );
				
				test.done();
				
			} );
		},
		
		// app/get_api_key
		
		function testAPIGetAPIKey(test) {
			// test app/get_api_key api
			var self = this;
			var params = { "session_id": session_id, id: this.apikey_id };
			
			request.json( api_url + '/app/get_api_key', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				var api_key = data.api_key;
				test.ok( !!api_key, "Found our API Key in data" );
				test.ok( api_key.id == self.apikey_id, "API Key ID matches our query" );
				test.ok( api_key.username == "admin", "Username is correct" );
				test.ok( api_key.created > 0, "Record creation date is non-zero" );
				test.ok( !!api_key.key, "API Key record has key" );
				
				test.done();
				
			} );
		},
		
		// app/delete_api_key
		
		function testAPIDeleteAPIKey(test) {
			// test app/delete_api_key api
			var self = this;
			var params = {"id":this.apikey_id, "session_id":session_id};
			
			request.json( api_url + '/app/delete_api_key', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that api key actually got deleted from storage
				storage.listFind( 'global/api_keys', { id: self.apikey_id }, function(err, api_key) {
					test.ok( !err, "No error expected for missing data" );
					test.ok( !api_key, "Data record should be null (deleted)" );
					
					delete self.apikey_id;
					
					test.done();
				} );
			} );
		},
		
		// app/create_event
		
		function testAPICreateEvent(test) {
			// test app/create_event api
			var self = this;
			var params = {
				"enabled": 1,
				"params": {
					"duration": "10",
					"progress": 1,
					"action": "Success",
					"secret": "foo"
				},
				"timing": {
					"years": [2001], // we'll run it manually first
					"minutes": [0]
				},
				"max_children": 1,
				"timeout": 300,
				"catch_up": 0,
				"timezone": cronicle.tz,
				"plugin": "testplug",
				"title": "Well Test!",
				"category": "general",
				"target": "maingrp",
				"multiplex": 0,
				"retries": 0,
				"retry_delay": 0,
				"detached": 0,
				"notify_success": "",
				"notify_fail": "",
				"web_hook": "",
				"cpu_limit": 0,
				"cpu_sustain": 0,
				"memory_limit": 0,
				"memory_sustain": 0,
				"notes": "",
				"uid": 0,
				"gid": 0,
				"cwd": "/tmp",
				"env": { "PATH": "/tmp" },
				"debug_sudo": 1,
				"session_id": session_id
			};
			
			request.json( api_url + '/app/create_event', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.id, "Found new id in data" );
				
				// save event id for later
				self.event_id = data.id;
				
				// check to see that event actually got saved to storage
				storage.listFind( 'global/schedule', { id: data.id }, function(err, event) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!event, "Data record record is non-null" );
					test.ok( event.username == "admin", "Username is correct" );
					test.ok( event.created > 0, "Record creation date is non-zero" );
					test.ok( !('uid' in event), "Event-level uid was not stored" );
					test.ok( !('gid' in event), "Event-level gid was not stored" );
					test.ok( !('cwd' in event), "Event-level cwd was not stored" );
					test.ok( !('env' in event), "Event-level env was not stored" );
					test.ok( !('debug_sudo' in event), "Event-level debug_sudo authorization was not stored" );
					
					test.done();
				} );
			} );
		},
		
		// app/update_event
		
		function testAPIUpdateEvent(test) {
			// test app/update_event api
			var self = this;
			var params = {
				"id": this.event_id,
				"title": "Updated Event Title",
				"debug_sudo": 1,
				"session_id": session_id
			};
			
			request.json( api_url + '/app/update_event', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that event actually got saved to storage
				storage.listFind( 'global/schedule', { id: self.event_id }, function(err, event) {
					test.ok( !err, "No error fetching data" );
					test.ok( !!event, "Data record record is non-null" );
					test.ok( event.username == "admin", "Username is correct" );
					test.ok( event.created > 0, "Record creation date is non-zero" );
					test.ok( event.title == "Updated Event Title", "New title is correct" );
					test.ok( !('debug_sudo' in event), "Event update did not persist debug_sudo authorization" );
					
					test.done();
				} );
			} );
		},

		function testNonAdminCannotPersistOrLaunchDebugSudo(test) {
			var key_record = {
				id: 'unitnonadmin',
				key: 'unitnonadminkey',
				title: 'Unit Non-Admin',
				username: 'unit-non-admin',
				active: 1,
				privileges: {
					admin: 0,
					create_events: 1,
					edit_events: 1,
					run_events: 1
				}
			};
			var event_id = 'unitdebugsudo';
			var original_launch_local_job = cronicle.launchLocalJob;
			var captured_job = null;

			async.series([
				function(callback) {
					storage.listPush('global/api_keys', key_record, callback);
				},
				function(callback) {
					storage.listFindUpdate('global/plugins', { id: 'shellplug' }, {
						uid: 'trusted-plugin-user',
						gid: 'trusted-plugin-group'
					}, callback);
				},
				function(callback) {
					request.json(api_url + '/app/create_event', {
						id: event_id,
						title: 'Non-Admin Debug Sudo Regression',
						enabled: 1,
						category: 'general',
						target: 'maingrp',
						plugin: 'shellplug',
						params: { script: testScript },
						debug_sudo: 1,
						api_key: key_record.key
					}, function(err, resp, data) {
						test.ok(!err, 'Non-admin create_event request completed');
						test.ok(resp && (resp.statusCode == 200), 'Non-admin create_event returned HTTP 200');
						test.ok(data && (data.code == 0), 'Non-admin with create privilege created the event');
						storage.listFind('global/schedule', { id: event_id }, function(find_err, event) {
							test.ok(!find_err && !!event, 'Created non-admin event was stored');
							test.ok(event && !Object.prototype.hasOwnProperty.call(event, 'debug_sudo'), 'Non-admin create_event did not persist debug_sudo');
							callback(find_err || (!event ? new Error('Event was not stored') : null));
						});
					});
				},
				function(callback) {
					request.json(api_url + '/app/update_event', {
						id: event_id,
						debug_sudo: 1,
						api_key: key_record.key
					}, function(err, resp, data) {
						test.ok(!err, 'Non-admin update_event request completed');
						test.ok(resp && (resp.statusCode == 200), 'Non-admin update_event returned HTTP 200');
						test.ok(data && (data.code == 0), 'Non-admin with edit privilege updated the event');
						storage.listFind('global/schedule', { id: event_id }, function(find_err, event) {
							test.ok(!find_err && !!event, 'Updated non-admin event remained stored');
							test.ok(event && !Object.prototype.hasOwnProperty.call(event, 'debug_sudo'), 'Non-admin update_event did not persist debug_sudo');
							callback(find_err || (!event ? new Error('Event disappeared') : null));
						});
					});
				},
				function(callback) {
					cronicle.launchLocalJob = function(job) { captured_job = job; };
					request.json(api_url + '/app/run_event', {
						id: event_id,
						debug_sudo: 1,
						api_key: key_record.key
					}, function(err, resp, data) {
						cronicle.launchLocalJob = original_launch_local_job;
						test.ok(!err, 'Non-admin run_event request completed');
						test.ok(resp && (resp.statusCode == 200), 'Non-admin run_event returned HTTP 200');
						test.ok(data && (data.code == 0), 'Non-admin with run privilege launched the event');
						test.ok(!!captured_job, 'Captured the non-admin launched job');
						test.ok(captured_job && (captured_job.uid == 'trusted-plugin-user'), 'Non-admin launch retained Plugin UID');
						test.ok(captured_job && !Object.prototype.hasOwnProperty.call(captured_job, 'debug_sudo'), 'Non-admin launch had no debug_sudo marker');
						callback(err);
					});
				}
			], function(err) {
				cronicle.launchLocalJob = original_launch_local_job;
				async.parallel([
					function(callback) {
						storage.listFindDelete('global/schedule', { id: event_id }, function() { callback(); });
					},
					function(callback) {
						storage.listFindDelete('global/api_keys', { id: key_record.id }, function() { callback(); });
					},
					function(callback) {
						storage.listFindUpdate('global/plugins', { id: 'shellplug' }, { uid: '', gid: '' }, function() { callback(); });
					}
				], function() {
					test.ok(!err, 'Non-admin debug_sudo lifecycle regression completed');
					test.done();
				});
			});
		},
		
		// app/get_schedule
		
		function testAPIGetSchedule(test) {
			// test app/get_schedule api
			var self = this;
			var params = { "session_id": session_id, offset: 0, limit: 100 };
			
			request.json( api_url + '/app/get_schedule', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.rows, "Found rows in response" );
				test.ok( !!data.rows.length, "Rows has length" );
				
				var event = Tools.findObject( data.rows, { id: self.event_id } );
				test.ok( !!event, "Found our event in rows" );
				test.ok( event.id == self.event_id, "Event ID matches our query" );
				test.ok( event.username == "admin", "Username is correct" );
				test.ok( event.created > 0, "Record creation date is non-zero" );
				
				test.done();
				
			} );
		},
		
		// app/get_event
		
		function testAPIGetEvent(test) {
			// test app/get_event api
			var self = this;
			var params = { "session_id": session_id, id: this.event_id };
			
			request.json( api_url + '/app/get_event', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				var event = data.event;
				test.ok( !!event, "Found our event in data" );
				test.ok( event.id == self.event_id, "Event ID matches our query" );
				test.ok( event.username == "admin", "Username is correct" );
				test.ok( event.created > 0, "Record creation date is non-zero" );
				
				test.done();
				
			} );
		},

		function testWorkflowCapabilityScope(test) {
			var self = this;
			var parent_id = 'unitwfparent';
			var skipped_id = 'unitwfskipped';
			var disabled_id = 'unitwfdisabled';
			var allowed_id = 'unitwfallowed';
			var outside_id = 'unitwfoutside';
			var owned_job_id = 'unitwfowned';
			var inherited_job_id = 'unitwfinherited';
			var foreign_job_id = 'unitwfforeign';
			var remote_worker = 'unit-workflow-worker';
			var pending_key = 'unit_workflow_pending';
			var fixture_event_ids = [ skipped_id, disabled_id, allowed_id, outside_id ];
			var original_secret = server.config.get('secret_key');
			var signature = Tools.digestHex(parent_id + original_secret, 'MD5');
			var original_launch = cronicle.launchOrQueueJob;
			var original_abort = cronicle.abortJob;
			var original_transaction = cronicle.logTransaction;
			var captured_launch = null;
			var captured_abort = null;
			var captured_transaction = null;
			var parent = null;
			var finished = false;

			function clone(value) {
				return JSON.parse(JSON.stringify(value));
			}

			function workflowHeaders(custom_signature, custom_id) {
				return {
					'x-wf-id': (typeof custom_id == 'undefined') ? parent_id : custom_id,
					'x-wf-signature': (typeof custom_signature == 'undefined') ? signature : custom_signature
				};
			}

			function workflowRequest(action, data, callback, custom_signature, custom_id) {
				request.json(api_url + '/app/' + action, data || {}, {
					headers: workflowHeaders(custom_signature, custom_id)
				}, callback);
			}

			function workflowRequestPath(path, data, callback) {
				request.json(api_url + path, data || {}, {
					headers: workflowHeaders()
				}, callback);
			}

			function expectDenied(action, data, message, callback, custom_signature, custom_id) {
				workflowRequest(action, data, function(err, resp, body) {
					test.ok(!err, message + " returned an API response");
					test.ok(resp && resp.statusCode == 200, message + " returned HTTP 200");
					test.ok(body && body.code != 0, message + " was denied");
					callback();
				}, custom_signature, custom_id);
			}

			function expectDeniedPath(path, data, message, callback) {
				workflowRequestPath(path, data, function(err, resp, body) {
					test.ok(!err, message + " returned an API response");
					test.ok(resp && resp.statusCode == 200, message + " returned HTTP 200");
					test.ok(body && body.code != 0, message + " was denied");
					callback();
				});
			}

			function installParentActive(value) {
				cronicle.activeJobs[parent_id] = clone(value || parent);
			}

			function removeParentLocations() {
				delete cronicle.activeJobs[parent_id];
				delete cronicle.internalQueue[pending_key];
				delete cronicle.workers[remote_worker];
				delete cronicle.deadJobs[parent_id];
			}

			function cleanup(callback) {
				if (finished) return callback();
				finished = true;
				server.config.set('secret_key', original_secret);
				cronicle.launchOrQueueJob = original_launch;
				cronicle.abortJob = original_abort;
				cronicle.logTransaction = original_transaction;
				removeParentLocations();
				[ owned_job_id, inherited_job_id, foreign_job_id ].forEach(function(id) {
					delete cronicle.activeJobs[id];
				});

				async.eachSeries(fixture_event_ids, function(id, next) {
					storage.listFindDelete('global/schedule', { id: id }, function() { next(); });
				}, function() {
					async.eachSeries([ owned_job_id, foreign_job_id ], function(id, next) {
						storage.delete('jobs/' + id, function() { next(); });
					}, callback);
				});
			}

			cronicle.launchOrQueueJob = function(job, callback) {
				captured_launch = job;
				callback(null, [ { id: 'unitwflaunched', event: job.id } ]);
			};
			cronicle.abortJob = function(stub) {
				captured_abort = stub;
				return true;
			};
			cronicle.logTransaction = function(action, item, data) {
				if (action == 'job_run') captured_transaction = data;
				return original_transaction.apply(cronicle, arguments);
			};

			async.series([
				function setupFixtures(callback) {
					storage.listFind('global/schedule', { id: self.event_id }, function(err, event) {
						test.ok(!err && !!event, "Workflow test loaded an event template");
						if (err || !event) return callback(err || new Error('Missing event template'));

						var events = fixture_event_ids.map(function(id) {
							var item = clone(event);
							item.id = id;
							item.title = 'Workflow fixture ' + id;
							item.category = 'general';
							item.target = 'maingrp';
							item.params = { duration: '1', secret: 'must-not-leak' };
							return item;
						});

						async.eachSeries(events, function(item, next) {
							storage.listPush('global/schedule', item, next);
						}, function(err) {
							if (err) return callback(err);

							parent = {
								id: parent_id,
								hostname: server.hostname,
								plugin: 'workflow',
								category: 'workflow_parent_category',
								target: 'workflow_parent_target',
								workflow: [
									{ id: skipped_id },
									{ id: disabled_id, disabled: 1 },
									{ id: allowed_id }
								],
								options: { wf_start_from_step: 2 }
							};

							cronicle.activeJobs[owned_job_id] = {
								id: owned_job_id,
								hostname: server.hostname,
								event: allowed_id,
								category: 'general',
								target: 'maingrp',
								source_id: parent_id,
								when: Tools.timeNow(true) + 30,
								retries: 2,
								params: { secret: 'active-secret' }
							};
							cronicle.activeJobs[foreign_job_id] = {
								id: foreign_job_id,
								hostname: server.hostname,
								event: outside_id,
								category: 'general',
								target: 'maingrp',
								source_id: 'anotherworkflow',
								params: { secret: 'foreign-secret' }
							};

							var inherited = Object.create({ source_id: parent_id });
							Object.assign(inherited, {
								id: inherited_job_id,
								hostname: server.hostname,
								event: allowed_id,
								category: 'general',
								target: 'maingrp'
							});
							cronicle.activeJobs[inherited_job_id] = inherited;

							async.series([
								function(next) {
									storage.put('jobs/' + owned_job_id, {
										id: owned_job_id,
										event: allowed_id,
										source_id: parent_id,
										category: 'general',
										target: 'maingrp',
										code: 0,
										description: 'owned complete',
										elapsed: 1.25,
										memo: 'owned memo',
										secret: 'completed-secret',
										params: { secret: 'completed-param-secret' }
									}, next);
								},
								function(next) {
									storage.put('jobs/' + foreign_job_id, {
										id: foreign_job_id,
										event: outside_id,
										source_id: 'anotherworkflow',
										category: 'general',
										target: 'maingrp',
										code: 1,
										description: 'foreign complete',
										secret: 'foreign-completed-secret'
									}, next);
								}
							], callback);
						});
					});
				},
				function helperAndPrototypeChecks(callback) {
					test.ok(signature == cronicle.getWorkflowSignature(parent_id), "Workflow signature kept the legacy wire format");
					test.ok(signature.length == 32, "Workflow signature remained 32 hexadecimal characters");
					test.ok(!cronicle.workflowSignatureMatches(parent_id, signature.substring(1)), "Short signature failed closed without throwing");

					var event_map = cronicle.getWorkflowEventMap(parent);
					test.ok(!Object.prototype.hasOwnProperty.call(event_map, skipped_id), "Start-step excluded an earlier child");
					test.ok(!Object.prototype.hasOwnProperty.call(event_map, disabled_id), "Disabled child was excluded");
					test.ok(Object.prototype.hasOwnProperty.call(event_map, allowed_id), "Later cross-scope child was allowed");

					var invalid_start = clone(parent);
					invalid_start.options.wf_start_from_step = 'not-a-number';
					test.ok(Object.keys(cronicle.getWorkflowEventMap(invalid_start)).length == 0, "NaN start-step allowed no child");
					invalid_start.options.wf_start_from_step = Infinity;
					test.ok(Object.keys(cronicle.getWorkflowEventMap(invalid_start)).length == 0, "Infinite start-step allowed no child");
					invalid_start.options.wf_start_from_step = Symbol('invalid-start');
					test.ok(Object.keys(cronicle.getWorkflowEventMap(invalid_start)).length == 0, "Throwing start-step coercion failed closed");

					var sparse = new Array(1);
					Object.defineProperty(Array.prototype, '0', {
						value: { id: outside_id }, enumerable: true, configurable: true
					});
					try {
						test.ok(Object.keys(cronicle.getWorkflowEventMap({ workflow: sparse })).length == 0, "Inherited sparse-array step was ignored");
					}
					finally { delete Array.prototype[0]; }

					var inherited_disabled = Object.create({ disabled: true });
					inherited_disabled.id = allowed_id;
					test.ok(Object.keys(cronicle.getWorkflowEventMap({ workflow: [ inherited_disabled ] })).length == 0, "Inherited truthy disabled flag failed closed");

					var inherited_options = Object.create({ wf_start_from_step: Infinity });
					test.ok(Object.keys(cronicle.getWorkflowEventMap({ workflow: [ { id: allowed_id } ], options: inherited_options })).length == 0, "Inherited invalid start-step failed closed");

					var inherited_workflow = Object.create({ workflow: [ { id: outside_id } ] });
					inherited_workflow.id = parent_id;
					inherited_workflow.plugin = 'workflow';
					test.ok(Object.keys(cronicle.getWorkflowEventMap(inherited_workflow)).length == 0, "Inherited workflow snapshot was ignored");

					Object.defineProperty(Object.prototype, parent_id, {
						value: clone(parent), enumerable: true, configurable: true
					});
					try {
						test.ok(!cronicle.findJob(parent_id), "Inherited parent hash entry was not treated as a job");
						test.ok(!cronicle.getWorkflowCapability(parent_id, signature), "Inherited parent could not mint a workflow capability");
					}
					finally { delete Object.prototype[parent_id]; }

					var inherited_id_job = Object.create({ id: parent_id });
					inherited_id_job.plugin = 'workflow';
					cronicle.activeJobs.unitwfinheritedid = inherited_id_job;
					test.ok(!cronicle.findJob(parent_id), "Inherited job id was not selected");
					delete cronicle.activeJobs.unitwfinheritedid;

					var inherited_action_job = Object.create({ action: 'launchLocalJob' });
					Object.assign(inherited_action_job, clone(parent));
					cronicle.internalQueue.unitwfinheritedaction = inherited_action_job;
					test.ok(!cronicle.findJob(parent_id), "Inherited pending action was not selected");
					delete cronicle.internalQueue.unitwfinheritedaction;
					test.ok(!cronicle.findJob('__proto__'), "Prototype-control job id was rejected");

					var raw_args = {
						request: { headers: workflowHeaders(), url: '/api/app/run_event' }
					};
					cronicle.captureWorkflowAuthHeaders(raw_args);
					test.ok(!Object.prototype.hasOwnProperty.call(raw_args.request.headers, 'x-wf-signature'), "Workflow signature was removed before API logging");
					test.ok(raw_args._workflow_auth && raw_args._workflow_auth.signature == signature, "Workflow signature remained request-local");
					test.ok(JSON.stringify(raw_args).indexOf(signature) < 0, "Request-local workflow bearer was non-enumerable");
					callback();
				},
				function rejectInvalidAndUntrustedParents(callback) {
					installParentActive();
					async.series([
						function(next) {
							Object.defineProperties(Object.prototype, {
								'_workflow_auth': {
									value: { id: parent_id, signature: signature }, configurable: true
								},
								'x-wf-id': { value: parent_id, configurable: true },
								'x-wf-signature': { value: signature, configurable: true }
							});
							cronicle.loadSession({
								cookies: {}, params: {}, query: {},
								request: { headers: {}, url: '/api/app/run_event' }
							}, function(err) {
								delete Object.prototype._workflow_auth;
								delete Object.prototype['x-wf-id'];
								delete Object.prototype['x-wf-signature'];
								test.ok(!!err, "Inherited workflow authentication material was ignored");
								next();
							});
						},
						function(next) {
							expectDenied('run_event', { id: allowed_id }, "Wrong workflow signature", next, 'short');
						},
						function(next) {
							cronicle.activeJobs[parent_id].plugin = 'testplug';
							expectDenied('run_event', { id: allowed_id }, "Non-workflow parent", function() {
								cronicle.activeJobs[parent_id].plugin = 'workflow';
								next();
							});
						}
					], callback);
				},
				function enforceWorkflowChildScope(callback) {
					async.eachSeries([
						{ data: { id: skipped_id }, name: 'Start-step-skipped child' },
						{ data: { id: disabled_id }, name: 'Disabled child' },
						{ data: { id: outside_id }, name: 'Unlisted child' },
						{ data: { title: 'Workflow fixture ' + allowed_id }, name: 'Title-only child lookup' }
					], function(entry, next) {
						expectDenied('run_event', entry.data, entry.name, next);
					}, callback);
				},
				function allowOnlyRuntimeInputs(callback) {
					captured_launch = null;
					captured_transaction = null;
					var allowed_now = Tools.timeNow(true) - 10;
					workflowRequest('run_event', {
						id: allowed_id,
						now: allowed_now,
						arg: 'allowed-arg',
						args: 'allowed-args',
						post_data: { allowed: true },
						plugin: 'attacker_plugin',
						target: 'attacker_target',
						params: { secret: 'attacker-secret' },
						workflow: [ { id: outside_id } ],
						source: 'attacker-source',
						source_id: 'attacker-parent',
						api_key: signature
					}, function(err, resp, body) {
						test.ok(!err && body && body.code == 0, "Allowed workflow child launched");
						test.ok(captured_launch && captured_launch.id == allowed_id, "Workflow launched the allowlisted event");
						test.ok(captured_launch && captured_launch.source_id == parent_id, "Child provenance was server-bound to the workflow");
						test.ok(captured_launch && captured_launch.source == 'Workflow (' + parent_id + ')', "Child source was server-derived");
						test.ok(captured_launch && !Object.prototype.hasOwnProperty.call(captured_launch, 'api_key'), "Workflow bearer was not persisted on the child");
						test.ok(captured_launch && captured_launch.plugin != 'attacker_plugin', "Workflow could not replace the child plugin");
						test.ok(captured_launch && captured_launch.target != 'attacker_target', "Workflow could not replace the child target");
						test.ok(captured_launch && captured_launch.params && captured_launch.params.secret == 'must-not-leak', "Stored child parameters replaced caller parameters");
						test.ok(captured_launch && captured_launch.now == allowed_now, "Workflow retained the allowed now input");
						test.ok(captured_launch && captured_launch.arg == 'allowed-arg', "Workflow retained the allowed arg input");
						test.ok(captured_launch && captured_launch.args == 'allowed-args', "Workflow retained the allowed args input");
						test.ok(captured_launch && captured_launch.post_data && captured_launch.post_data.allowed, "Workflow retained the allowed POST input");
						test.ok(captured_transaction && captured_transaction.headers &&
							!Object.prototype.hasOwnProperty.call(captured_transaction.headers, 'x-wf-signature'),
							"Workflow bearer was absent from transaction metadata");
						callback();
					});
				},
				function projectWorkflowReads(callback) {
					async.series([
						function(next) {
							workflowRequest('get_schedule', {}, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Workflow read its scoped schedule");
								test.ok(body.rows && body.rows.length == 1 && body.rows[0].id == allowed_id, "Scoped schedule contained only the runnable child");
								test.ok(body.rows && Object.keys(body.rows[0]).sort().join(',') == 'id,title', "Scoped schedule returned only id and title");
								next();
							});
						},
						function(next) {
							var active_jobs_prototype = Object.getPrototypeOf(cronicle.activeJobs);
							Object.setPrototypeOf(cronicle.activeJobs, {
								unitwfprototypechild: {
									id: 'unitwfprototypechild', event: allowed_id,
									source_id: parent_id, params: { secret: 'prototype-secret' }
								}
							});
							workflowRequest('get_active_jobs', {}, function(err, resp, body) {
								Object.setPrototypeOf(cronicle.activeJobs, active_jobs_prototype);
								test.ok(!err && body && body.code == 0, "Workflow read its scoped active jobs");
								test.ok(body.jobs && body.jobs[owned_job_id] && !body.jobs[foreign_job_id], "Active projection contained only an owned child");
								test.ok(body.jobs && !body.jobs.unitwfprototypechild, "Inherited active-job entry was ignored");
								test.ok(body.jobs && !body.jobs[owned_job_id].params && !body.jobs[owned_job_id].category, "Active projection omitted private job fields");
								next();
							});
						},
						function(next) {
							workflowRequest('get_job_details', { id: owned_job_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Workflow read an owned completed child");
								test.ok(body.job && body.job.memo == 'owned memo', "Completed projection retained workflow status fields");
								test.ok(body.job && !body.job.secret && !body.job.params && !body.job.category, "Completed projection omitted private fields");
								next();
							});
						},
						function(next) {
							expectDenied('get_job_details', { id: foreign_job_id }, "Foreign completed job read", next);
						}
					], callback);
				},
				function denyRoutesAndForeignAborts(callback) {
					captured_abort = null;
					async.series([
						function(next) { expectDenied('get_event', { id: allowed_id }, "Non-capability API", next); },
						function(next) { expectDenied('flush_event_queue', { id: allowed_id }, "Workflow queue flush", next); },
						function(next) { expectDenied('abort_jobs', { event: allowed_id }, "Workflow bulk abort", next); },
						function(next) { expectDenied('abort_job', { id: foreign_job_id }, "Foreign workflow child abort", next); },
						function(next) { expectDenied('abort_job', { id: inherited_job_id }, "Inherited source-id child abort", next); },
						function(next) {
							workflowRequest('abort_job', { id: owned_job_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Workflow aborted its owned child");
								test.ok(captured_abort && captured_abort.id == owned_job_id, "Abort reached only the owned child");
								next();
							});
						}
					], callback);
				},
				function rejectPathConfusion(callback) {
					var allowed_actions = [
						'get_schedule', 'get_active_jobs', 'run_event', 'get_job_details', 'abort_job'
					];
					var cases = [];
					allowed_actions.forEach(function(action) {
						cases.push({
							path: '/app/get_event/path-confusion/app/' + action,
							name: 'Denied handler with allowed route suffix ' + action
						});
						cases.push({
							path: '/app/' + action + '/extra-path',
							name: 'Allowed handler with non-canonical trailing path ' + action
						});
					});
					cases.push({ path: '/app//get_schedule', name: 'Malformed empty action path' });
					cases.push({ path: '/app/get-schedule', name: 'Malformed non-router action path' });

					async.eachSeries(cases, function(entry, next) {
						expectDeniedPath(entry.path, { id: allowed_id }, entry.name, next);
					}, callback);
				},
				function reconstructPendingAndRemoteParents(callback) {
					removeParentLocations();
					cronicle.internalQueue[pending_key] = Object.assign({
						action: 'launchLocalJob',
						when: Tools.timeNow(true) + 30
					}, clone(parent));
					async.series([
						function(next) {
							workflowRequest('run_event', { id: allowed_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Pending/retry parent retained its workflow capability");
								next();
							});
						},
						function(next) {
							delete cronicle.internalQueue[pending_key];
							cronicle.workers[remote_worker] = { active_jobs: {} };
							cronicle.workers[remote_worker].active_jobs[parent_id] = clone(parent);
							workflowRequest('run_event', { id: allowed_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Current manager reconstructed the capability from a remote active snapshot");
								next();
							});
						},
						function(next) {
							cronicle.workers[remote_worker] = { active_jobs: {}, queue: {} };
							cronicle.workers[remote_worker].queue[pending_key] = Object.assign({
								action: 'launchLocalJob',
								when: Tools.timeNow(true) + 30
							}, clone(parent));
							workflowRequest('run_event', { id: allowed_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Current manager reconstructed the capability from a remote pending/retry snapshot");
								next();
							});
						}
					], callback);
				},
				function expireCapabilityWithParent(callback) {
					removeParentLocations();
					async.series([
						function(next) {
							expectDenied('run_event', { id: allowed_id }, "Expired workflow capability", next);
						},
						function(next) {
							cronicle.deadJobs[parent_id] = clone(parent);
							expectDenied('run_event', { id: allowed_id }, "Dead-job-only workflow capability", function() {
								delete cronicle.deadJobs[parent_id];
								next();
							});
						}
					], callback);
				},
				function rotateSecretFailClosed(callback) {
					installParentActive();
					server.config.set('secret_key', 'UNIT_TEST_ROTATED_WORKFLOW_SECRET');
					async.series([
						function(next) {
							expectDenied('run_event', { id: allowed_id }, "Pre-rotation workflow signature", next, signature);
						},
						function(next) {
							var rotated = cronicle.getWorkflowSignature(parent_id);
							workflowRequest('run_event', { id: allowed_id }, function(err, resp, body) {
								test.ok(!err && body && body.code == 0, "Current-secret workflow signature was accepted");
								next();
							}, rotated);
						}
					], function(err) {
						server.config.set('secret_key', original_secret);
						callback(err);
					});
				}
			], function(err) {
				test.ok(!err, "Workflow capability regression flow completed");
				cleanup(function() { test.done(); });
			});
		},

		// app/run_event
		
		function testAPIRunEvent(test) {
			// test app/run_event api
			// run event manually, specify an override
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.event_id,
				notify_fail: 'test@test.com',
				debug_sudo: 1
			};
			
			request.json( api_url + '/app/run_event', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.ids, "Found ids in response" );
				test.ok( data.ids.length == 1, "Data ids has length of 1" );
				test.ok( !!data.ids[0], "Found Job ID in response data" );
				
				var job_id = data.ids[0];
				self.job_id = job_id;
				
				// wait a few seconds here for job to start and get to around 50%
				setTimeout( function() {
					test.done();
				}, 1000 * 5 );
				
			} );
		},

		function testRunEventRejectsUnprivilegedEventOverrides(test) {
			var self = this;
			var salt = 'unit_test_token_salt';
			var oldLaunch = cronicle.launchOrQueueJob;
			var oldLaunchJob = cronicle.launchJob;
			var oldEventQueueCount = cronicle.eventQueue[this.event_id];
			var queuePath = 'global/event_queue/' + this.event_id;
			var originalEvent = null;
			var launchedJob = null;
			var launchOptions = null;
			var allowedNow = Tools.timeNow(true) - 60;
			var finished = false;

			function captureLaunch(job, callback, options) {
				launchedJob = job;
				launchOptions = options;
				callback(null, []);
			}

			function restoreEventQueueCount() {
				if (typeof(oldEventQueueCount) == 'undefined') delete cronicle.eventQueue[self.event_id];
				else cronicle.eventQueue[self.event_id] = oldEventQueueCount;
			}

			function finish() {
				if (finished) return;
				finished = true;
				cronicle.launchOrQueueJob = oldLaunch;
				cronicle.launchJob = oldLaunchJob;
				restoreEventQueueCount();
				storage.listDelete(queuePath, true, function() {
					var restore = {
						salt: originalEvent && originalEvent.salt ? originalEvent.salt : '',
						queue: originalEvent && originalEvent.queue ? originalEvent.queue : false,
						queue_max: originalEvent && originalEvent.queue_max ? originalEvent.queue_max : 0
					};
					storage.listFindUpdate('global/schedule', { id: self.event_id }, restore, function(err) {
						test.ok(!err, "Event token and queue fixtures were restored");
						test.done();
					});
				});
			}

			function runEditorChecks() {
				cronicle.launchOrQueueJob = captureLaunch;
				launchedJob = null;
				launchOptions = null;
				request.json(api_url + '/app/run_event', {
					id: self.event_id,
					session_id: session_id,
					debug_sudo: 1,
					chain_data: { args: ['editor-injected'] },
					memo: 'args:editor-injected',
					source: 'editor-injected',
					source_id: 'editor-injected',
					source_event: 'editor-injected',
					source_log: 'javascript:alert(1)',
					username: 'editor-injected',
					api_key: 'editor_injected',
					params: { script: 'echo editor-override' }
				}, function(err, resp, data) {
					test.ok(!err, "Editor request succeeded");
					test.ok(data.code == 0, "Editor launched the configured event");
					test.ok(launchedJob && !('chain_data' in launchedJob), "Editor chain data was ignored");
					test.ok(launchedJob && !('memo' in launchedJob), "Editor memo was ignored");
					test.ok(launchedJob && launchedJob.params && launchedJob.params.script == 'echo editor-override', "Editor plugin parameters remain customizable");
					test.ok(launchedJob && launchedJob.source == 'Manual (admin)', "Editor source was derived by the server");
					test.ok(launchedJob && launchedJob.username == 'admin', "Editor username was derived by the server");
					test.ok(launchedJob && !('source_id' in launchedJob), "Editor source ID override was ignored");
					test.ok(launchedJob && !('source_event' in launchedJob), "Editor source event override was ignored");
					test.ok(launchedJob && !('source_log' in launchedJob), "Editor source log override was ignored");
					test.ok(launchedJob && !('api_key' in launchedJob), "Editor API key override was ignored");
					test.ok(launchedJob && !Object.prototype.hasOwnProperty.call(launchedJob, 'debug_sudo'), "Admin request marker was not copied into the event job");
					test.ok(launchOptions && launchOptions.debug_sudo === true, "Admin debug_sudo request became a trusted one-shot launch option");

					launchedJob = null;
					request.json(api_url + '/app/run_event', {
						id: self.event_id,
						session_id: session_id,
						'__proto__/polluted': 'yes'
					}, function(err, resp, data) {
						test.ok(!err, "Malformed editor nested request returned a response");
						test.ok(data.code == 'api', "Prototype-chain nested request was rejected");
						test.ok(!launchedJob, "Rejected nested request did not launch a job");
						test.ok(!({}).polluted, "Editor nested input did not modify Object.prototype");

						launchedJob = null;
						var prototypePayload = JSON.parse('{"id":"' + self.event_id + '","session_id":"' + session_id + '","__proto__":{"target":"attacker-target","plugin":"attacker_plugin","debug_sudo":1}}');
						request.json(api_url + '/app/run_event', prototypePayload, function(err, resp, data) {
							test.ok(!err, "Raw prototype payload returned a response");
							test.ok(data.code == 'api', "Raw prototype-control key was rejected");
							test.ok(!launchedJob, "Raw prototype payload did not launch a job");
							test.ok(!({}).polluted, "Raw prototype payload did not modify Object.prototype");
							finish();
						});
					});
				});
			}

			function runDurableQueueCheck(token) {
				storage.listDelete(queuePath, true, function() {
					storage.listFindUpdate('global/schedule', { id: self.event_id }, { queue: 1, queue_max: 5 }, function(err) {
						test.ok(!err, "Durable event queue fixture was enabled");
						if (err) return runEditorChecks();

						cronicle.launchOrQueueJob = oldLaunch;
						cronicle.launchJob = function(job, callback) {
							callback(new Error('Intentional capacity failure for durable queue regression'));
						};

						request.json(api_url + '/app/run_event', {
							id: self.event_id,
							token: token,
							repeat: -1,
							enabled: false
						}, function(err, resp, data) {
							cronicle.launchJob = oldLaunchJob;
							test.ok(!err, "Queued event-token request succeeded");
							test.ok(data && data.code == 0, "Launch failure was converted into an event queue entry");
							test.ok(data && data.ids && data.ids.length == 0 && data.queue, "Queued response reported no launched jobs");

							async.retry({ times: 20, interval: 25 }, function(callback) {
								storage.listGet(queuePath, 0, 0, function(err, items) {
									if (!err && items && items.length) return callback(null, items);
									callback(err || new Error('Queued record is not durable yet'));
								});
							}, function(queueErr, items) {
								test.ok(!queueErr, "Launch failure persisted an event queue record");
								var queuedEvent = items && items[0];
								test.ok(!!queuedEvent, "Persisted event queue record was readable");
								test.ok(queuedEvent && queuedEvent.repeat === originalEvent.repeat, "Persisted event used the configured repeat value");
								test.ok(queuedEvent && queuedEvent.repeat !== -1, "Caller repeat override was not persisted");
								test.ok(queuedEvent && queuedEvent.enabled === originalEvent.enabled, "Caller enabled override was not persisted");

								storage.listDelete(queuePath, true, function() {
									restoreEventQueueCount();
									runEditorChecks();
								});
							});
						});
					});
				});
			}

			storage.listFind('global/schedule', { id: self.event_id }, function(err, event) {
				test.ok(!err && !!event, "Original event fixture was loaded");
				if (err || !event) return finish();
				originalEvent = Tools.copyHash(event, true);

				storage.listFindUpdate('global/schedule', { id: self.event_id }, { salt: salt }, function(err) {
					test.ok(!err, "Event token was enabled");
					if (err) return finish();
					var token = crypto.createHmac('sha1', server.config.get('secret_key'))
						.update(self.event_id + salt)
						.digest('hex');

					cronicle.launchOrQueueJob = captureLaunch;
					launchOptions = null;
					request.json(api_url + '/app/run_event', {
						id: self.event_id,
						token: token,
						now: allowedNow,
						arg: 'allowed-argument',
						args: 'allowed-argument',
						post_data: { allowed: true },
						repeat: 1,
						enabled: false,
						chain_data: { args: ['injected'] },
						memo: 'args:injected',
						plugin: 'attacker_plugin',
						workflow: [{ id: 'attacker_event' }],
						target: 'attacker-target',
						chain: 'attacker_event',
						chain_error: 'attacker_event',
						options: { wf_start_from_step: 99 },
						files: [{ name: 'payload.sh', content: 'malicious' }],
						params: { script: 'echo attacker-override' },
						notify_fail: 'attacker@example.com',
						debug_sudo: 1,
						source: 'attacker',
						source_id: 'attacker',
						'__proto__/polluted': 'yes'
					}, function(err, resp, data) {
						test.ok(!err, "Event token request succeeded");
						test.ok(data.code == 0, "Event token launched the configured event");
						test.ok(launchedJob && !('chain_data' in launchedJob), "Event token chain data was ignored");
						test.ok(launchedJob && !('memo' in launchedJob), "Event token memo was ignored");
						test.ok(launchedJob && launchedJob.plugin != 'attacker_plugin', "Event token plugin override was ignored");
						test.ok(launchedJob && launchedJob.target != 'attacker-target', "Event token target override was ignored");
						test.ok(launchedJob && launchedJob.chain != 'attacker_event', "Event token success-chain override was ignored");
						test.ok(launchedJob && launchedJob.chain_error != 'attacker_event', "Event token error-chain override was ignored");
						test.ok(launchedJob && !launchedJob.workflow, "Event token workflow override was ignored");
						test.ok(launchedJob && !launchedJob.options, "Event token workflow options were ignored");
						test.ok(launchedJob && !launchedJob.files, "Event token file override was ignored");
						test.ok(launchedJob && (!launchedJob.params || launchedJob.params.script != 'echo attacker-override'), "Event token plugin parameters were ignored");
						test.ok(launchedJob && launchedJob.notify_fail != 'attacker@example.com', "Event token notification override was ignored");
						test.ok(launchedJob && !Object.prototype.hasOwnProperty.call(launchedJob, 'debug_sudo'), "Event token debug_sudo override was ignored");
						test.ok(launchOptions && launchOptions.debug_sudo === false, "Event token received no trusted debug_sudo launch option");
						test.ok(launchedJob && launchedJob.repeat === originalEvent.repeat, "Positive repeat override was ignored");
						test.ok(launchedJob && launchedJob.enabled === originalEvent.enabled, "Enabled override was ignored");
						test.ok(launchedJob && launchedJob.source == 'Event Token', "Server-derived source was preserved");
						test.ok(launchedJob && launchedJob.now == allowedNow, "Event token current-time override remained available");
						test.ok(launchedJob && launchedJob.arg == 'allowed-argument', "Event token job argument remained available");
						test.ok(launchedJob && launchedJob.args == 'allowed-argument', "Event token args alias remained available");
						test.ok(launchedJob && launchedJob.post_data && launchedJob.post_data.allowed, "Event token POST data remained available");
						test.ok(!({}).polluted, "Run-only nested input did not modify Object.prototype");

						launchedJob = null;
						request.json(api_url + '/app/run_event', {
							id: self.event_id,
							token: token,
							repeat: -1,
							enabled: false
						}, function(err, resp, data) {
							test.ok(!err, "Negative repeat event-token request succeeded");
							test.ok(data && data.code == 0, "Negative repeat did not alter launch authorization");
							test.ok(launchedJob && launchedJob.repeat === originalEvent.repeat, "Negative repeat override was ignored");
							test.ok(launchedJob && launchedJob.enabled === originalEvent.enabled, "Negative repeat request could not disable the job");
							runDurableQueueCheck(token);
						});
					});
				});
			});
		},
		
		function testJobInProgress(test) {
			// make sure job is in progress
			var self = this;
			var all_jobs = cronicle.getAllActiveJobs();
			var job = all_jobs[ this.job_id ];
			
			test.ok( !!job, "Found our job in active list" );
			test.ok( job.event == this.event_id, "Job has correct Event ID" );
			test.ok( job.progress > 0, "Job has positive progress" );
			test.ok( job.notify_fail == "test@test.com", "Our notify_fail override made it in" );
			test.ok( !!job.pid, "Job has a PID" );
			test.ok( !Object.prototype.hasOwnProperty.call(job, 'debug_sudo'), "Active job contains no debug_sudo marker" );
			test.ok( !Object.prototype.hasOwnProperty.call(job, '_cronicle_run_as'), "Active job contains no signed dispatch context" );
			var recovery_job = JSON.parse(fs.readFileSync(job.log_file.replace(/\.log$/, '.json'), 'utf8'));
			test.ok( !Object.prototype.hasOwnProperty.call(recovery_job, 'debug_sudo'), "Crash-recovery job file contains no debug_sudo marker" );
			test.ok( !Object.prototype.hasOwnProperty.call(recovery_job, '_cronicle_run_as'), "Crash-recovery job file contains no signed dispatch context" );
			
			// try to ping pid
			var ping = false;
			try { ping = pingPID(job.pid) }
			catch (e) {;}
			test.ok( !!ping, "Job PID was successfully pinged" );
			
			// force cronicle to measure mem/cpu
			cronicle.monitorServerResources( function(err) {
				test.ok( !err, "No error calling monitorServerResources", err );
				test.done();
			} );
		},

		function testActiveJobLogAuthorization(test) {
			var self = this;
			var denied_sessions = [
				{ name: 'missing session', id: '' },
				{ name: 'foreign category', id: log_auth_sessions.category_denied },
				{ name: 'foreign group', id: log_auth_sessions.group_denied }
			];

			async.eachSeries(denied_sessions, function (entry, callback) {
				var query = { id: self.job_id };
				if (entry.id) query.session_id = entry.id;
				request.get(api_url + '/app/get_live_job_log' + Tools.composeQueryString(query), function (err, resp, data) {
					test.ok(!err, "Raw live-log denial completed for " + entry.name);
					test.ok(resp.statusCode == 200, "Raw live-log denial is an API response for " + entry.name);
					test.ok(String(data).indexOf('UNIT TEST STRING') < 0, "Raw live-log denial did not leak log bytes for " + entry.name);
					callback();
				});
			}, function (err) {
				if (err) return test.done(err);
				async.eachSeries(denied_sessions, function (entry, callback) {
					var params = { id: self.job_id };
					if (entry.id) params.session_id = entry.id;
					request.json(api_url + '/app/get_live_console', params, function (err, resp, data) {
						test.ok(!err, "Live-console denial completed for " + entry.name);
						test.ok(resp.statusCode == 200, "Live-console denial is an API response for " + entry.name);
						test.ok(data.code != 0, "Live console denied " + entry.name);
						test.ok(!data.data || (data.data.indexOf('UNIT TEST STRING') < 0), "Live-console denial did not leak log bytes for " + entry.name);
						callback();
					});
				}, function (err) {
					if (err) return test.done(err);
					var raw_query = { id: self.job_id, session_id: log_auth_sessions.allowed };
					request.get(api_url + '/app/get_live_job_log' + Tools.composeQueryString(raw_query), function (err, resp, data) {
						test.ok(!err, "Scoped user requested raw live log");
						test.ok(resp.statusCode == 200, "Scoped user received raw live log");
						test.ok(String(data).length > 0, "Scoped user received live log bytes");
						test.ok(/^text\/plain/i.test(resp.headers['content-type']), "Raw live log is text/plain");
						test.ok(resp.headers['x-content-type-options'] == 'nosniff', "Raw live log disables MIME sniffing");
						test.ok(/no-store/.test(resp.headers['cache-control']), "Raw live log is not cacheable");

						request.json(api_url + '/app/get_live_console', {
							id: self.job_id,
							session_id: log_auth_sessions.allowed
						}, function (err, resp, data) {
							test.ok(!err, "Scoped user requested live console");
							test.ok(resp.statusCode == 200, "Scoped user received live console response");
							test.ok(!data.code, "Scoped user was authorized for live console");
							test.ok(typeof data.data == 'string', "Live console returned log data");

							var remote_id = 'unitremotelivelog';
							var remote_file = cronicle.getJobLogFilePath(remote_id, false);
							var old_worker = cronicle.workers['127.0.0.1'];
							fs.writeFileSync(remote_file, 'REMOTE LIVE LOG');
							cronicle.workers['127.0.0.1'] = {
								hostname: '127.0.0.1',
								ip: '127.0.0.1',
								active_jobs: {
									unitremotelivelog: {
										id: remote_id,
										hostname: '127.0.0.1',
										category: 'general',
										target: 'maingrp',
										detached: 0
									}
								}
							};
							cronicle.remoteLogFetchJobs[remote_id] = {
								id: remote_id,
								hostname: '127.0.0.1',
								category: 'general',
								target: 'maingrp',
								detached: 0
							};
							request.get(api_url + '/app/get_live_job_log' + Tools.composeQueryString({
								id: remote_id,
								session_id: log_auth_sessions.allowed
							}), function (err, resp, data) {
								test.ok(!err, "Manager proxied an authorized remote raw live log");
								test.ok(resp.statusCode == 200, "Remote raw live log returned HTTP 200");
								test.ok(String(data) == 'REMOTE LIVE LOG', "Remote raw live log returned exact bytes");
								test.ok(/^text\/plain/i.test(resp.headers['content-type']), "Remote raw live log is text/plain");
								fs.unlinkSync(remote_file);
								delete cronicle.remoteLogFetchJobs[remote_id];
								if (old_worker) cronicle.workers['127.0.0.1'] = old_worker;
								else delete cronicle.workers['127.0.0.1'];
								test.done();
							});
						});
					});
				});
			});
		},
		
		// app/get_live_job_log
		
		function testAPIGetLiveJobLog(test) {
			// test get_live_job_log API (raw HTTP get, not a JSON API)
			var self = this;
			
			request.get( api_url + '/app/get_live_job_log?id=' + this.job_id + '&session_id=' + session_id, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( !!data, "Got data buffer" );
				test.ok( data.length > 0, "Data buffer has length" );
				test.ok( /^text\/plain/i.test(resp.headers['content-type']), "Live log uses text/plain" );
				test.ok( resp.headers['x-content-type-options'] == 'nosniff', "Live log disables MIME sniffing" );
				test.ok( /no-store/.test(resp.headers['cache-control']), "Live log is not cacheable" );
				
				test.done();
				
			} );
		},
		
		// app/get_job_status
		
		function testAPIGetJobStatus(test) {
			// test app/get_job_status api
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.job_id
			};
			
			request.json( api_url + '/app/get_job_status', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				test.ok( !!data.job, "Found job in data" );
				
				var job = data.job;
				test.ok( job.id == self.job_id, "Job ID matches" );
				test.ok( job.progress > 0, "Job progress is still non-zero" );
				
				test.ok( !!job.cpu, "Job has CPU metrics" );
				test.ok( job.cpu.count > 0, "Job CPU count is non-zero" );
				// test.ok( job.cpu.current > 0, "Job CPU current is non-zero" );
				
				test.ok( !!job.mem, "Job has memory metrics" );
				test.ok( job.mem.count > 0, "Job memory count is non-zero" );
				// test.ok( job.mem.current > 0, "Job memory current is non-zero" );
				
				test.done();
				
			} );
		},
		
		// app/update_job

		function testAPIRejectProtectedJobUpdates(test) {
			var self = this;
			var job = cronicle.getAllActiveJobs()[this.job_id];
			var original_log_file = job.log_file;
			var original_hostname = job.hostname;
			var original_pid = job.pid;

			request.json(api_url + '/app/update_job', {
				session_id: session_id,
				id: this.job_id,
				notify_fail: 'must-not-apply@example.invalid',
				log_file: path.join(os.tmpdir(), 'outside-mutated.log')
			}, function (err, resp, data) {
				test.ok(!err, "Protected single-job update completed");
				test.ok(resp.statusCode == 200, "Protected single-job update returned an API response");
				test.ok(data.code != 0, "Single-job update rejected log_file atomically");

				var current = cronicle.getAllActiveJobs()[self.job_id];
				test.ok(current.log_file == original_log_file, "Single-job update preserved log_file");
				test.ok(current.hostname == original_hostname, "Single-job update preserved hostname");
				test.ok(current.pid == original_pid, "Single-job update preserved pid");
				test.ok(current.notify_fail == 'test@test.com', "Single-job update did not partially apply mutable fields");

				request.json(api_url + '/app/update_jobs', {
					session_id: session_id,
					event: self.event_id,
					updates: {
						notify_fail: 'must-not-apply-bulk@example.invalid',
						log_file: path.join(os.tmpdir(), 'outside-mutated-bulk.log')
					}
				}, function (err, resp, data) {
					test.ok(!err, "Protected bulk update completed");
					test.ok(resp.statusCode == 200, "Protected bulk update returned an API response");
					test.ok(data.code != 0, "Bulk update rejected log_file atomically");
					current = cronicle.getAllActiveJobs()[self.job_id];
					test.ok(current.log_file == original_log_file, "Bulk update preserved log_file");
					test.ok(current.notify_fail == 'test@test.com', "Bulk update did not partially apply mutable fields");

					request.json(api_url + '/app/update_job', {
						session_id: session_id,
						id: self.job_id,
						timeout: { invalid: true }
					}, function (err, resp, data) {
						test.ok(!err, "Invalid allowlisted value request completed");
						test.ok(resp.statusCode == 200, "Invalid allowlisted value returned an API response");
						test.ok(data.code != 0, "Allowlisted fields still require valid types and values");
						test.done();
					});
				});
			});
		},

		function testAPIAllowlistedBulkJobUpdate(test) {
			var self = this;
			request.json(api_url + '/app/update_jobs', {
				session_id: session_id,
				event: this.event_id,
				updates: { notify_fail: 'bulk@example.invalid' }
			}, function (err, resp, data) {
				test.ok(!err, "Allowlisted bulk update completed");
				test.ok(resp.statusCode == 200, "Allowlisted bulk update returned HTTP 200");
				test.ok(data.code == 0, "Allowlisted bulk update succeeded");
				test.ok(data.count == 1, "Allowlisted bulk update changed one job");
				var job = cronicle.getAllActiveJobs()[self.job_id];
				test.ok(job.notify_fail == 'bulk@example.invalid', "Allowlisted bulk field was applied");
				test.done();
			});
		},
		
		function testAPIUpdateJob(test) {
			// test app/update_job api
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.job_id,
				notify_fail: 'test2@test.com'
			};
			
			request.json( api_url + '/app/update_job', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				var all_jobs = cronicle.getAllActiveJobs();
				var job = all_jobs[ self.job_id ];
				
				test.ok( !!job, "Found our job in active list" );
				test.ok( job.event == self.event_id, "Job has correct Event ID" );
				test.ok( job.notify_fail == "test2@test.com", "Our notify_fail update was applied" );
				
				test.done();
				
			} );
		},
		
		// wait for job to complete
		
		function testWaitJobComplete(test) {
			// go into wait loop while job is still in progress
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.job_id,
				need_log: 1
			};
			var details = { code: 1 };
			var count = 0;
			
			async.doWhilst(
				function (callback) {
					// poll get_job_details API
					request.json( api_url + '/app/get_job_details', params, function(err, resp, data) {
						if (err) return callback(err);
						if (resp.statusCode != 200) return callback(new Error("HTTP " + resp.statusCode + " " + resp.statusMessage));
						
						// e-brake to prevent infinite loop
						if (count++ > 100) return callback(new Error("Too many loop iterations polling get_job_details API"));
						
						details = data;
						setTimeout( callback, 500 );
					} );
				},
				function () { return (details.code != 0); },
				function (err) {
					// job is complete
					var job = details.job;
					
					test.ok( !!job, "Got job details in response" );
					test.ok( job.id == self.job_id, "Job ID matches" );
					test.ok( !!job.complete, "Job is marked as complete" );
					test.ok( job.code == 0, "Job is not marked as an error" );
					test.ok( !!job.perf, "Job has perf metrics" );
					test.ok( !!job.pid, "Job record still has a pid" );
					test.ok( !Object.prototype.hasOwnProperty.call(job, 'debug_sudo'), "Completed job record contains no debug_sudo marker" );
					test.ok( !Object.prototype.hasOwnProperty.call(job, '_cronicle_run_as'), "Completed job record contains no signed dispatch context" );
					
					// job pid should be dead at this point
					var ping = false;
					try { ping = pingPID(job.pid) }
					catch (e) {;}
					test.ok( !ping, "Job PID is dead" );
					
					test.done();
				}
			);
		},
		
		// app/get_job_log

		function testCompletedJobLogAuthorization(test) {
			var self = this;
			var denied_sessions = [
				{ name: 'missing session', id: '' },
				{ name: 'foreign category', id: log_auth_sessions.category_denied },
				{ name: 'foreign group', id: log_auth_sessions.group_denied }
			];

			async.eachSeries(denied_sessions, function (entry, callback) {
				var query = { id: self.job_id };
				if (entry.id) query.session_id = entry.id;
				request.get(api_url + '/app/get_job_log' + Tools.composeQueryString(query), function (err, resp, data) {
					test.ok(!err, "Completed-log denial completed for " + entry.name);
					test.ok(resp.statusCode == 200, "Completed-log denial is an API response for " + entry.name);
					test.ok(String(data).indexOf('# Job completed successfully') < 0, "Completed-log denial did not leak bytes for " + entry.name);
					callback();
				});
			}, function (err) {
				if (err) return test.done(err);
				var query = { id: self.job_id, session_id: log_auth_sessions.allowed };
				request.get(api_url + '/app/get_job_log' + Tools.composeQueryString(query), function (err, resp, data) {
					test.ok(!err, "Scoped user requested completed log");
					test.ok(resp.statusCode == 200, "Scoped user received completed log");
					test.ok(String(data).match(/success/i), "Scoped user received completed log bytes");
					test.ok(/^text\/plain/i.test(resp.headers['content-type']), "Completed log is text/plain");
					test.ok(resp.headers['x-content-type-options'] == 'nosniff', "Completed log disables MIME sniffing");
					test.ok(/no-store/.test(resp.headers['cache-control']), "Completed log is not cacheable");
					test.done();
				});
			});
		},
		
		function testAPIGetJobLog(test) {
			// test get_job_log API (raw HTTP get, not a JSON API)
			var self = this;
			
			request.get( api_url + `/app/get_job_log?id=${this.job_id}&session_id=${session_id}`, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( !!data, "Got data buffer" );
				test.ok( data.length > 0, "Data buffer has length" );
				test.ok( data.toString().match(/success/i), "Log buffer contains expected string" );
				test.ok( /^text\/plain/i.test(resp.headers['content-type']), "Completed log uses text/plain" );
				test.ok( resp.headers['x-content-type-options'] == 'nosniff', "Completed log disables MIME sniffing" );
				test.ok( /no-store/.test(resp.headers['cache-control']), "Completed log is not cacheable" );
				
				test.done();
				
			} );
		},
		
		// app/get_event_history
		
		function testAPIGetEventHistory(test) {
			// go into wait loop while event history is being written
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.event_id,
				offset: 0,
				limit: 100
			};
			var details = { rows: [] };
			var count = 0;
			
			async.doWhilst(
				function (callback) {
					// poll get_event_history API
					request.json( api_url + '/app/get_event_history', params, function(err, resp, data) {
						if (err) return callback(err);
						if (resp.statusCode != 200) return callback(new Error("HTTP " + resp.statusCode + " " + resp.statusMessage));
						
						// e-brake to prevent infinite loop
						if (count++ > 10) return callback(new Error("Too many loop iterations polling get_event_history API"));
						
						details = data;
						setTimeout( callback, 500 );
					} );
				},
				function () { return ( !details.rows || !details.rows.length ); },
				function (err) {
					// history is written
					var stub = details.rows[0];
					
					test.ok( !!stub, "Got event history in response" );
					test.ok( stub.id == self.job_id, "History ID matches Job ID" );
					test.ok( stub.code == 0, "Correct code in history item" );
					test.ok( stub.event == self.event_id, "History item Event ID matching Event ID" );
					test.ok( stub.elapsed > 0, "History item has non-zero elapsed time" );
					test.ok( stub.action == "job_complete", "History item has correct action" );
					
					test.done();
				}
			);
		},
		
		// app/get_history
		
		function testAPIGetHistory(test) {
			// go into wait loop while history is being written
			var self = this;
			var params = {
				"session_id": session_id,
				offset: 0,
				limit: 100
			};
			var details = { rows: [] };
			var count = 0;
			
			async.doWhilst(
				function (callback) {
					// poll get_history API
					request.json( api_url + '/app/get_history', params, function(err, resp, data) {
						if (err) return callback(err);
						if (resp.statusCode != 200) return callback(new Error("HTTP " + resp.statusCode + " " + resp.statusMessage));
						
						// e-brake to prevent infinite loop
						if (count++ > 10) return callback(new Error("Too many loop iterations polling get_history API"));
						
						details = data;
						setTimeout( callback, 500 );
					} );
				},
				function () { return ( !details.rows || !details.rows.length ); },
				function (err) {
					// history is written
					var stub = details.rows[0];
					
					test.ok( !!stub, "Got event history in response" );
					test.ok( stub.id == self.job_id, "History ID matches Job ID" );
					test.ok( stub.code == 0, "Correct code in history item" );
					test.ok( stub.event == self.event_id, "History item Event ID matching Event ID" );
					test.ok( stub.elapsed > 0, "History item has non-zero elapsed time" );
					test.ok( stub.action == "job_complete", "History item has correct action" );
					
					test.done();
				}
			);
		},
		
		// app/get_activity
		
		function testAPIGetActivity(test) {
			// go into wait loop while activity log is being written
			var self = this;
			var params = {
				"session_id": session_id,
				offset: 0,
				limit: 100
			};
			var details = { rows: [] };
			var count = 0;
			
			async.doWhilst(
				function (callback) {
					// poll get_activity API
					request.json( api_url + '/app/get_activity', params, function(err, resp, data) {
						if (err) return callback(err);
						if (resp.statusCode != 200) return callback(new Error("HTTP " + resp.statusCode + " " + resp.statusMessage));
						
						// e-brake to prevent infinite loop
						if (count++ > 10) return callback(new Error("Too many loop iterations polling get_activity API"));
						
						details = data;
						setTimeout( callback, 500 );
					} );
				},
				function () { return ( !details.rows || !details.rows.length || (details.rows[0].id != self.job_id) ); },
				function (err) {
					// activity is written
					// test.debug("Activity response:", details);
					
					var stub = details.rows[0];
					test.debug("Activity first item:", stub);
					
					test.ok( !!stub, "Got activity in response" );
					test.ok( stub.id == self.job_id, "Activity ID matches Job ID" );
					test.ok( stub.event == self.event_id, "Activity item Event ID matches Event ID" );
					test.ok( stub.action == "job_run", "Activity item has correct action" );
					
					test.done();
				}
			);
		},
		
		function testSchedulerEventTiming(test) {
			// test various formats of event timing
			
			// timestamp for testing: Epoch 1454797620
			// Sat Feb  6 14:27:00 2016 (PST)
			
			var cursor = 1454797620;
			var tz = "America/Los_Angeles";
			
			test.ok( !!cronicle.checkEventTiming( {}, cursor, tz ), "Every minute should run" );
			
			test.ok( !!cronicle.checkEventTiming( { minutes: [27] }, cursor, tz ), "Hourly should run" );
			test.ok( !cronicle.checkEventTiming( { minutes: [28] }, cursor, tz ), "Hourly should not run" );
			
			test.ok( !!cronicle.checkEventTiming( { hours: [14], minutes: [27] }, cursor, tz ), "Daily should run" );
			test.ok( !!cronicle.checkEventTiming( { hours: [14] }, cursor, tz ), "Daily every minute should run" );
			test.ok( !cronicle.checkEventTiming( { hours: [17], minutes: [27] }, cursor, tz ), "Daily should not run" );
			
			test.ok( !!cronicle.checkEventTiming( { weekdays: [6], hours: [14], minutes: [27] }, cursor, tz ), "Weekly should run" );
			test.ok( !!cronicle.checkEventTiming( { weekdays: [6], minutes: [27] }, cursor, tz ), "Weekly hourly should run" );
			test.ok( !cronicle.checkEventTiming( { weekdays: [0], hours: [14], minutes: [27] }, cursor, tz ), "Weekly should not run" );
			
			test.ok( !!cronicle.checkEventTiming( { days: [6], hours: [14], minutes: [27] }, cursor, tz ), "Monthly should run" );
			test.ok( !!cronicle.checkEventTiming( { days: [6], minutes: [27] }, cursor, tz ), "Monthly hourly should run" );
			test.ok( !cronicle.checkEventTiming( { days: [5], hours: [14], minutes: [27] }, cursor, tz ), "Monthly should not run" );
			
			test.ok( !!cronicle.checkEventTiming( { months: [2], days: [6], hours: [14], minutes: [27] }, cursor, tz ), "Yearly should run" );
			test.ok( !!cronicle.checkEventTiming( { months: [2], minutes: [27] }, cursor, tz ), "Yearly hourly should run" );
			test.ok( !cronicle.checkEventTiming( { months: [12], days: [6], hours: [14], minutes: [27] }, cursor, tz ), "Yearly should not run" );
			
			test.ok( !!cronicle.checkEventTiming( { years: [2016], months: [2], days: [6], hours: [14], minutes: [27] }, cursor, tz ), "Single should run" );
			test.ok( !cronicle.checkEventTiming( { years: [2015], months: [2], days: [6], hours: [14], minutes: [27] }, cursor, tz ), "Single should not run" );
			
			// now test same timestamp in a different timezone
			tz = "America/New_York";
			
			test.ok( !!cronicle.checkEventTiming( { hours: [17], minutes: [27] }, cursor, tz ), "New York should run" );
			test.ok( !cronicle.checkEventTiming( { hours: [14], minutes: [27] }, cursor, tz ), "New York should not run" );
			
			test.done();
		},
		
		function testUpdateEventForSchedule(test) {
			// update event with hourly timing and a simple shell command
			var self = this;
			
			var params = {
				"params": {
					"script": testScript
				},
				"timing": {
					"minutes": [25] // hourly on the 25th minute
				},
				"plugin": "shellplug",
				"web_hook": api_url + '/app/unit_test_web_hook'
			};
			
			storage.listFindUpdate( 'global/schedule', { id: this.event_id }, params, function(err) {
				test.ok( !err, "Failed to update event: " + err );
				test.done();
			} );
		},

		function testLaunchJobUsesOnlyPluginLaunchContext(test) {
			// Event/API payloads cannot override admin-only Plugin launch options,
			// while trusted Plugin UID/GID survive manager-to-worker serialization.
			var self = this;
			var original_launch_local_job = cronicle.launchLocalJob;
			var captured_job = null;

			storage.listFindUpdate('global/plugins', { id: 'shellplug' }, {
				uid: 'trusted-plugin-user',
				gid: 'trusted-plugin-group'
			}, function(plugin_err) {
				test.ok(!plugin_err, 'Trusted Plugin launch identity was stored');

				storage.listFind('global/schedule', { id: self.event_id }, function(err, event) {
					test.ok(!err, 'No error locating event in schedule');
					test.ok(!!event, 'Found event in schedule');

					var hostile_job = Tools.copyHash(event, true);
					hostile_job.uid = 0;
					hostile_job.gid = 0;
					hostile_job.cwd = '/tmp';
					hostile_job.env = { PATH: '/tmp' };
					hostile_job.debug_sudo = 1;
					hostile_job.web_hook = '';

					cronicle.launchLocalJob = function(job, launch_options) {
						cronicle.consumeJobDispatchContext(job, launch_options, 'linux', 801);
						captured_job = job;
					};

					cronicle.launchJob(hostile_job, function(launch_err, jobs) {
						var untrusted_job = captured_job;
						test.ok(!launch_err, 'Untrusted launch-context regression completed');
						test.ok(!!jobs && (jobs.length == 1), 'Untrusted launch produced one job');
						test.ok(!!untrusted_job, 'Captured local launch job');
						test.ok(untrusted_job && (untrusted_job.uid == 'trusted-plugin-user'), 'Plugin UID replaced the event-level UID');
						test.ok(untrusted_job && (untrusted_job.gid == 'trusted-plugin-group'), 'Plugin GID replaced the event-level GID');
						test.ok(untrusted_job && !Object.prototype.hasOwnProperty.call(untrusted_job, 'cwd'), 'Event-level cwd was stripped from job');
						test.ok(untrusted_job && untrusted_job.env.PATH != '/tmp', 'Event-level env was replaced by trusted launch context');
						test.ok(untrusted_job && !Object.prototype.hasOwnProperty.call(untrusted_job, 'debug_sudo'), 'Untrusted event-level debug_sudo was stripped');
						test.ok(untrusted_job && !Object.prototype.hasOwnProperty.call(untrusted_job, '_cronicle_run_as'), 'Local manager job had no transport context');

						var worker_options = cronicle.getChildRunAsOptions(untrusted_job, 'linux', 701, 702);
						test.ok(worker_options.uid == 'trusted-plugin-user', 'Unix worker received the serialized Plugin UID');
						test.ok(worker_options.gid == 'trusted-plugin-group', 'Unix worker received the serialized Plugin GID');

						captured_job = null;
						cronicle.launchJob(Tools.copyHash(event, true), function(admin_err, admin_jobs) {
							var admin_job = captured_job;
							cronicle.launchLocalJob = original_launch_local_job;
							storage.listFindUpdate('global/plugins', { id: 'shellplug' }, { uid: '', gid: '' }, function(restore_err) {
								test.ok(!restore_err, 'Test Plugin launch identity was restored');
								test.ok(!admin_err, 'Trusted admin debug launch succeeded');
								test.ok(!!admin_jobs && (admin_jobs.length == 1), 'Trusted admin launch produced one job');
								test.ok(!!admin_job && (admin_job.uid === 801), 'Trusted debug launch used the executing worker service UID');
								test.ok(admin_job && (admin_job.gid == 'trusted-plugin-group'), 'Trusted debug launch retained Plugin GID');
								test.ok(admin_job && !Object.prototype.hasOwnProperty.call(admin_job, 'debug_sudo'), 'Worker removed the one-shot marker before active state');
								test.ok(admin_job && !Object.prototype.hasOwnProperty.call(admin_job, '_cronicle_run_as'), 'Local debug launch never entered persistent transport context');
								test.done();
							});
						}, { debug_sudo: true });
					});
				});
			});
		},
		
		
		function testSchedulerTick(test) {
			// tick scheduler with false time, which should start our job
			var self = this;
			
			test.ok( !!cronicle.state.enabled, "Scheduler state is currently enabled" );
			
			// add API handler for testing web hooks
			cronicle.api_unit_test_web_hook = function(args, callback) {
				// hello
				var params = args.params || {};
				
				if (self.expect_web_hook && self.current_test && (params.action == 'job_complete')) {
					var test = self.current_test;
					delete self.current_test;
					
					self.web_hook_data = params;
					test.ok( !!params, "Got web hook data" );
					test.done();
				}
				
				callback({ code: 0 });
			}; // web hook handler
			
			// set props for api callback to detect
			self.expect_web_hook = true;
			self.web_hook_data = null;
			self.current_test = test;
			
			// setup our fake timestamp to match event timing settings
			var dargs = Tools.getDateArgs( Tools.timeNow(true) );
			dargs.min = 25; // match our event timing
			
			// tick the scheduler
			cronicle.schedulerMinuteTick( dargs );
		},
		
		function testWebHookData(test) {
			// web hook should have got us here, so let's examine the data
			var job = this.web_hook_data;
			test.debug("Web hook data:", job);
			
			delete this.web_hook_data;
			delete this.expect_web_hook;
			
			test.ok( !!job, "Got web hook data" );
			test.ok( !!job.id, "Job has an ID", job );
			test.ok( job.id != this.job_id, "Job ID does not match previous job", job );
			test.ok( job.code == 0, "Job is not marked as an error", job );
			test.ok( job.event == this.event_id, "Job Event ID matches", job );
			test.ok( job.category == "general", "Job has correct category", job );
			test.ok( job.plugin == "shellplug", "Job has correct Plugin", job );
			test.ok( !!job.base_app_url, "Job has correct key pulled from config via web hook", job );
			test.ok( job.something_custom == "nonstandard property", "Job has correct custom web hook property", job );
			test.ok( !job.smtp_hostname, "Job does not have config key not in the web hook key list", job );
			
			test.done();
		},
		
		function testRunFailedEvent(test) {
			// run an event that fails
			var self = this;
			
			// set props for api callback to detect
			this.expect_web_hook = true;
			this.web_hook_data = null;
			this.current_test = test;
			
			storage.listFind( 'global/schedule', { id: this.event_id }, function(err, event) {
				test.ok( !err, "No error locating event in schedule" );
				test.ok( !!event, "Found event in schedule" );
				
				var job = Tools.copyHash( event, true );
				job.params.script = "#!/bin/sh\n\necho \"UNIT TEST DELIBERATE FAILURE\"\nexit 1\n";
				
				cronicle.launchJob( job, function(err, jobs) {
					// not doing anything here, as web hook should fire automatically and finish the test
				} );
			} );
		},
		
		function testRunFailedResults(test) {
			// make sure failed event really failed
			var job = this.web_hook_data;
			test.debug( "Web hook data: ", job );
			
			delete this.web_hook_data;
			delete this.expect_web_hook;
			
			test.ok( !!job, "Got web hook data" );
			test.ok( !!job.id, "Job has an ID" );
			test.ok( job.code != 0, "Job is marked as an error" );
			test.ok( !!job.description, "Job has an error description" );
			test.ok( job.event == this.event_id, "Job Event ID matches" );
			test.ok( job.category == "general", "Job has correct category" );
			test.ok( job.plugin == "shellplug", "Job has correct Plugin" );
			
			// need rest here, for async logs to finish inserting
			setTimeout( function() {
				test.done();
			}, 500 );
		},
		
		function testRunDetachedEvent(test) {
			// run event in detached mode
			var self = this;
			
			storage.listFind( 'global/schedule', { id: this.event_id }, function(err, event) {
				test.ok( !err, "No error locating event in schedule" );
				test.ok( !!event, "Found event in schedule" );
				
				var job = Tools.copyHash( event, true );
				job.detached = 1;
				
				cronicle.launchJob( job, function(err, jobs) {
					test.ok( !err, "No error launching job" );
					test.ok( !!jobs, "Got array of launched jobs" );
					test.ok( jobs.length == 1, "Launched exactly one job" );
					test.ok( jobs[0].id, "Got Job ID" );
					
					// save new job id
					self.detached_job_id = jobs[0].id;
					
					test.done();
				} );
			} );
		},
		
		function testWaitForDetachedQueue(test) {
			// monitor queue directory until finished file shows up
			var self = this;
			var file_spec = server.config.get('queue_dir') + '/*.json';
			var files_found = false;
			
			async.doWhilst(
				function (callback) {
					// poll queue dir
					glob(file_spec, {}, function (err, files) {
						// got task files
						if (files && files.length) {
							files_found = true;
						}
						setTimeout( callback, 250 );
					} );
				},
				function () { return (!files_found); },
				function (err) {
					// got files, we're done
					test.done();
				}
			);
		},
		
		function testFinishDetachedEvent(test) {
			// force external queue to run to process finished event
			
			// set props for api callback to detect
			this.expect_web_hook = true;
			this.web_hook_data = null;
			this.current_test = test;
			
			cronicle.monitorExternalQueue();
			// not calling test.done() as it should fire via web hook
		},
		
		function testDetachedWebHookData(test) {
			// web hook should have got us here, so let's examine the data
			var job = this.web_hook_data;
			test.debug( "Detached web hook data: ", job );
			
			delete this.web_hook_data;
			delete this.expect_web_hook;
			
			test.ok( !!job, "Got web hook data" );
			test.ok( !!job.id, "Job has an ID" );
			test.ok( job.id == this.detached_job_id, "Job ID matches our detached job" );
			test.ok( job.code == 0, "Job is not marked as an error" );
			test.ok( job.event == this.event_id, "Job Event ID matches" );
			test.ok( job.category == "general", "Job has correct category" );
			test.ok( job.plugin == "shellplug", "Job has correct Plugin" );
			
			// need rest here, for async logs to finish inserting,
			// before we delete the associated event (which also deletes logs!)
			setTimeout( function() {
				test.done();
			}, 500 );
		},
		
		// app/delete_event
		
		function testAPIDeleteEvent(test) {
			// test app/delete_event api
			var self = this;
			var params = {
				"id": this.event_id,
				"session_id": session_id
			};
			
			request.json( api_url + '/app/delete_event', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that event actually got deleted from storage
				storage.listFind( 'global/schedule', { id: self.event_id }, function(err, event) {
					
					test.ok( !err, "No error expected for missing data" );
					test.ok( !event, "Data record should be null (deleted)" );
					
					delete self.event_id;
					
					test.done();
				} );
			} );
		},
		
		
		
		// TODO: app/abort_job
		// TODO: app/abort_jobs
		
		// TODO: catch-up event
		
		
		
		// app/update_manager_state
		
		function testAPIUpdatemanagerState(test) {
			// test app/update_manager_state api
			var self = this;
			var params = {
				"session_id": session_id,
				"enabled": 0
			};
			
			// pre-check that state is currently enabled
			test.ok( !!cronicle.state.enabled, "Scheduler state is currently enabled" );
			
			// disable it via API
			request.json( api_url + '/app/update_manager_state', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that change took effect
				test.ok( !cronicle.state.enabled, "State is actually disabled" );
				
				test.done();
			} );
		},
		
		// user/logout
		
		function testAPIUserLogout(test) {
			// test user/logout api
			var self = this;
			var params = {
				"session_id": session_id
			};
			
			request.json( api_url + '/user/logout', params, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( "code" in data, "Found code prop in JSON response" );
				test.ok( data.code == 0, "Code is zero (no error)" );
				
				// check to see that session actually got deleted from storage
				storage.get('sessions/' + session_id, function(err, data) {
					
					test.ok( !!err, "Error expected for missing session" );
					test.ok( !data, "Data record should be null (deleted)" );
					
					test.done();
				} );
			} );
		}
		
	], // tests array
	
	tearDown: function (callback) {
		// always called right before shutdown
		this.logDebug(1, "Running tearDown");
		
		// add some delays here so async storage ops can complete
		setTimeout( function() { 
			server.shutdown( function() {
				// delete our mess after a short rest (just so no errors are logged)
				setTimeout( function() {
					try { cleanUp() }
					catch (e) {;}
					
					callback();
				}, 500 );
			} );
		}, 500 );
	}
};
