// Cronicle API Layer - Administrative
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var async = require('async');

var Class = require("pixl-class");
var Tools = require("pixl-tools");

const { Readable } = require("stream");

module.exports = Class.create({
	
	//
	// Servers / manager Control
	// 
	
	api_check_add_server: function(args, callback) {
		// check if it is okay to manually add this server to a remote cluster
		// (This is a server-to-server API, sent from manager to a potential remote worker)
		const self = this;
		let params = args.params;
		
		if (!this.requireParams(params, {
			manager: /\S/,
			now: /^\d+$/,
			token: /\S/
		}, callback)) return;
		
		if (params.token != Tools.digestHex( params.manager + params.now + this.server.config.get('secret_key') )) {
			return this.doError('server', "Secret keys do not match.  Please synchronize your config files.", callback);
		}
		if (this.multi.manager) {
			return this.doError('server', "Server is already a manager server, controlling its own cluster.", callback);
		}
		if (this.multi.managerHostname && (this.multi.managerHostname != params.manager)) {
			return this.doError('server', "Server is already a member of a cluster (manager: " + this.multi.managerHostname + ")", callback);
		}
		
		callback({ code: 0, hostname: this.server.hostname, ip: this.server.ip });
	},
	
	api_add_server: function(args, callback) {
		// add any arbitrary server to cluster (i.e. outside of UDP broadcast range)
		const self = this;
		let params = args.params;
		if (!this.requiremanager(args, callback)) return;
		
		if (!this.requireParams(params, {
			hostname: /\S/
		}, callback)) return;
		
		var hostname = params.hostname.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			args.user = user;
			args.session = session;
			
			// make sure server isn't already added
			if (self.workers[hostname]) {
				return self.doError('server', "Server is already in cluster: " + hostname, callback);
			}
			
			// send HTTP request to server, to make sure we can reach it
			var api_url = self.getServerBaseAPIURL( hostname ) + '/app/check_add_server';
			var now = Tools.timeNow(true);
			var api_args = {
				manager: self.server.hostname,
				now: now,
				token: Tools.digestHex( self.server.hostname + now + self.server.config.get('secret_key') )
			};
			self.logDebug(9, "Sending API request to remote server: " + api_url);
			
			// send request
			self.request.json( api_url, api_args, { timeout: 8 * 1000 }, function(err, resp, data) {
				if (err) {
					return self.doError('server', "Failed to contact server: " + err.message, callback );
				}
				if (resp.statusCode != 200) {
					return self.doError('server', "Failed to contact server: " + hostname + ": HTTP " + resp.statusCode + " " + resp.statusMessage, callback);
				}
				if (data.code != 0) {
					return self.doError('server', "Failed to add server to cluster: " + hostname + ": " + data.description, callback);
				}
				
				// replace user-entered hostname with one returned from server (check_add_server api response)
				// just in case user entered an IP, or some CNAME
				hostname = data.hostname;
				
				// re-check this, for sanity
				if (self.workers[hostname]) {
					return self.doError('server', "Server is already in cluster: " + hostname, callback);
				}
				
				// one more sanity check, with the IP this time
				for (var key in self.workers) {
					var worker = self.workers[key];
					if (worker.ip == data.ip) {
						return self.doError('server', "Server is already in cluster: " + hostname + " (" + data.ip + ")", callback);
					}
				}
				
				// okay to add
				var stub = { hostname: hostname, ip: data.ip };
				self.logDebug(4, "Adding remote worker server to cluster: " + hostname, stub);
				self.addServer(stub, args);
				
				// add to global/servers list
				self.storage.listFind( 'global/servers', { hostname: hostname }, function(err, item) {
					if (item) {
						// server is already in list, just ignore and go
						return callback({ code: 0 });
					}
					
					// okay to add
					self.storage.listPush( 'global/servers', stub, function(err) {
						if (err) {
							// should never happen
							self.logError('server', "Failed to add server to storage: " + hostname + ": " + err);
						}
						
						// success
						callback({ code: 0 });
					} ); // listPush
				} ); // listFind
			} ); // http request
		} ); // load session
	},
	
	api_remove_server: function(args, callback) {
		// remove any manually-added server from cluster
		const self = this;
		let params = args.params;
		if (!this.requiremanager(args, callback)) return;
		
		if (!this.requireParams(params, {
			hostname: /\S/
		}, callback)) return;
		
		var hostname = params.hostname.toLowerCase();
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			args.user = user;
			args.session = session;
			
			// do not allow removal of current manager
			if (hostname == self.server.hostname) {
				return self.doError('server', "Cannot remove current manager server: " + hostname, callback);
			}
			
			var worker = self.workers[hostname];
			if (!worker) {
				return self.doError('server', "Server not found in cluster: " + hostname, callback);
			}
			
			// Do not allow removing server if it has any active jobs
			var all_jobs = self.getAllActiveJobs(true);
			for (var key in all_jobs) {
				var job = all_jobs[key];
				if (job.hostname == hostname) {
					var err = "Still has running jobs";
					return self.doError('server', "Failed to remove server: " + err, callback);
				} // matches server
			} // foreach job
			
			// okay to remove
			self.logDebug(4, "Removing remote worker server from cluster: " + hostname);
			self.removeServer({ hostname: hostname }, args);
			
			// delete from global/servers list
			self.storage.listFindDelete( 'global/servers', { hostname: hostname }, function(err) {
				if (err) {
					// should never happen
					self.logError('server', "Failed to remove server from storage: " + hostname + ": " + err);
				}
				
				// success
				callback({ code: 0 });
			} ); // listFindDelete
		} ); // load session
	},
	
	api_restart_server: function(args, callback) {
		// restart any server in cluster
		const self = this;
		let params = args.params;
		if (!this.requiremanager(args, callback)) return;
		
		if (!this.requireParams(params, {
			hostname: /\S/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			args.user = user;
			args.session = session;
			
			self.logTransaction('server_restart', '', self.getClientInfo(args, params));
			self.normalShutdown = true;
			self.logActivity('server_restart', params, args);
			
			var reason = "User request by: " + user.username;
			
			if (params.hostname == self.server.hostname) {
				// restart this server
				self.restartLocalServer({ reason: reason });
				callback({ code: 0 });
			}
			else {
				// restart another server in the cluster
				var worker = self.workers[ params.hostname ];
				if (worker && worker.socket) {
					self.logDebug(6, "Sending remote restart command to: " + worker.hostname);
					worker.socket.emit( 'restart_server', { reason: reason } );
					callback({ code: 0 });
				}
				else {
					callback({ code: 1, description: "Could not locate server: " + params.hostname });
				}
			}
			
		} );
	},
	
	api_shutdown_server: function(args, callback) {
		// shutdown any server in cluster
		const self = this;
		let params = args.params;
		if (!this.requiremanager(args, callback)) return;
		
		if (!this.requireParams(params, {
			hostname: /\S/
		}, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			args.user = user;
			args.session = session;
			
			self.logTransaction('server_shutdown', '', self.getClientInfo(args, params));
			self.normalShutdown = true;
			self.logActivity('server_shutdown', params, args);
			
			var reason = "User request by: " + user.username;
			
			if (params.hostname == self.server.hostname) {
				// shutdown this server
				self.shutdownLocalServer({ reason: reason });
				callback({ code: 0 });
			}
			else {
				// shutdown another server in the cluster
				var worker = self.workers[ params.hostname ];
				if (worker && worker.socket) {
					self.logDebug(6, "Sending remote shutdown command to: " + worker.hostname);
					worker.socket.emit( 'shutdown_server', { reason: reason } );
					callback({ code: 0 });
				}
				else {
					callback({ code: 1, description: "Could not locate server: " + params.hostname });
				}
			}
			
		} );
	},
	
	api_update_manager_state: function(args, callback) {
		// update manager state (i.e. scheduler enabled)
		const self = this;
		let params = args.params;
		if (!this.requiremanager(args, callback)) return;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "state_update", callback)) return;
			
			args.user = user;
			args.session = session;
			
			// import params into state
			self.logDebug(4, "Updating manager state:", params);
			self.logTransaction('state_update', '', self.getClientInfo(args, params));
			self.logActivity('state_update', params, args);
			
			if (params.enabled) {
				// need to re-initialize schedule if being enabled
				var now = Tools.normalizeTime( Tools.timeNow(), { sec: 0 } );
				var cursors = self.state.cursors;
				
				self.storage.listGet( 'global/schedule', 0, 0, function(err, items) {
					// got all schedule items
					for (var idx = 0, len = items.length; idx < len; idx++) {
						var item = items[idx];
						
						// reset cursor to now if event is NOT set to catch up
						if (!item.catch_up) {
							cursors[ item.id ] = now;
						}
					} // foreach item
					
					// now it's safe to enable
					Tools.mergeHashInto( self.state, params );
					self.authSocketEmit( 'update', { state: self.state } );
				} ); // loaded schedule
			} // params.enabled
			else {
				// not enabling scheduler, so merge right away
				Tools.mergeHashInto( self.state, params );
				self.authSocketEmit( 'update', { state: self.state } );
			}
			
			callback({ code: 0 });
		} );
	},
	
	api_get_activity: function(args, callback) {
		// get rows from activity log (with pagination)
		const self = this;
		let params = args.params;
		
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			
			self.storage.listGet( 'logs/activity', parseInt(params.offset || 0), parseInt(params.limit || 50), function(err, items, list) {
				if (err) {
					// no rows found, not an error for this API
					return callback({ code: 0, rows: [], list: { length: 0 } });
				}
				
				// success, return rows and list header
				callback({ code: 0, rows: items, list: list });
			} ); // got data
		} ); // loaded session
	},

	// list current server config. used by Config Viewer page
	api_get_config: function(args, callback) {
		const self = this;
		this.loadSession(args, function(err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			let confCopy = JSON.parse(JSON.stringify(self.server.config.get()));
			delete confCopy.secret_key;
			if(confCopy.Storage.AWS) delete confCopy.Storage.AWS.secretAccessKey;
			callback({ code: 0, config: confCopy });
		}); 
	},

	api_export: function (args, callback) {
		const self = this;
		let params = args.params;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			if (!self.requiremanager(args, callback)) return;

			args.user = user;
			args.session = session;

			// file header (for humans)
			let txt = "# Cronicle Data Export v1.0\n" +
				"# Hostname: " + "local" + "\n" +
				"# Date/Time: " + (new Date()).toString() + "\n" +
				"# Format: KEY - JSON\n\n";

			// need to handle users separately, as they're stored as a list + individual records
			self.storage.listEach('global/users',
				function (item, idx, callback) {
					var username = item.username;
					var key = 'users/' + username.toString().toLowerCase().replace(/\W+/g, '');
					self.logDebug(6, "Exporting user: " + username + "\n");

					self.storage.get(key, function (err, user) {
						if (err) {
							// user deleted?
							// self.logDebug(6, "Failed to fetch user: " + key + ": " + err + "\n\n" );
							// return callback();
							return self.doError('schedule_export', "Failed to create event: " + err, callback);
						}

						txt += (key + ' - ' + JSON.stringify(user) + "\n")
						setTimeout(callback, 10);
					}); // get
				},
				function (err) {
					// ignoring errors here
					// proceed to the rest of the lists
					async.eachSeries(
						[
							'global/users',
							//'global/plugins',
							'global/categories',
							// 'global/server_groups', 
							'global/schedule',
							'global/servers',
							'global/api_keys',
							'global/conf_keys',
							'global/secrets'
						],
						function (list_key, callback) {
							// first get the list header
							self.logDebug(6, "Exporting list: " + list_key + "\n");

							self.storage.get(list_key, function (err, list) {
								//if (err) return callback(new Error("Failed to fetch list: " + list_key + ": " + err));
								if (err) return self.doError('schedule_export', "Failed to fetch list: " + list_key + ": " + err, callback);

								txt += list_key + ' - ' + JSON.stringify(list) + "\n";

								// now iterate over all the list pages
								var page_idx = list.first_page;

								async.whilst(
									function () { return page_idx <= list.last_page; },
									function (callback) {
										// load each page
										var page_key = list_key + '/' + page_idx;
										page_idx++;

										self.logDebug(6, "Exporting list page: " + page_key + "\n");

										self.storage.get(page_key, function (err, page) {
											if (err) return callback(new Error("Failed to fetch list page: " + page_key + ": " + err));
											txt += (page_key + ' - ' + JSON.stringify(page) + "\n");
											setTimeout(callback, 10);
										}); // page get
									}, // iterator
									callback
								); // whilst

							}); // get
						}, // iterator
						function (err) {
							if (err) {
								self.logActivity('backup_failure', params, args);
								self.logDebug(6, "Failed to export schedule", { status: 'failure' });
								callback({ code: 1, err: err.message });
							}

							self.logActivity('backup', params, args);
							self.logDebug(6, "Schedule exported successfully", { status: 'success' });
							//verbose_warn( "\nExport completed at " + (new Date()).toString() + ".\nExiting.\n\n" );
							callback({ code: 0, data: txt });

						} // done done
					); // list eachSeries
				} // done with users
			); // users listEach

		});
	},

	api_import: function (args, callback) {
		const self = this;
		// let params = args.params;
		var info = {
			events: 0,
			cats: 0,
			api: 0,
			conf: 0,
			users: 0,
			secrets: 0
		}

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;
			if (!self.requiremanager(args, callback)) return;

			args.user = user;
			args.session = session;

			var count = 0;
			var resultList = [];

			var queue = async.queue(function (line, callback) {
				// process each line
				if (line.match(/^(\w[\w\-\.\/]*)\s+\-\s+(\{.+\})\s*$/)) {
					var key = RegExp.$1;
					var json_raw = RegExp.$2;
					self.logDebug(6, "Schedule Import: Importing record: " + key + "\n");
					// print("Importing record: " + key + "\n");
			
					var data = null;
					try { data = JSON.parse(json_raw); }
					catch (err) {
						//	warn("Failed to parse JSON for key: " + key + ": " + err + "\n");
						self.logDebug(6, "Schedule Import: Failed to parse JSON for key: " + key + ": " + err + "\n");
						return callback();
					}

					// allow only specific key import along with users/username)
					// importing servers/plugins info or some arbitrary keys could mess up cronicle 
					var validKey = key.match(/^global\/(users|schedule|categories|api_keys|conf_keys|secrets)/g) ||  key.match(/^users\/([\w\.\@]+)$/g)
					if (!validKey) {
						self.logDebug(6, "Schedule Import: invalid key - " + key + "\n");
						resultList.push({key: key, code:2,  desc: "Not allowed (skip)"})
						return callback();
					}

					// count list items for statistics
					let cnt = Array.isArray(data.items) ? data.items.length : 0
					if(key.startsWith('global/schedule/')) info["events"] += cnt
					if(key.startsWith('global/categories/')) info["cats"] += cnt
					if(key.startsWith('global/users/')) info["users"] += cnt
					if(key.startsWith('global/api_keys/')) info["api"] += cnt
					if(key.startsWith('global/conf_keys/')) info["conf"] += cnt
					if(key.startsWith('global/secrets/')) info["secrets"] += cnt

					self.storage.put(key, data, function (err) {
						if (err) {
							// warn("Failed to store record: " + key + ": " + err + "\n");
							resultList.push({key: key, code:1,  desc: "Failed to import"})
							return callback();
						}
						count++;
						let itemCount = Array.isArray(data.items) ? data.items.length : '';
						resultList.push({ key: key, code: 0, desc: "Imported successfully", count: itemCount })
						if(key.startsWith('global/conf_keys/')) self.updateConfig()
						callback();
					});
				}
				else callback();
			}, 1);

			// setup readline to line-read from file or stdin
			var readline = require('readline');

			var rl = readline.createInterface({
				input: Readable.from([args.params.txt]) // backup string
			});

			rl.on('line', function (line) {
				// enqueue each line
				queue.push(line);
			});

			rl.on('close', function () {
				// end of input stream
				var complete = function (err) {
					// final step
					if (err) {
						callback({ code: 1, err: err.message })
						self.logActivity('restore_failure', {err: err.message}, args);
					}
					else {
						callback({ code: 0, result: resultList, count: count })
						self.authSocketEmit('update', { state: self.state });
						self.updateClientData('schedule'); //refresh event list
						self.updateClientData('categories'); // to refresh cat list
						self.updateSecrets(); 
						self.logActivity('restore', {info: info}, args);
					}

				};

				// fire complete on queue drain
				if (queue.idle()) complete();
				else queue.drain = complete;
			}); // rl close
		}); // seesion
	}

	
});
