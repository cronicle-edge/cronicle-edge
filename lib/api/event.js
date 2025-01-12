// Cronicle API Layer - Events
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const Class = require("pixl-class");
const Tools = require("pixl-tools");
const crypto = require('crypto');
const dotenv = require('dotenv')


module.exports = Class.create({

	//
	// Events:
	//

	api_get_schedule: function (args, callback) {
		// get list of scheduled events (with pagination)
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			self.storage.listGet('global/schedule', parseInt(params.offset || 0), parseInt(params.limit || 0), function (err, items, list) {
				if (err) {
					// no items found, not an error for this API
					return callback({ code: 0, rows: [], list: { length: 0 } });
				}

				// success, return keys and list header
				callback({ code: 0, rows: items, list: list });
			}); // got event list
		}); // loaded session
	},

	// safeJobLog(job) { // print less verbose, more readable job data on logging
	// 	if(!job) return ''
	// 	let excl = ["table", "secret", "env", "cat_secret", "plug_secret", "globalenv"]
	// 	return Object.keys(job).filter(e => ! excl.includes(e)).map(e => e + ': ' + ("params|workflow|perf".indexOf(e) > -1 ? JSON.stringify(job[e]) : job[e]) ).join(" | ")
	// },

	api_get_event: function (args, callback) {
		// get single event for editing
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		var criteria = {};
		if (params.id) criteria.id = params.id;
		else if (params.title) criteria.title = params.title;
		else return this.doError('event', "Failed to locate event: No criteria specified", callback);

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			self.storage.listFind('global/schedule', criteria, function (err, item) {
				if (err || !item) {
					return self.doError('event', "Failed to locate event: " + (params.id || params.title), callback);
				}

				// success, return event
				var resp = { code: 0, event: item };
				if (item.queue) resp.queue = self.eventQueue[item.id] || 0;

				// if event has any active jobs, include those as well
				var all_jobs = self.getAllActiveJobs(true);
				var event_jobs = [];
				for (var key in all_jobs) {
					var job = all_jobs[key];
					if (job.event == item.id) event_jobs.push(job);
				}
				if (event_jobs.length) resp.jobs = event_jobs;

				callback(resp);
			}); // got event
		}); // loaded session
	},

	api_create_event: function (args, callback) {
		// add new event
		var self = this;
		var event = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(event, {
			title: /\S/,
			enabled: /^(\d+|true|false)$/,
			category: /^\w+$/,
			target: /^[\w\-\.]+$/,
			plugin: /^\w+$/
		}, callback)) return;

		// validate optional event data parameters
		if (!this.requireValidEventData(event, callback)) return;

		this.loadSession(args, async function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "create_events", callback)) return;
			if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
			if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

			// check if event with same title or id already exist
			let alreadyExist = await self.validateUnique('global/schedule', event, ["id", "title"])
			if (alreadyExist > 0) {
				return self.doError('event', `Event with title "${event.title}" ${event.id ? "or id (" + event.id + ")" : ""} already exists`, callback);
			}

			args.user = user;
			args.session = session;

			if (event.id) event.id = event.id.toString().toLowerCase().replace(/\W+/g, '');
			if (!event.id) event.id = self.getUniqueID('e');

			event.created = event.modified = Tools.timeNow(true);

			if (!event.max_children) event.max_children = 0;
			if (!event.timeout) event.timeout = 0;
			if (!event.timezone) event.timezone = self.tz;
			if (!event.params) event.params = {};

			// set secret
			delete event.secret 
			if(event.secret_value && typeof event.secret_value === 'string') {
				event.secret_preview = Object.keys(dotenv.parse(event.secret_value)).join('|')
				event.secret = self.encryptObject(event.secret_value)				
			}
			delete event.secret_value

			if (user.key) {
				// API Key
				event.api_key = user.key;
			}
			else {
				event.username = user.username;
			}

			// make sure that only timing or interval exist, not both
			if (parseInt(event.interval) > 0) {
				event.timing = false
			}

			// validate category
			self.storage.listFind('global/categories', { id: event.category }, function (err, item) {
				if (err || !item) {
					return self.doError('event', "Failed to create event: Category not found: " + event.category, callback);
				}

				self.logDebug(6, "Creating new event: " + event.title, event);

				self.storage.listUnshift('global/schedule', event, function (err) {
					if (err) {
						return self.doError('event', "Failed to create event: " + err, callback);
					}

					self.logDebug(6, "Successfully created event: " + event.title, event);
					self.logTransaction('event_create', event.title, self.getClientInfo(args, { event: event }));
					self.logActivity('event_create', { event: event }, args);

					callback({ code: 0, id: event.id });

					// broadcast update to all websocket clients
					self.updateClientData('schedule');

					// create cursor for new event
					var now = Tools.normalizeTime(Tools.timeNow(), { sec: 0 });
					self.state.cursors[event.id] = now;

					// send new state data to all web clients
					self.authSocketEmit('update', { state: self.state });

				}); // list insert
			}); // find cat
		}); // load session
	},

	api_update_event: function (args, callback) {
		// update existing event
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		// validate optional event data parameters
		if (!this.requireValidEventData(params, callback)) return;

		this.loadSession(args, async function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
		        if (!self.requirePrivilege(user, "edit_events", callback)) return;
			if (params.abort_jobs && !self.requirePrivilege(user, "abort_events", callback)) return;

			args.user = user;
			args.session = session;

			self.storage.listFind('global/schedule', { id: params.id }, async function (err, event) {
				if (err || !event) {
					return self.doError('event', "Failed to locate event: " + params.id, callback);
				}

				// if updating title - check if it already exists
				if (event.title != params.title) {
					let titleExists = await self.validateUnique('global/schedule', params, ["title"])
					if (titleExists > 0) {
						return self.doError('event', `Event with title "${params.title}" already exists`, callback);
					}
				}

				var prevState = event.enabled

				// update secret
                delete params.secret 
				if(params.hasOwnProperty('secret_value')) { // if user edited secret in textbox
					if(params.secret_value && typeof params.secret_value === 'string') { // if set a value
						// size is a number of valid KV lines
						params.secret_preview = Object.keys(dotenv.parse(params.secret_value)).join('|')
						params.secret = self.encryptObject(params.secret_value)
						params.encrypted = true 
					}
					else { // otherwise unset secret
						params.secret = undefined
						params.secret_preview = undefined
					}
				} 
				delete params.secret_value

				// make sure that only timing or interval exist, not both
				if(parseInt(params.interval) > 0) {
					params.timing = false
				}
	
				// validate category
				self.storage.listFind('global/categories', { id: params.category || event.category }, function (err, item) {
					if (err || !item) {
						return self.doError('event', "Failed to update event: Category not found: " + params.category, callback);
					}

					if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
					if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

					params.modified = Tools.timeNow(true);

					self.logDebug(6, "Updating event: " + event.title, params);

					// pull cursor reset out of event object, for use later
					var new_cursor = 0;
					if (params.reset_cursor) {
						new_cursor = Tools.normalizeTime(params.reset_cursor - 60, { sec: 0 });
						delete params.reset_cursor;
					}

					// pull abort flag out of event object, for use later
					var abort_jobs = 0;
					if (params.abort_jobs) {
						abort_jobs = params.abort_jobs;
						delete params.abort_jobs;
					}

					self.storage.listFindUpdate('global/schedule', { id: params.id }, params, function (err) {
						if (err) {
							return self.doError('event', "Failed to update event: " + err, callback);
						}

						// merge params into event, just so we have the full updated record
						for (var key in params) event[key] = params[key];

						// optionally reset cursor
						if (new_cursor) {
							var dargs = Tools.getDateArgs(new_cursor);
							self.logDebug(6, "Resetting event cursor to: " + dargs.yyyy_mm_dd + ' ' + dargs.hh_mi_ss);
							self.state.cursors[params.id] = new_cursor;

							// send new state data to all web clients
							self.authSocketEmit('update', { state: self.state });
						}

						var changeType = "event_update"
						if (prevState != event.enabled) {
							changeType = event.enabled ? 'event_enabled' : 'event_disabled'
						}

						self.logDebug(6, "Successfully updated event: " + event.id + " (" + event.title + ")");
						self.logTransaction('event_update', event.title, self.getClientInfo(args, { event: params }));
						self.logActivity(changeType, { event: params }, args);

						// send response to web client
						callback({ code: 0 });

						// broadcast update to all websocket clients
						self.updateClientData('schedule');

						// if event is disabled, abort all applicable jobs
						if (!event.enabled && abort_jobs) {
							var all_jobs = self.getAllActiveJobs(true);
							for (var key in all_jobs) {
								var job = all_jobs[key];
								if ((job.event == event.id) && !job.detached) {
									var msg = "Event '" + event.title + "' has been disabled.";
									self.logDebug(4, "Job " + job.id + " is being aborted: " + msg);
									self.abortJob({ id: job.id, reason: msg });
								} // matches event
							} // foreach job
						} // event disabled

						// if this is a catch_up event and is being enabled, force scheduler to re-tick the minute
						var dargs = Tools.getDateArgs(new Date());
						if (params.enabled && event.catch_up && !self.schedulerGraceTimer && !self.schedulerTicking && (dargs.sec != 59)) {
							self.schedulerMinuteTick(null, true);
						}

						// check event queue
						if (self.eventQueue[event.id]) {
							if (event.queue) self.checkEventQueues(event.id);
							else self.deleteEventQueues(event.id);
						}
					}); // update event
				}); // find cat
			}); // find event
		}); // load session
	},

	api_delete_event: function (args, callback) {
		// delete existing event
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "delete_events", callback)) return;

			args.user = user;
			args.session = session;

			self.storage.listFind('global/schedule', { id: params.id }, function (err, event) {
				if (err || !event) {
					return self.doError('event', "Failed to locate event: " + params.id, callback);
				}

				if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

				// Do not allow deleting event if any active jobs
				var all_jobs = self.getAllActiveJobs(true);
				for (var key in all_jobs) {
					var job = all_jobs[key];
					if (job.event == params.id) {
						var err = "Still has running jobs";
						return self.doError('event', "Failed to delete event: " + err, callback);
					} // matches event
				} // foreach job

				self.logDebug(6, "Deleting event: " + params.id);

				self.storage.listFindDelete('global/schedule', { id: params.id }, function (err) {
					if (err) {
						return self.doError('event', "Failed to delete event: " + err, callback);
					}

					self.logDebug(6, "Successfully deleted event: " + event.title, event);
					self.logTransaction('event_delete', event.title, self.getClientInfo(args, { event: event }));
					self.logActivity('event_delete', { event: event }, args);

					callback({ code: 0 });

					// broadcast update to all websocket clients
					self.updateClientData('schedule');

					// schedule event's activity log to be deleted at next maint run
					self.storage.expire('logs/events/' + event.id, Tools.timeNow(true) + 86400);

					// delete state data
					delete self.state.cursors[event.id];
					if (self.state.robins) delete self.state.robins[event.id];
					if (self.state.jobCodes) delete self.state.jobCodes[event.id];
					if (self.state.jobMemos) delete self.state.jobMemos[ event.id ];

					// send new state data to all web clients
					self.authSocketEmit('update', { state: self.state });

					// check event queue
					if (self.eventQueue[event.id]) {
						self.deleteEventQueues(event.id);
					}

				}); // delete
			}); // listFind
		}); // load session
	},

	api_run_event: function (args, callback) {
		// run event manually (via "Run" button in UI or by API Key)
		// can include any event overrides in params (such as 'now')
		var self = this;
		if (!this.requiremanager(args, callback)) return;

		// default behavor: merge post params and query together
		// alt behavior (post_data): store post params into post_data
		var params = Tools.copyHash(args.query, true);
		if (args.query.post_data) params.post_data = args.params;
		else Tools.mergeHashInto(params, args.params);

		var criteria = {};
		if (params.id) criteria.id = params.id;
		else if (params.title) criteria.title = params.title;
		else return this.doError('event', "Failed to locate event: No criteria specified", callback);

		// validate optional event data parameters
		if (!this.requireValidEventData(params, callback)) return;

		this.loadSession(args, function (err, session, user) {

			if (!err) {
				if (!self.requireValidUser(session, user, callback)) return;
				if (!self.requirePrivilege(user, "run_events", callback)) return;

				args.user = user;
				args.session = session;
			}
			else if (params.token) {
				session = { type: "token", token: params.token }
				user = { token: params.token, username: params.id, active: true, privileges: { run_events: 1 } }
			}
			else {
				return self.doError('session', err.message, callback);
			}


			self.storage.listFind('global/schedule', criteria, function (err, event) {
				if (err || !event) {
					return self.doError('event', "Failed to locate event: " + (params.id || params.title), callback);
				}

				if (user.token) { // token auth
					if (!event.salt) return self.doError('event', 'token is disabled for this event', callback);
					let expectedToken = crypto.createHmac("sha1", `${self.server.config.get("secret_key")}`)
						.update(`${event.id + event.salt}`)
						.digest("hex");
					if (expectedToken != user.token) return self.doError('event', 'invalid token', callback);
				}

				if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

				delete params.id;
				delete params.title;
				delete params.catch_up;
				delete params.category;
				delete params.multiplex;
				delete params.stagger;
				delete params.detached;
				delete params.queue;
				delete params.queue_max;
				delete params.max_children;
				delete params.session_id;
				delete params.uid;
				delete params.secret;

				let privs = user.privileges || {}
				// only admin can set debug_sudo option
				if(!privs.admin) delete params.debug_sudo
				
				// allow for &params/foo=bar and the like
				for (var key in params) {
					if (key.match(/^(\w+)\/(\w+)$/)) {
						var parent_key = RegExp.$1;
						var sub_key = RegExp.$2;
						if (!params[parent_key]) params[parent_key] = {};
						params[parent_key][sub_key] = params[key];
						delete params[key];
					}
				}

				// allow sparsely populated event params in request
				if (params.params && event.params) {
					for (var key in event.params) {
						if (!(key in params.params)) params.params[key] = event.params[key];
					}
				}

				// only allow customize event params (like script in shell plug) to users with edit priv
				let canEdit = user.privileges.edit_events || user.privileges.create_events ||  user.privileges.admin
				if(!canEdit && params.params) {
					delete params.params;
				}

				var job = Tools.mergeHashes(Tools.copyHash(event, true), params);
				if (user.key) {
					// API Key
					job.source = "API Key (" + user.title + ")";
					job.api_key = user.key;
				}
				else if (user.token) {
					job.source = "Event Token";
					job.api_key = user.token;
				}
				else if (user.gitrepo) {
					job.source = `GitHub (${user.gitrepo})`;
					job.api_key = user.signature;
				}
				else if (user.workflow) {
					job.source = `Workflow (${user.workflow})`;
					job.api_key = user.signature;
				}
				else {
					job.source = "Manual (" + user.username + ")";
					job.username = user.username;
				}

				self.logDebug(6, "Running event manually: " + job.title, self.safeJobLog(job));

				self.launchOrQueueJob(job, function (err, jobs_launched) {
					if (err) {
						return self.doError('event', "Failed to launch event: " + err.message, callback);
					}

					// multiple jobs may have been launched (multiplex)
					var ids = [];
					for (var idx = 0, len = jobs_launched.length; idx < len; idx++) {
						var job = jobs_launched[idx];
						var stub = { id: job.id, event: job.event };
						self.logTransaction('job_run', job.event_title, self.getClientInfo(args, stub));
						if (self.server.config.get('track_manual_jobs')) self.logActivity('job_run', stub, args);
						ids.push(job.id);
					}

					var resp = { code: 0, ids: ids };
					if (!ids.length) resp.queue = self.eventQueue[event.id] || 1;
					callback(resp);
				}); // launch job
			}); // find event
		}); // load session
	},

	api_flush_event_queue: function (args, callback) {
		// flush event queue
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "abort_events", callback)) return;

			args.user = user;
			args.session = session;

			self.storage.listFind('global/schedule', { id: params.id }, function (err, event) {
				if (err || !event) {
					return self.doError('event', "Failed to locate event: " + params.id, callback);
				}

				if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

				self.deleteEventQueues(params.id, function () {
					callback({ code: 0 });
				});

			}); // listFind
		}); // loadSession
	},

	api_get_event_history: function (args, callback) {
		// get event history
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			args.user = user;
			args.session = session;

			self.storage.listFind('global/schedule', { id: params.id }, function (err, event) {
				if (err || !event) {
					return self.doError('event', "Failed to locate event: " + params.id, callback);
				}

				if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

				self.storage.listGet('logs/events/' + params.id, parseInt(params.offset || 0), parseInt(params.limit || 100), function (err, items, list) {
					if (err) {
						// no rows found, not an error for this API
						return callback({ code: 0, rows: [], list: { length: 0 } });
					}

					// success, return rows and list header
					callback({ code: 0, rows: items, list: list });

				}); // got data
			}); // listFind
		}); // load session
	},

	api_get_history: function (args, callback) {
		// get list of completed jobs for ALL events (with pagination)
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			// user may be limited to certain categories
			// but in order to keep pagination sane, just mask out IDs
			var privs = user.privileges;
			var cat_limited = (!privs.admin && privs.cat_limit);

			self.storage.listGet('logs/completed', parseInt(params.offset || 0), parseInt(params.limit || 50), function (err, items, list) {
				if (err) {
					// no rows found, not an error for this API
					return callback({ code: 0, rows: [], list: { length: 0 } });
				}

				// mask out IDs for cats that user shouldn't see
				if (cat_limited) items.forEach(function (item) {
					var priv_id = 'cat_' + item.category;
					if (!privs[priv_id]) item.id = '';
				});

				// success, return rows and list header
				callback({ code: 0, rows: items, list: list });
			}); // got data
		}); // loaded session
	},

	api_toggle_event: function(args, callback) {
		const self = this;
		const params = args.params;

		this.loadSession(args, (err, session, user) => {
			if (err) return self.doError("session", err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "disable_enable_events", callback)) return;

		        args.user = user;
			args.session = session;

			self.storage.listFind("global/schedule", { id: params.id }, (err, event) => {
				if (err || !event) {
					return self.doError("event", "Failed to locate event: " + params.id, callback);
				}
				// validate category
				self.storage.listFind('global/categories', { id: params.category || event.category }, function (err, item) {
					if (err || !item) {
						return self.doError('event', "Failed to update event: Category not found: " + params.category, callback);
					}

					if (!self.requireCategoryPrivilege(user, event.category, callback)) return;
					if (!self.requireGroupPrivilege(args, user, event.target, callback)) return;

					if (params.hasOwnProperty('enabled')) {
						event.enabled = params.enabled;
						self.storage.listFindUpdate("global/schedule", {id: params.id}, {enabled: params.enabled}, (err) => {
							if (err) {
								return self.doError("event", "Failed to update event: " + err, callback);
							}

							const changeType = params.enabled ? "event_enabled" : "event_disabled";
							self.logDebug(6, "Successfully updated event: " + event.id + " (" + event.title + ")");
							self.logTransaction(changeType, event.title, self.getClientInfo(args, {event: params}));
							self.logActivity(changeType, {event: params}, args);
							callback({code: 0});
							self.updateClientData("schedule");

							if (!event.enabled && params.abort_jobs) {
								const all_jobs = self.getAllActiveJobs(true);
								for (let key in all_jobs) {
									const job = all_jobs[key];
									if (job.event == event.id && !job.detached) {
										const msg = "Event '" + event.title + "' has been disabled.";
										self.logDebug(4, "Job " + job.id + " is being aborted: " + msg);
										self.abortJob({id: job.id, reason: msg});
									}
								}
							}

							const dargs = Tools.getDateArgs(new Date());
							if (params.enabled && event.catch_up && !self.schedulerGraceTimer && !self.schedulerTicking && dargs.sec != 59) {
								self.schedulerMinuteTick(null, true);
							}
							if (self.eventQueue[event.id]) {
								if (event.queue) self.checkEventQueues(event.id);
								else self.deleteEventQueues(event.id);
							}
						});
					} else {
						return self.doError("event", "No changes allowed except enabling/disabling", callback);
					}
				}); // find cat
			}); // find event
		}); // load session
	},

	api_get_errors: function (args, callback) {
		// api to filter history by error/argument
		
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			// user may be limited to certain categories
			// but in order to keep pagination sane, just mask out IDs
			var privs = user.privileges;
			var cat_limited = (!privs.admin && privs.cat_limit);

			let offset = parseInt(params.offset) || 0
			let limit = parseInt(params.limit) || 25
			let total = 0
			let max = params.max || 0
			let jobs = []
			let filter = { }
			if(params.id) filter.event = params.id
			if(params.arg) filter.arg = params.arg
			if(params.error) filter.has_error = true  // delete filter.has_error

			self.storage.listFindEach('logs/completed', filter, function (item, idx, cb) {
				if (err) {
					// no rows found, not an error for this API
					return callback({ code: 0, rows: [], list: { length: 0 }});
				}
                				
				if( total >= offset && total < offset + limit) { 
					if (cat_limited && !privs[('cat_' + item.category)]) item.id = ''; // mask category if user is limited
					jobs.push(item)
				}
				total += 1
				cb(max > 0 && total >= max) // on true search will stop

			}, () => {

				return callback({ code: 0, rows: jobs, list: { length: max > 0 ? (total < max ? total : max ) : total  }}) // total < limit ? total : max 

			});

		}); // loaded session
	}

});
