#!/usr/bin/env node

// CLI for Storage System
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var path = require('path');
var cp = require('child_process');
var os = require('os');
var fs = require('fs');
var async = require('async');
var bcrypt = require('bcrypt-node');
var dns = require('dns')

var Args = require('pixl-args');
var Tools = require('pixl-tools');
var StandaloneStorage = require('pixl-server-storage/standalone');

// chdir to the proper server root dir
process.chdir(path.dirname(__dirname));

// load app's config file
var config = require('../conf/config.json');

// check for storage config file
var storage_config = path.resolve(process.env['CRONICLE_storage_config'] || 'conf/storage.json');
if(fs.existsSync(storage_config)) {                                                                 
        config.Storage = require(storage_config)                                                    
}

// overwrite storage if sqlite option is specified
if(process.env['CRONICLE_sqlite']) {
	config.Storage = {
		"engine": "SQL",
		"list_page_size": 50,
		"concurrency": 4,
		"log_event_types": { "get": 1, "put": 1, "head": 1,	"delete": 1, "expire_set": 1 },
		"SQL": {
			"client": "sqlite3",
			"table": "cronicle",
			"useNullAsDefault": true,
			"connection": {
				"filename": process.env['CRONICLE_sqlite']
			}
		}
	}
}

// shift commands off beginning of arg array
var argv = JSON.parse(JSON.stringify(process.argv.slice(2)));
var commands = [];
while (argv.length && !argv[0].match(/^\-/)) {
	commands.push(argv.shift());
}

var cmd = commands.shift() || '';

// now parse rest of cmdline args, if any
var args = new Args(argv, {
	debug: false,
	verbose: false,
	quiet: false
});
args = args.get(); // simple hash

// copy debug flag into config (for standalone)
config.Storage.debug = args.debug;

// indicate that you want to enable engine level transaction
// to pack multiple crud operation in one transaction
// this is default for setup/migration, to avoid use --notrx argument
if(cmd == 'install' || cmd == 'setup') config.Storage.trans = true
if(args.notrx) config.Storage.trans = false

// disable storage transactions for CLI (this is storage level transaction)
config.Storage.transactions = false;

var print = function (msg) {
	// print message to console
	if (!args.quiet) process.stdout.write(msg);
};
var verbose = function (msg) {
	// print only in verbose mode
	if (args.verbose) print(msg);
};
var warn = function (msg) {
	// print to stderr unless quiet
	if (!args.quiet) process.stderr.write(msg);
};
var verbose_warn = function (msg) {
	// verbose print to stderr unless quiet
	if (args.verbose && !args.quiet) process.stderr.write(msg);
};

if (config.uid && (process.getuid() != 0)) {
	print("ERROR: Must be root to use this script.\n");
	process.exit(1);
}

// make sure cronicle isn't running (except for read-only commands)
if (!cmd.toString().match(/^(export|get|fetch|view|cat|list_get|list_info)$/)) {
	var is_running = false;
	var pid_file = config.log_dir + '/cronicled.pid';
	try {
		var pid = fs.readFileSync(pid_file, { encoding: 'utf8' });
		is_running = process.kill( pid, 0 );
	}
	catch (err) {;}
	if (is_running && !args.force) {
		print( "ERROR: Please stop Cronicle before running this script.\n" );
		process.exit(1);
	}
}

// determine server hostname
var hostname = (process.env['HOSTNAME'] || process.env['HOST'] || os.hostname()).toLowerCase();

// find the first external IPv4 address
var ip = '';
var ifaces = os.networkInterfaces();
var addrs = [];
for (var key in ifaces) {
	if (ifaces[key] && ifaces[key].length) {
		Array.from(ifaces[key]).forEach(function (item) { addrs.push(item); });
	}
}
var addr = Tools.findObject(addrs, { family: 'IPv4', internal: false });
if (addr && addr.address && addr.address.match(/^\d+\.\d+\.\d+\.\d+$/)) {
	ip = addr.address;
}
else {
	print("ERROR: Could not determine server's IP address.\n");
	process.exit(1);
}

// util.isArray is DEPRECATED??? Nooooooooode!
var isArray = Array.isArray || util.isArray;

// prevent logging transactions to STDOUT
config.Storage.log_event_types = {};

