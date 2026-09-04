// Unit tests for Cronicle (run using `npm test`)
// Copyright (c) 2016 - 2017 Joseph Huckaby
// Released under the MIT License

var cp = require('child_process');
var crypto = require('crypto');
var fs = require('fs');
var async = require('async');
var moment = require('moment-timezone');

var Tools = require('pixl-tools');
var glob = Tools.glob;
var PixlServer = require("pixl-server");

// we need a few config files
var config = require('../sample_conf/config.json');
// deep copy: the bootstrap below shifts the storage tuples apart, and engine code that reads
// the bundled setup during the suite must still see them whole
var setup = Tools.copyHash( require('../sample_conf/setup.json'), true );

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

// the only plugins classic Cronicle seeds -- everything else in the edge setup is edge-only
var classic_plugin_ids = ['testplug', 'shellplug', 'urlplug'];

// the edge records the legacy import tests rewrite, so they can be put back afterwards
var stock_plugins = null;
var stock_groups = null;

function simulateClassicGroups(callback) {
	// classic Cronicle wrote `master` on its server groups and had no `manager` field at all
	storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
		if (err) return callback(err);
		async.eachSeries( groups,
			function(group, callback) {
				var classic = Tools.copyHash( group, true );
				delete classic.manager;
				classic.master = group.manager ? 1 : 0;
				storage.listFindReplace( 'global/server_groups', { id: group.id }, classic, callback );
			},
			callback
		);
	} );
}

function simulateClassicFolder(callback) {
	// a folder migrated from classic holds only the plugins classic itself seeded
	storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
		if (err) return callback(err);
		var edge_only = plugins.filter( function(plugin) { return classic_plugin_ids.indexOf( plugin.id ) == -1; } );

		async.eachSeries( edge_only,
			function(plugin, callback) { storage.listFindDelete( 'global/plugins', { id: plugin.id }, callback ); },
			function(err) {
				if (err) return callback(err);
				simulateClassicGroups( callback );
			}
		);
	} );
}

function restoreEdgeFolder(callback) {
	// hand the rest of the suite back the plugin and server group records it started with
	storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
		if (err) return callback(err);
		var stock_ids = stock_plugins.map( function(plugin) { return plugin.id; } );
		var present_ids = plugins.map( function(plugin) { return plugin.id; } );
		var imported = plugins.filter( function(plugin) { return stock_ids.indexOf( plugin.id ) == -1; } );
		// the import never puts back a stock record it skips (the SSH plugin), so those return by hand
		var missing = stock_plugins.filter( function(plugin) { return present_ids.indexOf( plugin.id ) == -1; } );

		async.eachSeries( imported,
			function(plugin, callback) { storage.listFindDelete( 'global/plugins', { id: plugin.id }, callback ); },
			function(err) {
				if (err) return callback(err);
				// listPush shifts the items out of the array it is handed, so give it a copy
				var push_missing = missing.length
					? function(callback) { storage.listPush( 'global/plugins', missing.slice(), callback ); }
					: function(callback) { callback(); };
				push_missing( function(err) {
					if (err) return callback(err);
					async.eachSeries( stock_groups,
						function(group, callback) { storage.listFindReplace( 'global/server_groups', { id: group.id }, group, callback ); },
						callback
					);
				} );
			}
		);
	} );
}

// a lost page or header write leaves a list header the list API can no longer delete,
// so wipe the header and pages directly and rebuild the list from the stock records
function rebuildPluginList(callback) {
	storage.cache = {};
	storage.get( 'global/plugins', function(err, list) {
		var keys = ['global/plugins'];
		if (list) for (var idx = list.first_page; idx <= list.last_page; idx++) keys.push( 'global/plugins/' + idx );
		async.eachSeries( keys,
			function(key, callback) { storage.delete( key, function() { callback(); } ); },
			function() {
				storage.listCreate( 'global/plugins', {}, function(err) {
					if (err) return callback(err);
					// listPush shifts the items out of the array it is handed, so give it a copy
					storage.listPush( 'global/plugins', stock_plugins.slice(), function(err) {
						if (err) return callback(err);
						restoreEdgeFolder( callback );
					} );
				} );
			}
		);
	} );
}

// what the pages of a list physically hold, straight from the engine (listGet trims
// to the header's count and the manager's RAM cache may be ahead of the disk)
function readPluginPages(callback) {
	storage.engine.get( 'global/plugins', function(err, list) {
		if (err) return callback(err);
		var items = [];
		var page_idx = list.first_page;
		var next = function() {
			if (page_idx > list.last_page) return callback( null, items, list );
			storage.engine.get( 'global/plugins/' + page_idx, function(err, page) {
				if (err) return callback(err);
				items = items.concat( page.items || [] );
				page_idx++;
				next();
			} );
		};
		next();
	} );
}