// allow APPNAME_key env vars to override config
var env_regex = new RegExp("^CRONICLE_(.+)$");
for (var env_key in process.env) {
	if (env_key.match(env_regex)) {
		var env_path = RegExp.$1.trim().replace(/^_+/, '').replace(/_+$/, '').replace(/__/g, '/');
		var env_value = process.env[env_key].toString();

		// massage value into various types
		if (env_value === 'true') env_value = true;
		else if (env_value === 'false') env_value = false;
		else if (env_value.match(/^\-?\d+$/)) env_value = parseInt(env_value);
		else if (env_value.match(/^\-?\d+\.\d+$/)) env_value = parseFloat(env_value);

		Tools.setPath(config, env_path, env_value);
	}
}

// helper function to resolve IPs for CRONICLE_cluster
const getIPsForHostnames = async (hostnames) => {
    const ipPromises = hostnames.map(hostname => {
        return new Promise((resolve, reject) => {
            dns.lookup(hostname.trim(), (err, ip) => {
                if (err) resolve({ hostname: hostname.trim(), ip: null });
				else resolve({ hostname: hostname.trim(), ip });
            });
        });
    });

    try {
        // Wait for all DNS lookups to finish
        const ips = await Promise.all(ipPromises);
        return ips;
    } catch (error) {
        console.error("Error fetching IP addresses:", error);
        return [];
    }
};

// construct standalone storage server
var storage = new StandaloneStorage(config.Storage, function (err) {
	if (err) throw err;
	// storage system is ready to go

	// become correct user
	if (config.uid && (process.getuid() == 0)) {
		verbose("Switching to user: " + config.uid + "\n");
		process.setuid(config.uid);
	}

	// custom job data expire handler
	storage.addRecordType('cronicle_job', {
		'delete': function (key, value, callback) {
			storage.delete(key, function (err) {
				storage.delete(key + '/log.txt.gz', function (err) {
					callback();
				}); // delete
			}); // delete
		}
	});

	// process command
	verbose("\n");

	switch (cmd) {
		case 'setup':
		case 'install':
			// setup new manager server
			var setup = require('../conf/setup.json');

			let minimal = (process.env['CRONICLE_setup'] === 'minimal')

			// make sure this is only run once
			// changing exit code to 0, so it won't break docker entry point
			storage.get('global/users', async function (err) {
				if (!err) {
					print("Storage has already been set up.  There is no need to run this command again.\n\n");
					process.exit(0);
				}

				if(process.env['CRONICLE_cluster']) {
					let servers = await getIPsForHostnames(process.env['CRONICLE_cluster'].split(','))
					servers.forEach(server =>{
						setup.storage.push(["listPush", "global/servers", server])
					})
				}

				async.eachSeries(setup.storage,
					function (params, callback) {
						verbose("Executing: " + JSON.stringify(params) + "\n");
						// [ "listCreate", "global/users", { "page_size": 100 } ]
						var func = params.shift();
						params.push(callback);

						let obj = {}

						// massage a few params
						if (typeof (params[1]) == 'object') {
							 obj = params[1];
							if (obj.created) obj.created = Tools.timeNow(true);
							if (obj.modified) obj.modified = Tools.timeNow(true);
							if (obj.regexp && (obj.regexp == '_HOSTNAME_')) obj.regexp = '^(' + Tools.escapeRegExp(hostname) + ')$';
							if (obj.hostname && (obj.hostname == '_HOSTNAME_')) obj.hostname = hostname;
							if (obj.ip && (obj.ip == '_IP_')) obj.ip = ip;
							//if (obj.optional) { verbose("skipping " + params[0]); return callback(); }
						}

						
						if(minimal && obj.optional) {
							// skip optional objects 
							callback()
						}
						else {
							// call storage directly
							storage[func].apply(storage, params);
						}

					},
					function (err) {
						if (err) throw err;
						print("\n");
						print("Setup completed successfully!\n");
						print("This server (" + hostname + ") has been added as the single primary manager server.\n");
						print("An administrator account has been created with username 'admin' and password 'admin'.\n");
						print("You should now be able to start the service by typing: '/opt/cronicle/bin/control.sh start'\n");
						print("Then, the web interface should be available at: http://" + hostname + ":" + config.WebServer.http_port + "/\n");
						print("Please allow for up to 60 seconds for the server to become manager.\n\n");

						storage.shutdown(function () { process.exit(0); });
					}
				);
			});
			break;

		case 'reset':

			let newGroup = { regexp: '^(' + Tools.escapeRegExp(hostname) + ')$' }

			storage.listFindUpdate('global/server_groups', { id: "maingrp" }, newGroup, function (err) {
				if (err) throw err;
				print(`Main group regex is set to [ ${newGroup.regexp} ]`);
				print("\n");

					storage.listFind("global/servers", { hostname: hostname }, function (err, item) {
						// already exist?
						if (item) {
							print(`${hostname} already exist in server list\n`);
							storage.shutdown(function () { process.exit(1); });
						}
						else {
							storage.listPush("global/servers", { hostname: hostname, ip: ip }, function (err) {
								if (err) throw err;
								print(`Added ${hostname} to server list (remove old servers from UI as needed)\n`);								
								storage.shutdown(function () { process.exit(0); });
							})
						}

					})

			});
			break;

		case 'admin':
			// create or replace admin account
			// Usage: ./storage-cli.js admin USERNAME PASSWORD [EMAIL]
			var username = commands.shift();
			var password = commands.shift();
			var email = commands.shift() || 'admin@localhost';
			if (!username || !password) {
				print("\nUsage: bin/storage-cli.js admin USERNAME PASSWORD [EMAIL]\n\n");
				process.exit(1);
			}
			if (!username.match(/^[\w\.\-]+@?[\w\.\-]+$/)) {
				print("\nERROR: Username must contain only alphanumerics, dash and period.\n\n");
				process.exit(1);
			}
			username = username.toLowerCase();

			var user = {
				username: username,
				password: password,
				full_name: "Administrator",
				email: email
			};

			user.active = 1;
			user.created = user.modified = Tools.timeNow(true);
			user.salt = Tools.generateUniqueID(64, user.username);
			user.password = bcrypt.hashSync(user.password + user.salt);
			user.privileges = { admin: 1 };

			storage.put('users/' + username, user, function (err) {
				if (err) throw err;
				print("\nAdministrator '" + username + "' created successfully.\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'get':
		case 'fetch':
		case 'view':
		case 'cat':
			// get storage key
			// Usage: ./storage-cli.js get users/jhuckaby
			var key = commands.shift();
			storage.get(key, function (err, data) {
				if (err) throw err;
				if (storage.isBinaryKey(key)) print(data.toString() + "\n");
				else print(((typeof (data) == 'object') ? JSON.stringify(data, null, "\t") : data) + "\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'put':
		case 'save':
		case 'store':
			// put storage key (read data from STDIN)
			// Usage: cat USER.json | ./storage-cli.js put users/jhuckaby
			var key = commands.shift();
			var json_raw = '';
			var rl = require('readline').createInterface({ input: process.stdin });
			rl.on('line', function (line) { json_raw += line; });
			rl.on('close', function () {
				print("Writing record from STDIN: " + key + "\n");

				var data = null;
				try { data = JSON.parse(json_raw); }
				catch (err) {
					warn("Failed to parse JSON for key: " + key + ": " + err + "\n");
					process.exit(1);
				}

				storage.put(key, data, function (err) {
					if (err) {
						warn("Failed to store record: " + key + ": " + err + "\n");
						process.exit(1);
					}
					print("Record successfully saved: " + key + "\n");

					storage.shutdown(function () { process.exit(0); });
				});
			});
			break;

		case 'edit':
		case 'vi':
			var key = commands.shift();

			if ((cmd == 'edit') && !process.env.EDITOR) {
				warn("No EDITOR environment variable is set.\n");
				process.exit(1);
			}

			storage.get(key, function (err, data) {
				if (err) data = {};
				print("Spawning editor to edit record: " + key + "\n");

				// save to local temp file
				var temp_file = path.join(os.tmpdir(), 'cli-temp-' + process.pid + '.json');
				fs.writeFileSync(temp_file, JSON.stringify(data, null, "\t") + "\n");
				var stats = fs.statSync(temp_file);
				var old_mod = Math.floor(stats.mtime.getTime() / 1000);

				// spawn vi but inherit terminal
				var child = cp.spawn((cmd == 'vi') ? 'vi' : process.env.EDITOR, [temp_file], {
					stdio: 'inherit'
				});
				child.on('exit', function (e, code) {
					var stats = fs.statSync(temp_file);
					var new_mod = Math.floor(stats.mtime.getTime() / 1000);
					if (new_mod != old_mod) {
						print("Saving new data back into record: " + key + "\n");

						var json_raw = fs.readFileSync(temp_file, { encoding: 'utf8' });
						fs.unlinkSync(temp_file);

						var data = JSON.parse(json_raw);

						storage.put(key, data, function (err, data) {
							if (err) throw err;
							print("Record successfully saved with your changes: " + key + "\n");

							storage.shutdown(function () { process.exit(0); });
						});
					}
					else {
						fs.unlinkSync(temp_file);
						print("File has not been changed, record was not touched: " + key + "\n");

						storage.shutdown(function () { process.exit(0); });
					}
				});

			}); // got data
			break;

		case 'delete':
			// delete storage key
			// Usage: ./storage-cli.js delete users/jhuckaby
			var key = commands.shift();
			storage.delete(key, function (err, data) {
				if (err) throw err;
				print("Record '" + key + "' deleted successfully.\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'list_create':
			// create new list
			// Usage: ./storage-cli.js list_create key
			var key = commands.shift();
			storage.listCreate(key, null, function (err) {
				if (err) throw err;
				print("List created successfully: " + key + "\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'list_pop':
			// pop item off end of list
			// Usage: ./storage-cli.js list_pop key
			var key = commands.shift();
			storage.listPop(key, function (err, item) {
				if (err) throw err;
				print("Item popped off list: " + key + ": " + JSON.stringify(item, null, "\t") + "\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'list_get':
			// fetch items from list
			// Usage: ./storage-cli.js list_get key idx len
			var key = commands.shift();
			var idx = parseInt(commands.shift() || 0);
			var len = parseInt(commands.shift() || 0);
			var compact = parseInt(commands.shift() || 0);
			storage.listGet(key, idx, len, function (err, items) {
				if (err) throw err;
				if (compact) {
					print(JSON.stringify(items))
				}
				else {
					print("Got " + items.length + " items.\n");
					print("Items from list: " + key + ": " + JSON.stringify(items, null, "\t") + "\n");
					print("\n");
				}

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'list_info':
			// fetch info about list
			// Usage: ./storage-cli.js list_info key
			var key = commands.shift();

			storage.listGetInfo(key, function (err, list) {
				if (err) throw err;
				print("List Header: " + key + ": " + JSON.stringify(list, null, "\t") + "\n\n");
				var page_idx = list.first_page;
				var item_idx = 0;
				async.whilst(
					function () { return page_idx <= list.last_page; },
					function (callback) {
						// load each page
						storage._listLoadPage(key, page_idx++, false, function (err, page) {
							if (err) return callback(err);
							print("Page " + Math.floor(page_idx - 1) + ": " + page.items.length + " items\n");
							callback();
						}); // page loaded
					},
					function (err) {
						// all pages iterated
						if (err) throw err;
						print("\n");

						storage.shutdown(function () { process.exit(0); });
					} // pages complete
				); // whilst
			});
			break;

		case 'list_delete':
			// delete list
			// Usage: ./storage-cli.js list_delete key
			var key = commands.shift();
			storage.listDelete(key, null, function (err) {
				if (err) throw err;
				print("List deleted successfully: " + key + "\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'maint':
		case 'maintenance':
			// perform daily maintenance, specify date or defaults to current day
			// Usage: ./storage-cli.js maint 2015-05-31
			storage.runMaintenance(commands.shift(), function () {
				print("Daily maintenance completed successfully.\n");
				print("\n");

				storage.shutdown(function () { process.exit(0); });
			});
			break;

		case 'export':
			// export all storage data (except completed jobs, sessions)
			var file = commands.shift();
			export_data(file);
			break;

		case 'import':
			// import storage data from file
			var file = commands.shift();
			import_data(file);
			break;

		default:
			print("Unknown command: " + cmd + "\n");
			storage.shutdown(function () { process.exit(0); });
			break;

	} // switch
});

function export_data(file) {
	// export data to file or stdout (except for completed jobs, logs, and sessions)
	// one record per line: KEY - JSON
	var stream = file ? fs.createWriteStream(file) : process.stdout;

	// file header (for humans)
	var file_header = "# Cronicle Data Export v1.0\n" +
		"# Hostname: " + hostname + "\n" +
		"# Date/Time: " + (new Date()).toString() + "\n" +
		"# Format: KEY - JSON\n\n";

	stream.write(file_header);
	verbose_warn(file_header);

	if (file) verbose_warn("Exporting to file: " + file + "\n\n");

	// need to handle users separately, as they're stored as a list + individual records
	storage.listEach('global/users',
		function (item, idx, callback) {
			var username = item.username;
			var key = 'users/' + username.toString().toLowerCase().replace(/\W+/g, '');
			verbose_warn("Exporting user: " + username + "\n");

			storage.get(key, function (err, user) {
				if (err) {
					// user deleted?
					warn("\nFailed to fetch user: " + key + ": " + err + "\n\n");
					return callback();
				}

				stream.write(key + ' - ' + JSON.stringify(user) + "\n", 'utf8', callback);
			}); // get
		},
		function (err) {
			// ignoring errors here
			// proceed to the rest of the lists
			async.eachSeries(
				[
					'global/users',
					'global/plugins',
					'global/categories',
					'global/server_groups',
					'global/schedule',
					'global/servers',
					'global/api_keys',
					'global/conf_keys'
				],
				function (list_key, callback) {
					// first get the list header
					verbose_warn("Exporting list: " + list_key + "\n");

					storage.get(list_key, function (err, list) {
						if (err) return callback(new Error("Failed to fetch list: " + list_key + ": " + err));

						stream.write(list_key + ' - ' + JSON.stringify(list) + "\n");

						// now iterate over all the list pages
						var page_idx = list.first_page;

						async.whilst(
							function () { return page_idx <= list.last_page; },
							function (callback) {
								// load each page
								var page_key = list_key + '/' + page_idx;
								page_idx++;

								verbose_warn("Exporting list page: " + page_key + "\n");

								storage.get(page_key, function (err, page) {
									if (err) return callback(new Error("Failed to fetch list page: " + page_key + ": " + err));

									// write page data
									stream.write(page_key + ' - ' + JSON.stringify(page) + "\n", 'utf8', callback);
								}); // page get
							}, // iterator
							callback
						); // whilst

					}); // get
				}, // iterator
				function (err) {
					if (err) {
						warn("\nEXPORT ERROR: " + err + "\n");
						process.exit(1);
					}

					verbose_warn("\nExport completed at " + (new Date()).toString() + ".\nExiting.\n\n");

					if (file) stream.end();

					storage.shutdown(function () { process.exit(0); });
				} // done done
			); // list eachSeries
		} // done with users
	); // users listEach
};

function import_data(file) {
	// import storage data from specified file or stdin
	// one record per line: KEY - JSON
	print("\nCronicle Data Importer v1.0\n");
	if (file) print("Importing from file: " + file + "\n");
	else print("Importing from STDIN\n");
	print("\n");

	var count = 0;
	var queue = async.queue(function (line, callback) {
		// process each line
		if (line.match(/^(\w[\w\-\.\/]*)\s+\-\s+(\{.+\})\s*$/)) {
			var key = RegExp.$1;
			var json_raw = RegExp.$2;
			print("Importing record: " + key + "\n");

			var data = null;
			try { data = JSON.parse(json_raw); }
			catch (err) {
				warn("Failed to parse JSON for key: " + key + ": " + err + "\n");
				return callback();
			}

			storage.put(key, data, function (err) {
				if (err) {
					warn("Failed to store record: " + key + ": " + err + "\n");
					return callback();
				}
				count++;
				callback();
			});
		}
		else callback();
	}, 1);

	// setup readline to line-read from file or stdin
	var readline = require('readline');
	var rl = readline.createInterface({
		input: file ? fs.createReadStream(file) : process.stdin
	});

	rl.on('line', function (line) {
		// enqueue each line
		queue.push(line);
	});

	rl.on('close', function () {
		// end of input stream
		var complete = function () {
			// finally, delete state so cronicle recreates it
			storage.delete('global/state', function (err) {
				// ignore error here, as state may not exist yet
				print("\nImport complete. " + count + " records imported.\nExiting.\n\n");
				storage.shutdown(function () { process.exit(0); });
			});
		};

		// fire complete on queue drain
		if (queue.idle()) complete();
		else queue.drain = complete;
	}); // rl close
};