// global refs
var server = null;
var storage = null;
var cronicle = null;
var request = null;
var api_url = '';
var session_id = '';

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
		process.env.CRONICLE_password = 'UNIT_TEST_PASSWORD';
		process.env.CRONICLE_sqlpassword = 'UNIT_TEST_SQL_PASSWORD';
		
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
			test.ok( !process.env.CRONICLE_password, 'Generic password was removed from the process environment');
			test.ok( !process.env.CRONICLE_sqlpassword, 'SQL password was removed from the process environment');
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

		function testIsManagerGroupAlias(test) {
			// classic Cronicle called the manager node "master"; a data folder migrated
			// from classic yields server_groups records with `master` set and no `manager`
			// field. The read-path alias must count such a group as manager-eligible while
			// leaving edge-native (`manager`) records unchanged. (No stored record is rewritten.)
			test.ok( cronicle.isManagerGroup({ master: 1 }) === true, "master:1 with no manager field is a manager group" );
			test.ok( cronicle.isManagerGroup({ manager: 1 }) === true, "manager:1 is a manager group" );
			test.ok( cronicle.isManagerGroup({ manager: 0 }) === false, "manager:0 is not a manager group" );
			test.ok( cronicle.isManagerGroup({ master: 0 }) === false, "master:0 is not a manager group" );
			test.ok( cronicle.isManagerGroup({}) === false, "a group with neither flag is not a manager group" );
			test.ok( cronicle.isManagerGroup({ manager: 0, master: 1 }) === false, "manager:0 revokes eligibility even with master:1" );
			test.ok( cronicle.isManagerGroup({ manager: 1, master: 0 }) === true, "manager:1 grants eligibility even with master:0" );
			test.done();
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

		function testCreateRequiredLists(test) {
			// simulate a data folder migrated from classic Cronicle, which has neither of the
			// two global lists edge reads on every job launch
			test.ok( cronicle.requiredLists.length == 2, "Two global lists are required" );

			async.eachSeries( cronicle.requiredLists,
				function(key, callback) { storage.listDelete( key, true, callback ); },
				function(err) {
					test.ok( !err, "No error deleting the required lists" );

					// gomanager above already ran the check, so release the once-per-process latch
					cronicle.requiredListsChecked = false;
					cronicle.createRequiredLists( function() {
						storage.listFind( 'global/secrets', { id: 'globalenv' }, function(err, secret) {
							test.ok( !err, "No error fetching recreated global/secrets" );
							test.ok( !!secret, "Recreated global/secrets holds the globalenv item" );
							test.ok( !!secret && (secret.created > 0), "Recreated globalenv item has a creation date" );

							storage.listGet( 'global/secrets', 0, 0, function(err, secrets) {
								test.ok( !err, "No error listing recreated global/secrets" );
								test.ok( secrets.length === 1, "Recreated global/secrets has one item" );

								storage.listGet( 'global/conf_keys', 0, 0, function(err, conf_keys) {
									test.ok( !err, "No error fetching recreated global/conf_keys" );
									test.ok( conf_keys.length === 0, "Recreated global/conf_keys is empty (every sample key is optional)" );
									test.done();
								} );
							} );
						} );
					} );
				}
			);
		},

		function testCreateRequiredListsLeavesAnExistingListAlone(test) {
			storage.get( 'global/secrets', function(err, header) {
				test.ok( !err, "No error fetching the global/secrets list header" );
				var before_length = header.length;

				storage.listGet( 'global/secrets', 0, 0, function(err, before) {
					test.ok( !err, "No error fetching global/secrets before the second pass" );
					var before_json = JSON.stringify( before );

					cronicle.requiredListsChecked = false;
					cronicle.createRequiredLists( function() {
						storage.get( 'global/secrets', function(err, header) {
							test.ok( !err, "No error fetching the list header after the second pass" );
							test.ok( header.length === before_length, "global/secrets list length is unchanged" );

							storage.listGet( 'global/secrets', 0, 0, function(err, after) {
								test.ok( !err, "No error fetching global/secrets after the second pass" );
								test.ok( JSON.stringify( after ) === before_json, "global/secrets was not seeded a second time" );
								test.done();
							} );
						} );
					} );
				} );
			} );
		},

		function testCreateRequiredListsWritesNothingOnAnIntactFolder(test) {
			var writes = [];
			var orig_list_create = storage.listCreate;
			var orig_list_push = storage.listPush;
			storage.listCreate = function(key) { writes.push( 'listCreate ' + key ); return orig_list_create.apply( storage, arguments ); };
			storage.listPush = function(key) { writes.push( 'listPush ' + key ); return orig_list_push.apply( storage, arguments ); };

			cronicle.requiredListsChecked = false;
			cronicle.createRequiredLists( function() {
				storage.listCreate = orig_list_create;
				storage.listPush = orig_list_push;

				test.ok( writes.length === 0, "Nothing was created or pushed on an intact folder: " + writes.join(', ') );
				test.done();
			} );
		},

		function testCreateRequiredListsSurvivesASeedFailure(test) {
			// an empty required list is a valid end state: the key exists, so the next manager
			// start leaves it alone, and the manager startup chain must not stall on it
			storage.listDelete( 'global/secrets', true, function(err) {
				test.ok( !err, "No error deleting global/secrets" );

				var push_attempted = false;
				var orig_list_push = storage.listPush;
				storage.listPush = function(key, items, create_opts, callback) {
					if (key == 'global/secrets') {
						push_attempted = true;
						if (!callback && (typeof(create_opts) == 'function')) callback = create_opts;
						return callback( new Error("Simulated storage failure") );
					}
					return orig_list_push.apply( storage, arguments );
				};

				cronicle.requiredListsChecked = false;
				cronicle.createRequiredLists( function(err) {
					storage.listPush = orig_list_push;
					test.ok( !err, "The failed seed does not fail the manager startup chain" );
					test.ok( push_attempted, "The simulated seed failure was reached" );

					storage.listGet( 'global/secrets', 0, 0, function(err, items) {
						test.ok( !err, "global/secrets exists after the failed seed" );
						test.ok( items.length === 0, "global/secrets is empty after the failed seed" );

						// leave the folder healthy for the rest of the suite
						storage.listDelete( 'global/secrets', true, function(err) {
							test.ok( !err, "No error deleting the empty global/secrets" );
							cronicle.requiredListsChecked = false;
							cronicle.createRequiredLists( function() {
								storage.listFind( 'global/secrets', { id: 'globalenv' }, function(err, secret) {
									test.ok( !!secret, "global/secrets holds the globalenv item again" );
									test.done();
								} );
							} );
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPlugins(test) {
			// keep the edge records so they can be handed back to the rest of the suite
			storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
				test.ok( !err, "No error fetching global/plugins" );
				stock_plugins = Tools.copyHash( { list: plugins }, true ).list;

				storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
					test.ok( !err, "No error fetching global/server_groups" );
					stock_groups = Tools.copyHash( { list: groups }, true ).list;

					simulateClassicFolder( function(err) {
						test.ok( !err, "No error simulating a data folder migrated from classic" );

						cronicle.legacyImportChecked = false;
						cronicle.importLegacyPlugins( function() {
							storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
								test.ok( !err, "No error fetching global/plugins after the import" );

								var by_id = {};
								plugins.forEach( function(plugin) { by_id[plugin.id] = plugin; } );

								var missing = stock_plugins.filter( function(plugin) { return (plugin.id != 'sshplug') && !by_id[plugin.id]; } )
									.map( function(plugin) { return plugin.id; } );
								test.ok( missing.length === 0, "Every stock plugin but SSH is in place after the import: missing " + missing.join(', ') );

								test.ok( !!by_id.sshxplug, "The import added the SSHX plugin" );
								test.ok( !!by_id.sshxplug && (by_id.sshxplug.created > 0), "The imported plugin has a creation date" );
								test.ok( !by_id.sshplug, "The import skipped the SSH plugin" );
								test.ok( !by_id.shellplug_v2 && !by_id.testplug_v2, "The import added no copies of the plugins classic ships" );
								var shell_records = plugins.filter( function(plugin) { return plugin.id == 'shellplug'; } );
								test.ok( shell_records.length === 1, "The shell plugin classic wrote is the only one with its id after the import" );

								// whatever classic wrote must come through the import untouched
								var kept = stock_plugins.filter( function(plugin) { return classic_plugin_ids.indexOf( plugin.id ) > -1; } );
								test.ok( kept.length === 3, "The simulated classic folder kept its three plugins" );
								kept.forEach( function(plugin) {
									test.ok( JSON.stringify( by_id[plugin.id] ) === JSON.stringify( plugin ), "Existing plugin record was not rewritten: " + plugin.id );
								} );

								storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
									test.ok( !err, "No error fetching global/server_groups after the import" );
									test.ok( groups.length > 0, "The server group list is not empty" );
									groups.forEach( function(group) {
										test.ok( group.manager !== undefined, "Group carries the import fingerprint: " + group.id );
										test.ok( group.master !== undefined, "Group kept its classic master flag: " + group.id );
										test.ok( !!group.manager === !!group.master, "Group manager flag matches its master flag: " + group.id );
									} );
									test.done();
								} );
							} );
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPluginsRunsOnce(test) {
			// the fingerprint is what keeps the second manager start from importing again
			storage.listGet( 'global/plugins', 0, 0, function(err, before_plugins) {
				test.ok( !err, "No error fetching global/plugins before the second pass" );

				storage.listGet( 'global/server_groups', 0, 0, function(err, before_groups) {
					test.ok( !err, "No error fetching global/server_groups before the second pass" );
					var before_groups_json = JSON.stringify( before_groups );

					var pushes = [];
					var orig_list_push = storage.listPush;
					storage.listPush = function(key) { pushes.push( key ); return orig_list_push.apply( storage, arguments ); };

					cronicle.legacyImportChecked = false;
					cronicle.importLegacyPlugins( function() {
						storage.listPush = orig_list_push;
						test.ok( pushes.length === 0, "The second pass pushed nothing: " + pushes.join(', ') );

						storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
							test.ok( !err, "No error fetching global/plugins after the second pass" );
							test.ok( plugins.length === before_plugins.length, "The plugin list length is unchanged" );

							storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
								test.ok( !err, "No error fetching global/server_groups after the second pass" );
								test.ok( JSON.stringify( groups ) === before_groups_json, "The server group records are unchanged" );
								test.done();
							} );
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPluginsSkipsAnEdgeFolder(test) {
			// every group carries a manager flag now, so there is nothing left to detect
			var reads = [];
			var writes = [];
			var orig_list_get = storage.listGet;
			var orig_list_push = storage.listPush;
			var orig_list_find_update = storage.listFindUpdate;
			storage.listGet = function(key) { reads.push( key ); return orig_list_get.apply( storage, arguments ); };
			storage.listPush = function(key) { writes.push( 'listPush ' + key ); return orig_list_push.apply( storage, arguments ); };
			storage.listFindUpdate = function(key) { writes.push( 'listFindUpdate ' + key ); return orig_list_find_update.apply( storage, arguments ); };

			cronicle.legacyImportChecked = false;
			cronicle.importLegacyPlugins( function() {
				storage.listGet = orig_list_get;
				storage.listPush = orig_list_push;
				storage.listFindUpdate = orig_list_find_update;

				test.ok( reads.length === 1, "An edge folder is ruled out with a single list read: " + reads.join(', ') );
				test.ok( reads[0] === 'global/server_groups', "The single read is the server group list" );
				test.ok( writes.length === 0, "An edge folder is not written to: " + writes.join(', ') );
				test.done();
			} );
		},

		function testImportLegacyPluginsDoesNotStampAFailedImport(test) {
			// the fingerprint may only be written once every plugin is in, or a folder that
			// failed half way would never be finished
			simulateClassicFolder( function(err) {
				test.ok( !err, "No error simulating a data folder migrated from classic" );

				var pushes = 0;
				var orig_list_push = storage.listPush;
				storage.listPush = function(key, items, create_opts, callback) {
					if ((key == 'global/plugins') && (++pushes == 3)) {
						if (!callback && (typeof(create_opts) == 'function')) callback = create_opts;
						return callback( new Error("Simulated storage failure") );
					}
					return orig_list_push.apply( storage, arguments );
				};

				cronicle.legacyImportChecked = false;
				cronicle.importLegacyPlugins( function() {
					storage.listPush = orig_list_push;
					test.ok( pushes === 3, "The simulated push failure was reached and stopped the import" );

					storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
						test.ok( !err, "No error fetching global/server_groups after the failed import" );
						var stamped = groups.filter( function(group) { return group.manager !== undefined; } );
						test.ok( stamped.length === 0, "No group was stamped after the failed import" );

						// the next manager start finishes what the failed one started
						cronicle.legacyImportChecked = false;
						cronicle.importLegacyPlugins( function() {
							storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
								test.ok( !err, "No error fetching global/plugins after the retry" );
								var ids = plugins.map( function(plugin) { return plugin.id; } );
								test.ok( ids.indexOf('sshxplug') > -1, "The retry kept the plugins the failed pass imported" );
								test.ok( ids.indexOf('terminal') > -1, "The retry imported the plugins the failed pass never reached" );

								var dupes = ids.filter( function(id, idx) { return ids.indexOf(id) != idx; } );
								test.ok( dupes.length === 0, "The retry imported nothing twice: " + dupes.join(', ') );

								storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
									test.ok( !err, "No error fetching global/server_groups after the retry" );
									var unstamped = groups.filter( function(group) { return group.manager === undefined; } );
									test.ok( unstamped.length === 0, "Every group was stamped after the retry" );
									test.done();
								} );
							} );
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPluginsDoesNotStampAnUnconfirmedImport(test) {
			// the list writer can report success for a push whose page never landed, so the
			// fingerprint must follow the list's own contents rather than the callbacks
			simulateClassicFolder( function(err) {
				test.ok( !err, "No error simulating a data folder migrated from classic" );

				var pushes = 0;
				var skipped_id = null;
				var orig_list_push = storage.listPush;
				storage.listPush = function(key, items, create_opts, callback) {
					if ((key == 'global/plugins') && (++pushes == 3)) {
						if (!callback && (typeof(create_opts) == 'function')) callback = create_opts;
						skipped_id = items.id;
						return callback( null );
					}
					return orig_list_push.apply( storage, arguments );
				};

				cronicle.legacyImportChecked = false;
				cronicle.importLegacyPlugins( function() {
					storage.listPush = orig_list_push;
					test.ok( !!skipped_id, "The simulated silent push was reached" );

					storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
						test.ok( !err, "No error fetching global/plugins after the silent push" );
						var ids = plugins.map( function(plugin) { return plugin.id; } );
						test.ok( ids.indexOf(skipped_id) == -1, "The silently dropped plugin is absent from the list" );

						storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
							test.ok( !err, "No error fetching global/server_groups after the silent push" );
							var stamped = groups.filter( function(group) { return group.manager !== undefined; } );
							test.ok( stamped.length === 0, "No group was stamped while an import was missing from the list" );

							// the next manager start finishes the import and only then stamps
							cronicle.legacyImportChecked = false;
							cronicle.importLegacyPlugins( function() {
								storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
									test.ok( !err, "No error fetching global/plugins after the retry" );
									var ids = plugins.map( function(plugin) { return plugin.id; } );
									test.ok( ids.indexOf(skipped_id) > -1, "The retry imported the plugin the silent push dropped" );

									storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
										test.ok( !err, "No error fetching global/server_groups after the retry" );
										var unstamped = groups.filter( function(group) { return group.manager === undefined; } );
										test.ok( unstamped.length === 0, "Every group was stamped after the retry" );
										test.done();
									} );
								} );
							} );
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPluginsDoesNotTrustTheRamCache(test) {
			// on the manager, put() primes the global/* RAM cache before the engine write and
			// leaves it there when the write fails, so the read-back has to come from the engine
			test.ok( !!storage.cacheKeyRegex, "The global/* RAM cache is on, as it is on a manager" );

			simulateClassicFolder( function(err) {
				test.ok( !err, "No error simulating a data folder migrated from classic" );

				// the last candidate in setup order is the one whose lost page no later push
				// rewrites; an earlier loss is healed when the next push saves the same page
				var failed_key = null;
				var orig_engine_put = storage.engine.put;
				storage.engine.put = function(key, value, callback) {
					var carries_last = value && Array.isArray(value.items) && value.items.some( function(item) { return item.id == 'terminal'; } );
					if (!failed_key && key.match(/^global\/plugins\/\d+$/) && carries_last) {
						// the page fails at once while the header queued next to it still lands,
						// so the push reports success with the item never written
						failed_key = key;
						return callback( new Error("Simulated page write failure") );
					}
					return orig_engine_put.apply( storage.engine, arguments );
				};

				cronicle.legacyImportChecked = false;
				cronicle.importLegacyPlugins( function() {
					storage.engine.put = orig_engine_put;
					test.ok( !!failed_key, "The simulated page write failure was reached" );

					storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
						test.ok( !err, "No error fetching global/server_groups after the lost page write" );
						var stamped = groups.filter( function(group) { return group.manager !== undefined; } );
						test.ok( stamped.length === 0, "No group was stamped while the cache and the disk disagreed" );

						rebuildPluginList( function(err) {
							test.ok( !err, "No error rebuilding the plugin list for the rest of the suite" );
							test.done();
						} );
					} );
				} );
			} );
		},

		function testImportLegacyPluginsSeesAnItemHiddenByAFailedHeaderWrite(test) {
			// a page write that lands while its header write fails leaves an item listGet cannot
			// show, so a retry that trusted listGet would push it a second time; the import reads
			// the pages themselves and refuses to touch a list whose header disagrees with them
			simulateClassicFolder( function(err) {
				test.ok( !err, "No error simulating a data folder migrated from classic" );

				var failed = false;
				var orig_engine_put = storage.engine.put;
				storage.engine.put = function(key, value, callback) {
					// the last candidate's header write fails at once while its page write, queued
					// next to it, still lands, so the push reports success and the item sits on the
					// page beyond the count the header was left with
					if (!failed && (key == 'global/plugins') && (value.length > 0) && value.last_page >= 0) {
						var pending = storage.cache['global/plugins/' + value.last_page];
						if (pending && pending.items && pending.items.some( function(item) { return item.id == 'terminal'; } )) {
							failed = true;
							return callback( new Error("Simulated header write failure") );
						}
					}
					return orig_engine_put.apply( storage.engine, arguments );
				};

				cronicle.legacyImportChecked = false;
				cronicle.importLegacyPlugins( function() {
					storage.engine.put = orig_engine_put;
					test.ok( failed, "The simulated header write failure was reached" );

					readPluginPages( function(err, items, list) {
						test.ok( !err, "No error reading the plugin pages after the lost header write" );
						var terminals = items.filter( function(item) { return item.id == 'terminal'; } );
						test.ok( terminals.length === 1, "The page holds the item the header write lost" );
						test.ok( items.length === list.length + 1, "The header counts one item fewer than the pages hold" );

						storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
							test.ok( !err, "No error fetching global/server_groups after the lost header write" );
							var stamped = groups.filter( function(group) { return group.manager !== undefined; } );
							test.ok( stamped.length === 0, "No group was stamped while the header disagreed with the pages" );

							// the next manager start must neither duplicate the hidden item nor stamp
							cronicle.legacyImportChecked = false;
							cronicle.importLegacyPlugins( function() {
								readPluginPages( function(err, items) {
									test.ok( !err, "No error reading the plugin pages after the retry" );
									var terminals = items.filter( function(item) { return item.id == 'terminal'; } );
									test.ok( terminals.length === 1, "The retry did not push the hidden item a second time" );

									storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
										test.ok( !err, "No error fetching global/server_groups after the retry" );
										var stamped = groups.filter( function(group) { return group.manager !== undefined; } );
										test.ok( stamped.length === 0, "The retry left the groups unstamped on the inconsistent list" );

										rebuildPluginList( function(err) {
											test.ok( !err, "No error rebuilding the plugin list for the rest of the suite" );
											test.done();
										} );
									} );
								} );
							} );
						} );
					} );
				} );
			} );
		},

		function testGomanagerRepairsALegacyFolder(test) {
			// both steps have to hang off the manager startup path, not just be callable
			simulateClassicFolder( function(err) {
				test.ok( !err, "No error simulating a data folder migrated from classic" );

				async.eachSeries( cronicle.requiredLists,
					function(key, callback) { storage.listDelete( key, true, callback ); },
					function(err) {
						test.ok( !err, "No error deleting the required lists" );

						cronicle.requiredListsChecked = false;
						cronicle.legacyImportChecked = false;
						cronicle.gomanager();

						var deadline = Tools.timeNow() + 10;
						var poll = function() {
							storage.listFind( 'global/secrets', { id: 'globalenv' }, function(secrets_err, secret) {
								storage.get( 'global/conf_keys', function(conf_err) {
									storage.listGet( 'global/plugins', 0, 0, function(plugins_err, plugins) {
										storage.listGet( 'global/server_groups', 0, 0, function(groups_err, groups) {
											var ids = (plugins || []).map( function(plugin) { return plugin.id; } );
											var unstamped = (groups || []).filter( function(group) { return group.manager === undefined; } );

											var repaired = !secrets_err && !!secret && !conf_err && !plugins_err && !groups_err &&
												(ids.indexOf('terminal') > -1) && (ids.indexOf('workflow') > -1) &&
												(ids.indexOf('sshxplug') > -1) && groups.length && !unstamped.length;

											if (repaired) {
												test.ok( true, "gomanager created the required lists, imported the edge plugins and stamped the groups" );
												return test.done();
											}
											if (Tools.timeNow() > deadline) {
												test.ok( !secrets_err && !!secret, "gomanager recreated global/secrets with its seed item" );
												test.ok( !conf_err, "gomanager recreated global/conf_keys" );
												test.ok( ids.indexOf('terminal') > -1, "gomanager imported the edge only plugins" );
												test.ok( ids.indexOf('sshxplug') > -1, "gomanager imported the SSHX plugin" );
												test.ok( !!groups.length && !unstamped.length, "gomanager stamped every legacy server group" );
												return test.done();
											}
											setTimeout( poll, 100 );
										} );
									} );
								} );
							} );
						};
						poll();
					}
				);
			} );
		},

		function testcheckmanagerEligibilityOnStoredClassicGroups(test) {
			// a migrated node that is not eligible never becomes manager, so none of the
			// migration steps above would ever run on the folder that needs them
			simulateClassicGroups( function(err) {
				test.ok( !err, "No error rewriting the server groups the way classic wrote them" );

				cronicle.checkmanagerEligibility( function() {
					test.ok( cronicle.multi.eligible === true, "A stored classic master group makes this server eligible" );

					// and once the fingerprint is on the record, revoking it through the edge UI
					// has to win over the classic flag that is still sitting next to it
					storage.listFindUpdate( 'global/server_groups', { id: 'maingrp' }, { manager: 0 }, function(err) {
						test.ok( !err, "No error writing manager:0 onto the classic group" );

						storage.listFind( 'global/server_groups', { id: 'maingrp' }, function(err, group) {
							test.ok( !!group && !!group.master, "The classic master flag is still on the group" );

							cronicle.checkmanagerEligibility( function() {
								test.ok( cronicle.multi.eligible === false, "manager:0 revokes eligibility even with the classic master flag set" );

								restoreEdgeFolder( function(err) {
									test.ok( !err, "No error restoring the edge folder" );

									storage.listGet( 'global/plugins', 0, 0, function(err, plugins) {
										var ids = plugins.map( function(plugin) { return plugin.id; } ).sort();
										var stock_ids = stock_plugins.map( function(plugin) { return plugin.id; } ).sort();
										test.ok( JSON.stringify( ids ) === JSON.stringify( stock_ids ), "The plugin list is back to the edge records" );

										storage.listGet( 'global/server_groups', 0, 0, function(err, groups) {
											test.ok( JSON.stringify( groups ) === JSON.stringify( stock_groups ), "The server group list is back to the edge records" );

											cronicle.checkmanagerEligibility( function() {
												test.ok( cronicle.multi.eligible === true, "The restored edge folder is eligible again" );
												test.done();
											} );
										} );
									} );
								} );
							} );
						} );
					} );
				} );
			} );
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
			
			other_task = { action: 'someOtherAction', id: 'unit-watch-job' };
			launch_task = { action: 'launchLocalJob', id: 'unit-watch-job', hostname: server.hostname };
			cronicle.internalQueue = { other: other_task, launch: launch_task };
			
			cronicle.watchJobLog(
				{ id: 'unit-watch-job' },
				{ id: 'unitSocket', request: { connection: { remoteAddress: '127.0.0.1' } } }
			);
			test.ok( other_task.action == 'someOtherAction', "Non-launch watch task action was not mutated" );
			
			cronicle.internalQueue = old_queue;
			test.done();
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
			var params = {"params":[{"type":"textarea","id":"script","title":"Script Source","rows":10,"value":"#!/bin/sh\n\n# Enter your shell script code here"}],"title":"Copy of Shell Script","command":"bin/shell-plugin.js","enabled":1,"session_id":session_id};
			
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
					
					test.done();
				} );
			} );
		},
		
		// app/update_plugin
		
		function testAPIUpdatePlugin(test) {
			// test app/update_plugin api
			var self = this;
			var params = {"id":this.plugin_id, "title":"Updated Plugin Title","session_id":session_id};
			
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
				"debug_sudo": 1,
				"uid": 0,
				"gid": 0,
				"cwd": "/tmp",
				"env": { "PATH": "/tmp" },
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
					test.ok( !('debug_sudo' in event), "One-shot debug_sudo was not stored" );
					
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
					test.ok( !('debug_sudo' in event), "Event update did not store one-shot debug_sudo" );
					
					test.done();
				} );
			} );
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
		
		// app/run_event

		function testAdminDebugSudoIsOneShot(test) {
			var old_launch = cronicle.launchOrQueueJob;
			var captured_job = null;
			var captured_options = null;

			cronicle.launchOrQueueJob = function(job, callback, launch_options) {
				captured_job = job;
				captured_options = launch_options;
				callback(null, []);
			};

			request.json(api_url + '/app/run_event', {
				id: this.event_id,
				session_id: session_id,
				debug_sudo: 1
			}, function(err, resp, data) {
				cronicle.launchOrQueueJob = old_launch;
				test.ok(!err, "Admin debug_sudo request completed");
				test.ok(data && data.code == 0, "Admin debug_sudo request launched the event");
				test.ok(captured_job && !('debug_sudo' in captured_job), "debug_sudo was not copied into the job");
				test.ok(captured_options && captured_options.debug_sudo === true, "Admin debug_sudo was passed as a one-shot launch option");
				test.done();
			});
		},

		function testNonAdminEditorCannotRequestDebugSudo(test) {
			var api_key = {
				id: 'unit_debug_sudo_editor',
				key: 'unit_debug_sudo_editor_key',
				title: 'Unit Test Event Editor',
				active: 1,
				privileges: {
					admin: 0,
					create_events: 1,
					edit_events: 1,
					run_events: 1
				}
			};
			var old_launch = cronicle.launchOrQueueJob;
			var captured_job = null;
			var captured_options = null;

			storage.listPush('global/api_keys', api_key, function(err) {
				test.ok(!err, "Created non-admin event editor fixture");
				if (err) return test.done();

				cronicle.launchOrQueueJob = function(job, callback, launch_options) {
					captured_job = job;
					captured_options = launch_options;
					callback(null, []);
				};

				request.json(api_url + '/app/run_event', {
					id: this.event_id,
					api_key: api_key.key,
					debug_sudo: 1
				}, function(err, resp, data) {
					cronicle.launchOrQueueJob = old_launch;
					storage.listFindCut('global/api_keys', { id: api_key.id }, function(cleanup_err) {
						test.ok(!cleanup_err, "Removed non-admin event editor fixture");
						test.ok(!err, "Non-admin editor request completed");
						test.ok(data && data.code == 0, "Non-admin editor launched the configured event");
						test.ok(captured_job && !('debug_sudo' in captured_job), "Non-admin editor added no debug_sudo marker");
						test.ok(!captured_options || !captured_options.debug_sudo, "Non-admin editor received no debug_sudo launch option");
						test.done();
					});
				});
			}.bind(this));
		},
		
		function testAPIRunEvent(test) {
			// test app/run_event api
			// run event manually, specify an override
			var self = this;
			var params = {
				"session_id": session_id, 
				id: this.event_id,
				notify_fail: 'test@test.com'
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
			var launchedOptions = null;
			var allowedNow = Tools.timeNow(true) - 60;
			var finished = false;

			function captureLaunch(job, callback, launch_options) {
				launchedJob = job;
				launchedOptions = launch_options;
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
				request.json(api_url + '/app/run_event', {
					id: self.event_id,
					session_id: session_id,
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
						test.ok(launchedJob && !launchedJob.debug_sudo, "Event token debug_sudo override was ignored");
						test.ok(!launchedOptions || !launchedOptions.debug_sudo, "Event token received no debug_sudo launch option");
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
		
		// app/get_live_job_log
		
		function testAPIGetLiveJobLog(test) {
			// test get_live_job_log API (raw HTTP get, not a JSON API)
			var self = this;
			
			request.get( api_url + '/app/get_live_job_log?id=' + this.job_id, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( !!data, "Got data buffer" );
				test.ok( data.length > 0, "Data buffer has length" );
				
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
		
		function testAPIGetJobLog(test) {
			// test get_job_log API (raw HTTP get, not a JSON API)
			var self = this;
			
			request.get( api_url + `/app/get_job_log?id=${this.job_id}&session_id=${session_id}`, function(err, resp, data) {
				
				test.ok( !err, "No error requesting API" );
				test.ok( resp.statusCode == 200, "HTTP 200 from API" );
				test.ok( !!data, "Got data buffer" );
				test.ok( data.length > 0, "Data buffer has length" );
				test.ok( data.toString().match(/success/i), "Log buffer contains expected string" );
				
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

		function testLaunchJobStripsEventLaunchContext(test) {
			// make sure event/API payloads cannot override admin-only Plugin launch options
			var orig_launch_local_job = cronicle.launchLocalJob;
			var captured_job = null;
			
			storage.listFind( 'global/schedule', { id: this.event_id }, function(err, event) {
				test.ok( !err, "No error locating event in schedule" );
				test.ok( !!event, "Found event in schedule" );
				
				var job = Tools.copyHash( event, true );
				
				// These are intentionally hostile event-level overrides.  The
				// trusted Plugin record should be the only source for these fields.
				job.uid = 0;
				job.gid = 0;
				job.cwd = '/tmp';
				job.env = { PATH: '/tmp' };
				job.web_hook = '';
				
				cronicle.launchLocalJob = function(job) {
					captured_job = job;
				};
				
				cronicle.launchJob( job, function(err, jobs) {
					cronicle.launchLocalJob = orig_launch_local_job;
					
					test.ok( !err, "No error launching job" );
					test.ok( !!jobs, "Got array of launched jobs" );
					test.ok( jobs.length == 1, "Launched exactly one job" );
					test.ok( !!captured_job, "Captured local launch job" );
					test.ok( !('uid' in captured_job), "Event-level uid was stripped from job" );
					test.ok( !('gid' in captured_job), "Event-level gid was stripped from job" );
					test.ok( !('cwd' in captured_job), "Event-level cwd was stripped from job" );
					// don't check env, since this fork adding extra env values with base urls etc.
					// test.ok( !('env' in captured_job), "Event-level env was stripped from job" );
					
					test.done();
				} );
			} );
		},

		function testWindowsManagerDispatchesPluginRunAs(test) {
			var os = require('os');
			var job_module_path = require.resolve('./job.js');
			var cached_job_module = require.cache[job_module_path];
			var original_platform = os.platform;
			var WindowsJob = null;
			var fake_hostname = 'unit-test-unix-worker';
			var captured_job = null;

			try {
				os.platform = function() { return 'win32'; };
				delete require.cache[job_module_path];
				WindowsJob = require('./job.js');
			}
			finally {
				os.platform = original_platform;
				delete require.cache[job_module_path];
				if (cached_job_module) require.cache[job_module_path] = cached_job_module;
			}

			storage.listFind('global/schedule', { id: this.event_id }, function(err, event) {
				test.ok(!err && !!event, "Found event for Windows manager dispatch test");
				if (err || !event) return test.done();

				storage.listFind('global/plugins', { id: event.plugin }, function(err, plugin) {
					test.ok(!err && !!plugin, "Found Plugin for Windows manager dispatch test");
					if (err || !plugin) return test.done();

					var original_run_as = { uid: plugin.uid, gid: plugin.gid };
					storage.listFindUpdate('global/plugins', { id: plugin.id }, {
						uid: '65534',
						gid: '65533'
					}, function(err) {
						test.ok(!err, "Configured Plugin UID and GID fixture");
						if (err) return test.done();

						cronicle.workers[fake_hostname] = {
							hostname: fake_hostname,
							disabled: false,
							active_jobs: {},
							socket: {
								emit: function(action, job) {
									if (action == 'launch_job') captured_job = job;
								}
							}
						};

						var job = Tools.copyHash(event, true);
						job.target = fake_hostname;
						job.uid = 'event-user';
						job.gid = 'event-group';
						job.web_hook = '';

						WindowsJob.prototype.launchJob.call(cronicle, job, function(err, jobs) {
							delete cronicle.workers[fake_hostname];
							storage.listFindUpdate('global/plugins', { id: plugin.id }, original_run_as, function(restore_err) {
								test.ok(!restore_err, "Restored Plugin UID and GID fixture");
								test.ok(!err, "Windows manager dispatched the job");
								test.ok(jobs && jobs.length == 1, "Windows manager launched one remote job");
								test.ok(!!captured_job, "Captured the remote job payload");
								test.ok(captured_job && captured_job.uid == '65534', "Remote job uses the Plugin UID");
								test.ok(captured_job && captured_job.gid == '65533', "Remote job uses the Plugin GID");
								test.done();
							});
						});
					});
				});
			});
		},
		function testLaunchJobPassesOneShotDebugSudoToWorker(test) {
			var fake_hostname = 'unit-test-debug-worker';
			var captured_job = null;

			storage.listFind('global/schedule', { id: this.event_id }, function(err, event) {
				test.ok(!err && !!event, "Found event for debug_sudo dispatch test");
				if (err || !event) return test.done();

				cronicle.workers[fake_hostname] = {
					hostname: fake_hostname,
					disabled: false,
					active_jobs: {},
					socket: {
						emit: function(action, job) {
							if (action != 'launch_job') return;
							captured_job = job;
						}
					}
				};

				var job = Tools.copyHash(event, true);
				job.target = fake_hostname;
				job.debug_sudo = 1;
				job.web_hook = '';

				cronicle.launchJob(job, function(err, jobs) {
					delete cronicle.workers[fake_hostname];
					test.ok(!err, "Manager dispatched the debug_sudo job");
					test.ok(jobs && jobs.length == 1, "Manager launched one remote job");
					test.ok(captured_job && !('debug_sudo' in captured_job), "Remote job contains no debug_sudo marker");
					if (process.platform != 'win32') {
						test.ok(captured_job && captured_job.uid === process.getuid(), "Manager materialized its service UID for the worker");
					}
					test.done();
				}, { debug_sudo: true });
			});
		},

		function testCapacityQueueDropsOneShotDebugSudo(test) {
			var old_launch_job = cronicle.launchJob;
			var old_list_push = storage.listPush;
			var old_queue_count = cronicle.eventQueue.unit_debug_sudo_queue;
			var queued_event = null;
			var received_options = null;

			cronicle.launchJob = function(event, callback, launch_options) {
				received_options = launch_options;
				callback(new Error('Intentional capacity failure'));
			};
			storage.listPush = function(path, event, callback) {
				queued_event = event;
				callback();
			};

			cronicle.launchOrQueueJob({
				id: 'unit_debug_sudo_queue',
				queue: 1,
				queue_max: 1,
				debug_sudo: 1
			}, function(err, jobs) {
				cronicle.launchJob = old_launch_job;
				storage.listPush = old_list_push;
				if (typeof(old_queue_count) == 'undefined') delete cronicle.eventQueue.unit_debug_sudo_queue;
				else cronicle.eventQueue.unit_debug_sudo_queue = old_queue_count;

				test.ok(!err, "Capacity failure queued the event");
				test.ok(jobs && jobs.length == 0, "Queued event returned no launched jobs");
				test.ok(received_options && received_options.debug_sudo === true, "One-shot option reached the immediate launch attempt");
				test.ok(queued_event && !('debug_sudo' in queued_event), "Durable event queue contains no debug_sudo marker");
				test.done();
			}, { debug_sudo: true });
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
