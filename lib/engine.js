// Cronicle Server Component
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const assert = require("assert");
const fs = require("fs");
const async = require('async');
const glob = require('glob');
const jstz = require('jstimezonedetect');

const Class = require("pixl-class");
const Component = require("pixl-server/component");
const Tools = require("pixl-tools");
const Request = require("pixl-request");
const mkdirp = Tools.mkdirp;

const ld = require("lodash");
//const simpleGit = require('simple-git');
const util = require('util');
const cp = require('child_process');
const dotenv = require('dotenv');
const openssl = util.promisify(require('openssl-wrapper').exec);
const readline = require('readline');

const crypto = require("crypto");
const algorithm = "aes-256-ctr";
const inputEncoding = "utf8";
const outputEncoding = "base64";

module.exports = Class.create({

	__name: 'Cronicle',
	__parent: Component,
	__mixins: [
		require('./api.js'),       // API Layer Mixin
		require('./comm.js'),      // Communication Layer Mixin
		require('./scheduler.js'), // Scheduler Mixin
		require('./job.js'),       // Job Management Layer Mixin
		require('./queue.js'),     // Queue Layer Mixin
		require('./discovery.js')  // Discovery Layer Mixin
	],

	activeJobs: null,
	deadJobs: null,
	eventQueue: null,
	kids: null,
	state: null,
	secretCache: {},

	defaultWebHookTextTemplates: {
		"job_start": "Job started on [hostname]: [event_title] [job_details_url]",
		"job_complete": "Job completed successfully on [hostname]: [event_title] [job_details_url]",
		"job_failure": "Job failed on [hostname]: [event_title]: Error [code]: [description] [job_details_url]",
		"job_launch_failure": "Failed to launch scheduled event: [event_title]: [description] [edit_event_url]"
	},

	startup: function (callback) {
		// start cronicle service
		const self = this;
		this.logDebug(3, "Cronicle engine starting up");

		// create a few extra dirs we'll need
		try { mkdirp.sync(this.server.config.get('log_dir') + '/jobs'); }
		catch (e) {
			throw new Error("FATAL ERROR: Log directory could not be created: " + this.server.config.get('log_dir') + "/jobs: " + e);
		}
		try { mkdirp.sync(this.server.config.get('queue_dir')); }
		catch (e) {
			throw new Error("FATAL ERROR: Queue directory could not be created: " + this.server.config.get('queue_dir') + ": " + e);
		}

		// dirs should be writable by all users
		fs.chmodSync(this.server.config.get('log_dir') + '/jobs', "777");
		fs.chmodSync(this.server.config.get('queue_dir'), "777");

		// keep track of jobs
		this.activeJobs = {};
		this.deadJobs = {};
		this.eventQueue = {};
		this.kids = {};
		this.state = { enabled: true, cursors: {}, stats: {}, flagged_jobs: {} };
		this.normalShutdown = false;
		// this.secrets = {};
		this.eKey = crypto.scryptSync(this.server.config.get('secret_key'), '', 32),
		this.workflowKeys = new Map()
        this.winmonShuttingDown = false;
		


		// clear env from sensitive data
		delete process.env["CRONICLE_secret_key"];
		delete process.env["CRONICLE_oauth__client_secret"];
		delete process.env["CRONICLE_Storage__AWS__credentials__secretAccessKey"];
		delete process.env["CRONICLE_Storage__SQL__connection__password"];
		delete process.env["CRONICLE_Storage__Sftp__connection__password"];
		delete process.env["CRONICLE_Storage__Redis__password"];
		delete process.env["CRONICLE_Storage__RedisCluster__password"];

		// we'll need these components frequently
		this.storage = this.server.Storage;
		this.web = this.server.WebServer;
		this.api = this.server.API;
		this.usermgr = this.server.User;

		// register custom storage type for dual-metadata-log delete
		this.storage.addRecordType('cronicle_job', {
			'delete': this.deleteExpiredJobData.bind(this)
		});

		// multi-server cluster / failover system
		this.multi = {
			cluster: false,
			manager: false,
			worker: false,
			managerHostname: '',
			eligible: false,
			lastPingReceived: 0,
			lastPingSent: 0,
			data: {}
		};

		// construct http client for web hooks and uploading logs
		this.request = new Request("Cronicle " + this.server.__version);

		// register our class as an API namespace
		this.api.addNamespace("app", "api_", this);

		// intercept API requests to inject server groups
		// removing ^, see https://github.com/jhuckaby/pixl-server-web/issues/6
		this.web.addURIFilter(/\/api\/app\/\w+/, "API Filter", function (args, callback) {
			// load server groups for all API requests (these are cached in RAM)
			self.storage.listGet('global/server_groups', 0, 0, function (err, items) {
				args.server_groups = items;
				callback(false); // passthru
			});
		});

		let base_path = String(self.server.config.get('base_path') || '').trim()  // .replace(/\/+$/g, '')

		// If user specifies [valid] base_path config, adjust http/api routes, so cronicle can run on http://localhost:3012/custom

		if ((/^\/\w+$/i).test(base_path)) { /// expects /xxxx subpath

			self.logDebug(3, "Using custom sub path, cronicle will be served on:", base_path)

			this.web.addURIHandler('/', 'Welcome', function (args, callback) { // override root path to welcome page
				// custom request handler for our URI
				callback(
					"200 OK",
					{ 'Content-Type': "text/html" },
					`Welcome to Cronicle. Main app is located under ${self.server.config.get('base_path')}\n`
				);
			});
			
			this.web.addURIHandler(new RegExp(`^${base_path}/db$`, 'i'), 'Reports', 'htdocs/custom/dashboard.html')
			this.web.addURIHandler(new RegExp(`^${base_path}/console$`, 'i'), 'Console', 'htdocs/custom/console.html')

			this.web.addDirectoryHandler(base_path, "htdocs")
            
			// update base_uri for API component too. Should work without it locally, but needed for reverse proxies
			let api_uri = base_path + this.api.config.get('base_uri') // should be set to /api by default
			this.api.config.set('base_uri', api_uri)
		}
		else {	// Proceed old way if base_path is not specified or invalid
			if (base_path) self.logError(`Provided base path is not valid: ${base_path}. Expected format: /xxxxx, falling back to /`) // report invalid subpath
			this.web.addURIHandler(/^\/db$/i, 'Reports', 'htdocs/custom/dashboard.html')
			this.web.addURIHandler(/^\/console$/i, 'Console', 'htdocs/custom/console.html')
		}


		// register a handler for HTTP OPTIONS (for CORS AJAX preflight)
		this.web.addMethodHandler("OPTIONS", "CORS Preflight", this.corsPreflight.bind(this));

		// start socket.io server, attach to http/https
		this.startSocketListener();

		// start auto-discovery listener (UDP)
		this.setupDiscovery();

		// add uncaught exception handler
		require('uncatch').on('uncaughtException', this.emergencyShutdown.bind(this));

		// listen for ticks so we can broadcast status
		this.server.on('tick', this.tick.bind(this));

		// register hooks for when users are created / deleted
		this.usermgr.registerHook('after_create', this.afterUserChange.bind(this, 'user_create'));
		this.usermgr.registerHook('after_update', this.afterUserChange.bind(this, 'user_update'));
		this.usermgr.registerHook('after_delete', this.afterUserChange.bind(this, 'user_delete'));
		this.usermgr.registerHook('after_login', this.afterUserLogin.bind(this));

		// intercept user login and session resume, to merge in extra data
		this.usermgr.registerHook('before_login', this.beforeUserLogin.bind(this));
		this.usermgr.registerHook('before_resume_session', this.beforeUserLogin.bind(this));

		// monitor active jobs (for timeouts, etc.)
		this.server.on('minute', function () {
			// force gc 10s after the minute
			// (only if global.gc is exposed by node CLI arg)
			if (global.gc) {
				self.gcTimer = setTimeout(function () {
					delete self.gcTimer;
					self.logDebug(10, "Forcing garbage collection now", process.memoryUsage());
					global.gc();
					self.logDebug(10, "Garbage collection complete", process.memoryUsage());
				}, 10 * 1000);
			}
		});

		// archive logs daily at midnight
		this.server.on('day', function () {
			self.archiveLogs();
		});

		// determine manager server eligibility
		this.checkmanagerEligibility(function () {
			// manager mode (CLI option) -- force us to become manager right away
			if (self.server.config.get('manager') && self.multi.eligible) self.gomanager();

			// reset the failover counter
			self.multi.lastPingReceived = Tools.timeNow(true);

			// startup complete
			callback();
		});

		this.updateConfig()

		if (process.platform == 'win32') {
			// if running cronicle as windows service (using node-windows)
			// need to handle "shutdown" message as SIGTERM
			process.on('message', function (message) {
				if (message = 'shutdown') {
					self.logDebug(2, "Caught shutdown message");
					self.server.shutdown(() => {
						self.logDebug(2, "Exiting main process");
						process.exit()
					});
				}
			});
			// this is handled in pixl-server 1.0.40:
			// process.on('SIGHUP', ()=> {process.emit('SIGTERM')}) 

			// start windows event monitor to detect system restart
			if(self.server.config.get('winmon')) this.monitorWindowsEvents()
		}

	},

	updateConfig() {
		// load configs from storage (master only)
		let self = this

		this.storage.listGet('global/conf_keys', 0, 0, function (err, items, list) {
			if (err) {
				// no keys found, do nothing
			}
			if (items) { // items only would exist on master 
				for (let i = 0; i < items.length; i++) {
					if (items[i].key === 'false') items[i].key = false
					if (items[i].title) ld.set(self.server.config.get(), items[i].title, items[i].key)
				}
				self.logDebug(6, "config keys reloaded")
			}
		});


	},

	decrypt: async function (message) {
		let encOpts = { inform: 'PEM', inkey: this.server.config.get('cms_key') || process.env['CMS_KEY'] || '/run/secrets/cronicle.key' }
		return openssl('cms.decrypt', Buffer.from(message), encOpts)
	},

	encrypt: async function (cipher) {
		let encOpts = { outform: 'PEM', recip: this.server.config.get('cms_key') || process.env['CMS_KEY'] || '/run/secrets/cronicle.key' }
		return openssl('cms.encrypt', Buffer.from(cipher), encOpts);
	},


	encryptObject: function (obj) {
		const IV = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv(algorithm, this.eKey, IV);
		let crypted = cipher.update(JSON.stringify(obj), inputEncoding, outputEncoding);
		crypted += cipher.final(outputEncoding);
		return `${IV.toString(outputEncoding)}:${crypted}`;
	},

	decryptObject: function (encObj) {
		if(this.server.config.get('cache_secrets')) {
			let cached = this.secretCache[encObj.substring(0,40)]			
			if(cached) {
				this.logDebug(9, 'Secret fetched from cache')
				return cached;			
			}
		}
		const encParts = encObj.split(":");
		const IV = Buffer.from(encParts[0], outputEncoding);
		const encryptedText = Buffer.from(encParts[1], outputEncoding);
		const decipher = crypto.createDecipheriv(algorithm, this.eKey, IV);
		let decrypted = decipher.update(encryptedText, outputEncoding, inputEncoding);
		decrypted += decipher.final(inputEncoding);
		let plain = JSON.parse(decrypted);
		if(this.server.config.get('cache_secrets')) {
			this.secretCache[encObj.substring(0,40)] = plain; // put into cache
			this.logDebug(9, 'Secret put to cache')
		}
		return plain;
	},

	safeJobLog: function(job) { // print less verbose, more readable job data on logging
		if(!job) return ''
		let excl = ["table", "secret", "env", "cat_secret", "plug_secret", "globalenv"]
		return Object.keys(job).filter(e => ! excl.includes(e)).map(e => e + ': ' + ("params|workflow|perf".indexOf(e) > -1 ? JSON.stringify(job[e]) : job[e]) ).join(" | ")
	},

	// updateSecrets: function () { // cache secret data in memory
	// 	const self = this;
	// 	this.storage.listGet('global/secrets', 0, 0, async function (err, items, list) {
	// 		if (err) {
	// 			// do nothing
	// 		}
	// 		if (items) { // 
	// 			self.secrets = {}; // override secrets
	// 			for (let i = 0; i < items.length; i++) {
	// 				let secret = JSON.parse(JSON.stringify(items[i]));
	// 				try {
	// 					//if(secret.encrypted) secret.data = await self.decrypt(secret.data)
	// 					if (secret.encrypted) secret.data = self.decryptObject(secret.data)
	// 					if (secret.form == 'props' || secret.id == 'globalenv') secret.data = dotenv.parse(secret.data);
	// 					//if(secret.form == 'json') secret.data = JSON.parse(secret.data);					

	// 				}
	// 				catch (err) {
	// 					secret.error = err;
	// 					secret.data = {};
	// 					self.logDebug(6, "Failed to decrypt or parse secret " + secret.id, err);
	// 				}

	// 				self.secrets[secret.id] = secret;
	// 				self.logDebug(6, "secrets reloaded")

	// 			}
	// 		}
	// 	});
	// },


	checkmanagerEligibility: function (callback) {
		// determine manager server eligibility
		const self = this;

		this.storage.listGet('global/servers', 0, 0, function (err, servers) {
			if (err) {
				// this may happen on worker servers that have no access to storage -- silently fail
				servers = [];
			}

			if (!Tools.findObject(servers, { hostname: self.server.hostname }) && !self.multi.cluster) {
				// we were not found in server list
				self.multi.eligible = false;
				if (!self.multi.worker) {
					self.logDebug(4, "Server not found in cluster -- waiting for a manager server to contact us");
				}
				if (callback) callback();
				return;
			}

			// found server in cluster, good
			self.multi.cluster = true;

			// now check server groups
			self.storage.listGet('global/server_groups', 0, 0, function (err, groups) {
				if (err) {
					// this may happen on worker servers that have no access to storage -- silently fail
					groups = [];
				}

				// scan all manager groups for our hostname
				var eligible = false;
				var group_title = '';

				for (var idx = 0, len = groups.length; idx < len; idx++) {
					var group = groups[idx];

					var regexp = null;
					try { regexp = new RegExp(group.regexp); }
					catch (e) {
						self.logError('manager', "Invalid group regular expression: " + group.regexp + ": " + e);
						regexp = null;
					}

					if (group.manager && regexp && self.server.hostname.match(regexp)) {
						eligible = true;
						group_title = group.title;
						idx = len;
					}
				}

				if (eligible) {
					self.logDebug(4, "Server is eligible to become manager (" + group_title + ")");
					self.multi.eligible = true;
				}
				else {
					self.logDebug(4, "Server is not eligible for manager -- it will be a worker only");
					self.multi.eligible = false;
				}

				if (callback) callback();

			}); // global/server_groups
		}); // global/servers
	},

	tick: function () {
		// called every second
		const self = this;
		this.lastTick = Tools.timeNow();
		var now = Math.floor(this.lastTick);

		if (this.numSocketClients) {
			var status = {
				epoch: Tools.timeNow(),
				manager: this.multi.manager,
				manager_hostname: this.multi.managerHostname
			};
			if (this.multi.manager) {
				// web client connection to manager
				// send additional information only needed by UI

				// remove .params property from active job (it may contain key info)
				let activeJobs = JSON.parse(JSON.stringify(this.getAllActiveJobs(true)));
				for (let id in activeJobs) { delete activeJobs[id].params }
				status.active_jobs = activeJobs;
				status.servers = this.getAllServers();
			}
			else {
				// we are a worker, so just send our own jobs and misc server health stats
				status.active_jobs = this.activeJobs;
				status.queue = this.internalQueue || {};
				status.data = this.multi.data;
				status.uptime = now - (this.server.started || now);
				status.nodev = process.version;
				status.engine = this.storage.config.get('engine') || 'unknown'
				status.pid = process.pid;
			}

			// this.io.emit( 'status', status );
			this.authSocketEmit('status', status);
		}

		// monitor manager health
		if (!this.multi.manager) {
			var delta = now - this.multi.lastPingReceived;
			if (delta >= this.server.config.get('manager_ping_timeout')) {
				if (this.multi.eligible) this.managerFailover();
				else if (this.multi.worker) this.workerFailover();
			}
		}

		// as manager, broadcast pings every N seconds
		if (this.multi.manager) {
			var delta = now - this.multi.lastPingSent;
			if (delta >= this.server.config.get('manager_ping_freq')) {
				this.sendmanagerPings();
				this.multi.lastPingSent = now;
			}
		}

		// monitor server resources every N seconds (or 1 min if no local jobs)
		var msr_freq = Tools.numKeys(this.activeJobs) ? (this.server.config.get('monitor_res_freq') || 10) : 60;
		if (!this.lastMSR || (now - this.lastMSR >= msr_freq)) {
			this.lastMSR = now;

			this.monitorServerResources(function (err) {
				// nicer to do this after gathering server resources
				self.monitorAllActiveJobs();
			});
		}

		// auto-discovery broadcast pings
		this.discoveryTick();
	},

	authSocketEmit: function (key, data) {
		// Only emit to authenticated clients
		for (var id in this.sockets) {
			var socket = this.sockets[id];
			if (socket._pixl_auth) socket.emit(key, data);
		}
	},

	managerSocketEmit: function () {
		// Only emit to manager server -- and make sure this succeeds
		// Internally queue upon failure
		var count = 0;
		var key = '';
		var data = null;

		if (arguments.length == 2) {
			key = arguments[0];
			data = arguments[1];
		}
		else if (arguments.length == 1) {
			key = arguments[0].key;
			data = arguments[0].data;
		}

		for (var id in this.sockets) {
			var socket = this.sockets[id];
			if (socket._pixl_manager) {
				socket.emit(key, data);
				count++;
			}
		}

		if (!count) {
			// enqueue this for retry
			this.logDebug(8, "No manager server socket connection available, will retry");
			this.enqueueInternal({
				action: 'managerSocketEmit',
				key: key,
				data: data,
				when: Tools.timeNow(true) + 10
			});
		}
	},

	updateClientData: function (name) {
		// broadcast global list update to all clients
		// name should be one of: plugins, categories, server_groups, schedule
		assert(name != 'users');

		const self = this;
		this.storage.listGet('global/' + name, 0, 0, function (err, items) {
			if (err) {
				self.logError('storage', "Failed to fetch list: global/" + name + ": " + err);
				return;
			}

			let itemCopy = JSON.parse(JSON.stringify(items)) // make a copy to avoid side effects
			// clear secret info
			if (name == 'plugins' || name == 'schedule') { 
				itemCopy.forEach(obj => delete obj.secret)
			}
		    if (name == 'secrets') {
				itemCopy.forEach(obj => delete obj.data)
			}	


			var data = {};
			data[name] = itemCopy;
			// self.io.emit( 'update', data );
			self.authSocketEmit('update', data);
		});
	},

	beforeUserLogin: function (args, callback) {
		// infuse data into user login client response
		const self = this;

		// remove .params property from active job (it may contain key info)
		let activeJobs = JSON.parse(JSON.stringify(this.getAllActiveJobs(true)));
		for (let id in activeJobs) { delete activeJobs[id].params }

		args.resp = {
			epoch: Tools.timeNow(),
			servers: this.getAllServers(),
			nearby: this.nearbyServers,
			activeJobs: activeJobs,
			eventQueue: this.eventQueue,
			state: this.state
		};

		// load essential data lists in parallel (these are, or will be, cached in RAM)
		async.each(['schedule', 'categories', 'plugins', 'secrets', 'server_groups'],
			function (name, callback) {
				self.storage.listGet('global/' + name, 0, 0, function (err, items) {

					let itemCopy = JSON.parse(JSON.stringify(items)) // make a copy to avoid side effects
					if (name == 'plugins' || name == 'schedule') { // clear out secrets
						if (Array.isArray(itemCopy)) itemCopy.forEach(obj => delete obj.secret)
					}
					if (name == 'secrets') {
						itemCopy.forEach(obj => delete obj.data)
					}	
					args.resp[name] = itemCopy || [];
					callback();
				});
			},
			callback
		); // each
	},

	afterUserLogin: function (args) {
		// log the login
		this.logActivity('user_login', {
			user: Tools.copyHashRemoveKeys(args.user, { password: 1, salt: 1 })
		}, args);
	},

	afterUserChange: function (action, args) {
		// user data has changed, notify all connected clients
		// Note: user data is not actually sent here -- this just triggers a client redraw if on the user list page
		// this.io.emit( 'update', { users: {} } );
		this.authSocketEmit('update', { users: {} });

		// add to activity log in the background
		this.logActivity(action, {
			user: Tools.copyHashRemoveKeys(args.user, { password: 1, salt: 1 })
		}, args);
	},

	// gitSync: async function (message, callback) {

	// 	let self = this;

	// 	if (self.gitlock) return callback(new Error("Git Sync Failed: sync is locked by another process"), null);
	// 	self.gitlock = 1;

	// 	let gitConf = self.server.config.get('git');
	// 	let isRepo = await self.git.checkIsRepo();

	// 	if (!self.git || !gitConf.enabled || !isRepo) return callback(new Error("Git Sync: git is not set or enabled"), null);

	// 	let gitAdd = (gitConf.add || 'global,users').split(/[,;|]/).map(e => e.trim()).filter(e => e.match(/^[\w.]+$/g));
	// 	if (gitAdd.length === 0) gitAdd = ["global", "users"];

	// 	if (gitConf.add) gitAdd = gitConf.add.toString().split(',')

	// 	self.git
	// 		.env("GIT_AUTHOR_NAME", gitConf.user || "cronicle")
	// 		.env("GIT_COMMITER_NAME", gitConf.user || "cronicle")
	// 		.env("EMAIL", gitConf.email || "cronicle@cronicle.com")
	// 		.add(gitAdd)
	// 		.commit(message || `update as of ${(new Date).toLocaleString()}`)
	// 		.push(gitConf.remote || 'origin', gitConf.branch || 'master')
	// 		.exec(result => {
	// 			self.gitlock = 0;
	// 			callback(null, result);
	// 		})
	// 		.catch(err => {
	// 			self.gitlock = 0;
	// 			callback(err, null)
	// 		})

	// },

	fireInfoHook: function (web_hook, data, logMessage) {

		let self = this;
		let wh_config;

		logMessage = logMessage || 'Firing Info Web Hook'

		if (typeof web_hook === 'string') {
			wh_config = { url: web_hook }
		}
		else if (typeof web_hook === 'object') {
			wh_config = Tools.mergeHashes(web_hook, {});
			if (typeof wh_config.url !== 'string') wh_config.url = "";

		} else {
			return self.logDebug(9, "Web Hook Error: Invaid data type (string or object expected");
		}
		// combine global and hook specific options (if specified)
		let wh_options = Tools.mergeHashes(self.server.config.get('web_hook_custom_opts') || {}, wh_config.options || {})

		let wh_data = Tools.mergeHashes(data || {}, wh_config.data || {}) // 

		// oauth helper
		let wh_headers = wh_config.headers || {}
		if (wh_config.token) wh_headers['Authorization'] = 'Bearer ' + wh_config.token;

		// if specified, copy text property to some other property
		if (wh_config.textkey) ld.set(wh_data, wh_config.textkey, wh_data.text)

		//wh_options.data = wh_data;
		wh_options.headers = wh_headers;

		self.logDebug(9, logMessage);
		self.request.json(wh_config.url, wh_data, wh_options, function (err, resp, data) {
			// log response
			if (err) self.logDebug(9, "Web Hook Error: " + wh_config.url + ": " + err);
			else self.logDebug(9, "Web Hook Response: " + wh_config.url + ": HTTP " + resp.statusCode + " " + resp.statusMessage);
		});

	},

	logActivity: function (action, orig_data, args) {
		// add event to activity logs async
		const self = this;
		if (!args) args = {};

		assert(Tools.isaHash(orig_data), "Must pass a data object to logActivity");
		var data = Tools.copyHash(orig_data, true);

		// sanity check: make sure we are still manager
		if (!this.multi.manager) return;

		data.action = action;
		data.epoch = Tools.timeNow(true);

		if (args.ip) data.ip = args.ip;
		if (args.request) data.headers = args.request.headers;

		if (args.admin_user) data.username = args.admin_user.username;
		else if (args.user) {
			if (args.user.key) {
				// API Key
				data.api_key = args.user.key;
				data.api_title = args.user.title;
			}
			else {
				data.username = args.user.username;
			}
		}

		this.storage.enqueue(function (task, callback) {
			self.storage.listUnshift('logs/activity', data, callback);
		});

		let adminHook = this.server.config.get('admin_web_hook');
		let onUpdateHook = this.server.config.get('onupdate_web_hook');
		let onInfoHook = this.server.config.get('oninfo_web_hook');

		//let gitConf = self.server.config.get('git')

		let msg = 'ℹ️ ' + action
		let baseUrl = this.server.config.get('base_app_url');
		let actionType = ''
		let item = '';

		let kt_map = {
			'application/json': '[JSON]',
			'text/xml': '[XML]',
			'text/x-sql': '[SQL]',
			'text/plain': '[TEXT]'
		}

		let conf_key_val = data.conf_key ? (kt_map[data.conf_key.type] || data.conf_key.key) : '';

		let modBy = '';
		if (data.username || data.ip) modBy = `\n    _${data.username}@${data.ip} - ${(new Date()).toLocaleTimeString()}_`

		try {

			switch (action) {

				// categories
				case 'cat_create':
					msg = `📁 New category created: *${data.cat.title}* `;
					actionType = 'update';
					item = data.cat.title;
					break;
				case 'cat_update':
					msg = `📁 New category updated: *${data.cat.title}* `;
					actionType = 'update';
					item = data.cat.title;
					break;
				case 'cat_delete':
					msg = `📁 New category deleted: *${data.cat.title}* `;
					actionType = 'update';
					item = data.cat.title;
					break;

				// groups
				case 'group_create':
					msg = `🖥️ Server group created: *${data.group.title}* `
					actionType = 'update';
					item = data.group.title;
					break;
				case 'group_update':
					msg = `🖥️ Server group updated: *${data.group.title}* `;
					actionType = 'update';
					item = data.group.title;
					break;
				case 'group_delete':
					msg = `🖥️ Server group deleted: *${data.group.title}* `;
					actionType = 'update';
					item = data.group.title;
					break;

				// plugins
				case 'plugin_create':
					msg = `🔌 Plugin created: *${data.plugin.title}* `;
					actionType = 'update';
					item = data.plugin.title;
					break;
				case 'plugin_update':
					msg = `🔌 Plugin updated: *${data.plugin.title}* `;
					actionType = 'update';
					item = data.plugin.title;
					break;
				case 'plugin_delete':
					msg = `🔌 Plugin deleted: *${data.plugin.title}* `;
					actionType = 'update';
					item = data.plugin.title;
					break;

				// api keys
				case 'apikey_create':
					msg = `🔑 New API Key created: *${data.api_key.title}* ${('' + data.api_key.key).substr(0, 4) + '******'} `;
					actionType = 'update';
					item = data.api_key.title;
					break;
				case 'apikey_update':
					msg = `🔑 API Key updated: *${data.api_key.title}*  ${('' + data.api_key.key).substr(0, 4) + '******'} `;
					actionType = 'update';
					item = data.api_key.title;
					break;
				case 'apikey_delete':
					msg = `🔑 API Key deleted: *${data.api_key.title}*  ${('' + data.api_key.key).substr(0, 4) + '******'} `;
					actionType = 'update';
					item = data.api_key.title;
					break;

				// secrets
				case 'secret_create':
					msg = `🔒 New Secret created: *${data.id}* (encrypted: ${data.encrypted}) `;
					actionType = 'update';
					item = data.secret.id;
					break;
				case 'secret_update':
					msg = `🔒 Secret updated: *${data.secret}*  (encrypted: ${data.encrypted}) `;
					actionType = 'update';
					item = data.secret.id;
					break;
				case 'secret_delete':
					msg = `🔒 Secret deleted: *${data.secret}* `;
					actionType = 'update';
					item = data.secret;
					break;

				// conf keys
				case 'confkey_create':
					msg = `🔧 Config Key created: *${data.conf_key.title}* : ${conf_key_val} `;
					actionType = 'update';
					item = data.conf_key.title;
					break;
				case 'confkey_update':
					msg = `🔧 Config Key updated: *${data.conf_key.title}* : ${conf_key_val} `;
					actionType = 'update';
					item = data.conf_key.title;
					break;
				case 'confkey_delete':
					msg = `🔧 Config Key deleted: *${data.conf_key.title}* : ${conf_key_val} `;
					actionType = 'update';
					item = data.conf_key.title;
					break;


				// events
				case 'event_create':
					msg = `🕘 New event added: *${data.event.title}* `;
					msg += `<${baseUrl}/#Schedule?sub=edit_event&id=${data.event.id} | Edit Event > `;
					item = data.event.title;
					actionType = 'update';
					break;
				case 'event_update':
					msg = `🕘 Event updated: *${data.event.title}* `;
					msg += `<${baseUrl}/#Schedule?sub=edit_event&id=${data.event.id} | Edit Event > `;
					actionType = 'update';
					item = data.event.title;
					break;
				case 'event_delete':
					msg = `🕘 Event deleted: *${data.event.title}*  `;
					actionType = 'update';
					item = data.event.title;
					break;
				case 'event_enabled':
					msg = `ℹ️ Event *${data.event.title}* was enabled `;
					msg += `<${baseUrl}/#Schedule?sub=edit_event&id=${data.event.id} | Edit Event > `;
					actionType = 'update';
					item = data.event.title;
					break;
				case 'event_disabled':
					msg = `ℹ️ Event *${data.event.title}* was disabled `;
					msg += `<${baseUrl}/#Schedule?sub=edit_event&id=${data.event.id} | Edit Event > `;
					actionType = 'update';
					item = data.event.title;
					break;

				// users
				case 'user_create':
					msg = `👤 New user account created: *${data.user.username}* (${data.user.full_name}) `;
					msg += `<${baseUrl}/#Admin?sub=edit_user&username=${data.user.username} | Edit User> `;
					actionType = 'update';
					item = data.user.username;
					break;
				case 'user_update':
					msg = `👤 User account updated: *${data.user.username}* (${data.user.full_name}) `;
					msg += `<${baseUrl}/#Admin?sub=edit_user&username=${data.user.username} | Edit User> `;
					actionType = 'update';
					item = data.user.username;
					break;
				case 'user_delete':
					msg = `👤 User account deleted: *${data.user.username}* (${data.user.full_name}) `;
					actionType = 'update';
					item = data.user.username;
					break;
				case 'user_login':
					msg = "👤 User logged in: *" + data.user.username + "* (" + data.user.full_name + ") ";
					actionType = 'info';
					break;

				// servers

				case 'server_add': // current
					msg = '🖥️ Server ' + (data.manual ? 'manually ' : '') + 'added to cluster: *' + data.hostname + '*  ';
					actionType = 'update';
					item = data.hostname;
					break;

				case 'server_remove': // current
					msg = '🖥️ Server ' + (data.manual ? 'manually ' : '') + 'removed from cluster: *' + data.hostname + '*  ';
					actionType = 'update';
					item = data.hostname;
					break;

				case 'server_manager': // current
					msg = '🖥️ Server has become manager: *' + data.hostname + '*'
					actionType = 'info';
					item = data.hostname;
					break;

				case 'server_restart':
					msg = '🖥️ Server restarted: *' + data.hostname + '*  ';
					actionType = 'info';
					item = data.hostname;
					break;
				case 'server_shutdown':
					msg = '🖥️ Server shut down: *' + data.hostname + '*  ';
					actionType = 'info';
					item = data.hostname;
					break;
				case 'server_sigterm':
					msg = '🖥️ Server shut down (sigterm): *' + data.hostname + '*  ';
					actionType = 'info';
					item = data.hostname;
					break;

				case 'server_disable':
					msg = '🖥️ Lost connectivity to server: *' + data.hostname + '*';
					actionType = 'info';
					item = data.hostname;
					break;

				case 'server_enable':
					msg = '🖥️ Reconnected to server: *' + data.hostname + '*';
					actionType = 'info';
					item = data.hostname;
					break;

				// jobs
				case 'job_run':
					msg = '📊 Job *#' + data.id + '* (' + data.title + ') manually started ';
					msg += ` <${baseUrl}/#JobDetails?id=${data.id} | Job Details> `;
					actionType = 'job';
					item = data.id;
					break;
				case 'job_complete':
					if (!data.code) {
						msg = '📊 Job *#' + data.id + '* (' + data.title + ') on server *' + data.hostname.replace(/\.[\w\-]+\.\w+$/, '') + '* completed successfully';
					}
					else {
						msg = '📊 Job *#' + data.id + '* (' + data.title + ') on server *' + data.hostname.replace(/\.[\w\-]+\.\w+$/, '') + '* failed with error: ' + encode_entities(data.description || 'Unknown Error').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
					}
					msg += ` <${baseUrl}/#JobDetails?id=${data.id} | Job Details> _- ${(new Date()).toLocaleTimeString()}_ `;
					actionType = 'job';
					item = data.id;
					break;
				case 'job_delete':
					msg = '📊 Job *#' + data.id + '* (' + data.title + ') manually deleted';
					actionType = 'update';
					item = data.id;
					break;

				case 'job_failure':  // xxx
					msg = `❌ Job *${data.job.id} 📊 (${data.job.event_title})* failed:\n ${data.job.description} \n`;
					msg += `<${this.server.config.get('base_app_url')}/#JobDetails?id=${data.job.id} | More details> _- ${(new Date()).toLocaleTimeString()}_ `;
					actionType = 'job';
					item = data.job.id;
					break;

				// scheduler
				case 'state_update':
					msg = 'ℹ️ Scheduler manager switch was *' + (data.enabled ? 'enabled' : 'disabled') + '*  ';
					actionType = 'info';
					item = (data.enabled ? 'enabled' : 'disabled');
					break;

				// errors
				case 'error':
					msg = '❌ Error: ' + data.description;
					actionType = 'info';
					break;

				// warnings
				case 'warning':
					msg = '⚠️ ' + data.description;
					actionType = 'info';
					break;

				case 'backup':
					msg = 'ℹ️ Backup completed';
					actionType = 'info';
					break;

				case 'restore':
					msg = 'ℹ️ Restore completed: ' + JSON.stringify(data.info, null, 2);
					actionType = 'info';
					break;

			}
		} catch (err) {
			self.logDebug(9, "Admin Web Hook Message failed: " + err);
		}

		let hookData = { text: (msg + modBy), action: action, item: item, type: actionType };

		// fire onupdate hook (on create/update/delete)
		if (onUpdateHook && actionType == 'update') {
			this.fireInfoHook(onUpdateHook, hookData, "Firing onupdate Hook");
		}

		// fire oninfo hook (on startup/shutdown/error/etc)
		if (onInfoHook && actionType == 'info') {
			this.fireInfoHook(onInfoHook, hookData, "Firing oninfo Hook");
		}

		// fire admin webhook (all action)
		if (adminHook) {
			this.fireInfoHook(adminHook, hookData, "Firing Admin Hook");
		}


		// auto git sync (on change or shutdown)
		// if (gitConf.enabled && gitConf.auto && (actionType == 'update' || action == 'server_shutdown' || action == 'server_restart')) {
		// 	let gitMsg = `${action} ${item}`.substring(0, 45)
		// 	this.gitSync(gitMsg, (err, data) => {
		// 		if (err) {
		// 			return self.logDebug(6, "Git Sync Error: " + err);
		// 		}
		// 		self.logDebug(6, "Git Sync Success: ");
		// 	});
		// }

		// manual git sync (only on clicking on backup button)
		// if (gitConf.enabled && action == 'backup') {
		// 	this.gitSync('manual backup', (err, data) => {
		// 		if (err) {
		// 			if (adminHook) { // for debugging purposes send git error to admin webhook
		// 				self.request.json(adminHook, { text: "Git Sync Failed: " + err.message }, (err, resp, data) => {
		// 					if (err) self.logDebug(9, "Admin Web Hook Error: " + err);
		// 				});
		// 			}
		// 			return self.logDebug(6, "Git Sync Error: " + err);
		// 		}
		// 		self.logDebug(6, "Git Sync Success: ");
		// 	});
		// }



		//}
	},

	gomanager: function () {
		// we just became the manager server
		const self = this;
		this.logDebug(3, "We are becoming the manager server");

		this.multi.manager = true;
		this.multi.worker = false;
		this.multi.cluster = true;
		this.multi.managerHostname = this.server.hostname;
		this.multi.lastPingSent = Tools.timeNow(true);

		// we need to know the server timezone at this point
		this.tz = jstz.determine().name();

		// only the manager server should enable storage maintenance
		this.server.on(this.server.config.get('maintenance'), function () {
			self.storage.runMaintenance(new Date(), self.runMaintenance.bind(self));
		});

		// only the manager server should enable storage ram caching
		this.storage.config.set('cache_key_match', '^global/');
		this.storage.prepConfig();

		// start server cluster management
		this.setupCluster();

		// start scheduler
		this.setupScheduler();

		// start queue monitor
		this.setupQueue();

		// clear daemon stats every day at midnight
		this.server.on('day', function () {
			self.state.stats = {};
		});

		// easter egg, let's see if anyone notices
		this.server.on('year', function () {
			self.logDebug(1, "Happy New Year!");
		});

		// log this event
		if (!this.server.debug) {
			this.logActivity('server_manager', { hostname: this.server.hostname });
		}

		// recover any leftover logs
		this.recoverJobLogs();
	},

	goworker: function () {
		// we just became a worker server
		// recover any leftover logs
		this.logDebug(3, "We are becoming a worker server");

		this.multi.manager = false;
		this.multi.worker = true;
		this.multi.cluster = true;

		// start queue monitor
		this.setupQueue();

		// recover any leftover logs
		this.recoverJobLogs();
	},

	managerFailover: function () {
		// No manager ping recieved in N seconds, so we need to choose a new manager
		const self = this;
		var servers = [];
		var groups = [];

		this.logDebug(3, "No manager ping received within " + this.server.config.get('manager_ping_timeout') + " seconds, choosing new manager");

		// make sure tick() doesn't keep calling us
		this.multi.lastPingReceived = Tools.timeNow(true);

		async.series([
			function (callback) {
				self.storage.listGet('global/servers', 0, 0, function (err, items) {
					servers = items || [];
					callback(err);
				});
			},
			function (callback) {
				self.storage.listGet('global/server_groups', 0, 0, function (err, items) {
					groups = items || [];
					callback(err);
				});
			}
		],
			function (err) {
				// all resources loaded
				if (err || !servers.length || !groups.length) {
					// should never happen
					self.logDebug(4, "No servers found, going into idle mode");
					self.multi.managerHostname = '';
					self.multi.manager = self.multi.worker = self.multi.cluster = false;
					return;
				}

				// compile list of manager server candidates
				var candidates = {};

				for (var idx = 0, len = groups.length; idx < len; idx++) {
					var group = groups[idx];
					if (group.manager) {

						var regexp = null;
						try { regexp = new RegExp(group.regexp); }
						catch (e) {
							self.logError('manager', "Invalid group regular expression: " + group.regexp + ": " + e);
							regexp = null;
						}

						if (regexp) {
							for (var idy = 0, ley = servers.length; idy < ley; idy++) {
								var server = servers[idy];
								if (server.hostname.match(regexp)) {
									candidates[server.hostname] = server;
								}
							} // foreach server
						}
					} // manager group
				} // foreach group

				// sanity check: we better be in the list
				if (!candidates[self.server.hostname]) {
					self.logDebug(4, "We are no longer eligible for manager, going into idle mode");
					self.multi.managerHostname = '';
					self.multi.manager = self.multi.worker = self.multi.cluster = false;
					return;
				}

				// sort hostnames alphabetically to determine rank
				var hostnames = Object.keys(candidates).sort();

				if (!hostnames.length) {
					// should never happen
					self.logDebug(4, "No eligible servers found, going into idle mode");
					self.multi.managerHostname = '';
					self.multi.manager = self.multi.worker = self.multi.cluster = false;
					return;
				}

				// see if any servers are 'above' us in rank
				var rank = hostnames.indexOf(self.server.hostname);
				if (rank == 0) {
					// we are the top candidate, so become manager immediately
					self.logDebug(5, "We are the top candidate for manager");
					self.gomanager();
					return;
				}

				// ping all servers higher than us to see if any of them are alive
				var superiors = hostnames.splice(0, rank);
				var alive = [];
				self.logDebug(6, "We are rank #" + rank + " for manager, pinging superiors", superiors);

				async.each(superiors,
					function (hostname, callback) {
						var server = candidates[hostname];

						var api_url = self.getServerBaseAPIURL(hostname, server.ip) + '/app/status';
						self.logDebug(10, "Sending API request to remote server: " + hostname + ": " + api_url);

						// send request
						self.request.json(api_url, {}, { timeout: 5 * 1000 }, function (err, resp, data) {
							if (err) {
								self.logDebug(10, "Failed to contact server: " + hostname + ": " + err);
								return callback();
							}
							if (resp.statusCode != 200) {
								self.logDebug(10, "Failed to contact server: " + hostname + ": HTTP " + resp.statusCode + " " + resp.statusMessage);
								return callback();
							}
							if (data.code != 0) {
								self.logDebug(10, "Failed to ping server: " + hostname + ": " + data.description);
								return callback();
							}
							if (data.tick_age > 60) {
								self.logDebug(1, "WARNING: Failed to ping server: " + hostname + ": Tick age is " + Math.floor(data.tick_age) + "s", data);
								return callback();
							}

							// success, at least one superior ponged our ping
							// relinquish command to them
							self.logDebug(10, "Successfully pinged server: " + hostname);
							alive.push(hostname);
							callback();
						});
					},
					function () {
						if (alive.length) {
							self.logDebug(6, alive.length + " servers ranked above us are alive, so we will become a worker", alive);
						}
						else {
							self.logDebug(5, "No other servers ranked above us are alive, so we are the top candidate for manager");
							self.gomanager();
						}
					} // pings complete
				); // async.each
			}); // got servers and groups
	},

	workerFailover: function () {
		// remove ourselves from worker duty, and go into idle mode
		if (this.multi.worker) {
			this.logDebug(3, "No manager ping received within " + this.server.config.get('manager_ping_timeout') + " seconds, going idle");
			this.multi.managerHostname = '';
			this.multi.manager = this.multi.worker = this.multi.cluster = false;
			this.lastDiscoveryBroadcast = 0;
		}
	},

	managerConflict: function (worker) {
		// should never happen: a worker has become manager
		// we must shut down right away if this happens
		var err_msg = "manager CONFLICT: The server '" + worker.hostname + "' is also a manager server. Shutting down immediately.";
		this.logDebug(1, err_msg);
		this.logError('multi', err_msg);
		this.server.shutdown();
	},

	isProcessRunning: function (pid) {
		// check if process is running or not
		var ping = false;
		try { ping = process.kill(pid, 0); }
		catch (e) { ; }
		return ping;
	},

	recoverJobLogs: function () {
		// upload any leftover job logs (after unclean shutdown)
		const self = this;

		// don't run this if shutting down
		if (this.server.shut) return;

		// make sure this ONLY runs once
		if (this.recoveredJobLogs) return;
		this.recoveredJobLogs = true;

		// look for any leftover job JSON files (manager server shutdown)
		var job_spec = this.server.config.get('log_dir') + '/jobs/*.json';
		this.logDebug(4, "Looking for leftover job JSON files: " + job_spec);

		glob(job_spec, {}, function (err, files) {
			// got job json files
			if (!files) files = [];
			async.eachSeries(files, function (file, callback) {
				// foreach job file
				if (file.match(/\/(\w+)(\-detached)?\.json$/)) {
					var job_id = RegExp.$1;

					fs.readFile(file, { encoding: 'utf8' }, function (err, data) {
						var job = null;
						try { job = JSON.parse(data); } catch (e) { ; }
						if (job) {
							self.logDebug(5, "Recovering job data: " + job_id + ": " + file, job);

							if (job.detached && job.pid && self.isProcessRunning(job.pid)) {
								// detached job is still running, resume it!
								self.logDebug(5, "Detached PID " + job.pid + " is still alive, resuming job as if nothing happened");
								self.activeJobs[job_id] = job;
								self.kids[job.pid] = { pid: job.pid };
								return callback();
							}
							else if (job.detached && fs.existsSync(self.server.config.get('queue_dir') + '/' + job_id + '-complete.json')) {
								// detached job completed while service was stopped
								// Note: Bit of a possible race condition here, as setupQueue() runs in parallel, and 'minute' event may fire
								self.logDebug(5, "Detached job " + job_id + " completed on its own, skipping recovery (queue will pick it up)");

								// disable job timeout, to prevent race condition with monitorAllActiveJobs()
								job.timeout = 0;

								self.activeJobs[job_id] = job;
								self.kids[job.pid] = { pid: job.pid };
								return callback();
							}
							else {
								// job died when server went down
								job.complete = 1;
								job.code = 1;
								job.description = "Aborted Job: Server '" + self.server.hostname + "' shut down unexpectedly.";
								self.logDebug(6, job.description);

								if (self.multi.manager) {
									// we're manager, finish the job locally
									self.finishJob(job);
								} // manager
								else {
									// we're a worker, signal manager to finish job via websockets
									self.io.emit('finish_job', job);
								} // worker
							} // standard job
						}

						fs.unlink(file, function (err) {
							// ignore error, file may not exist
							callback();
						});
					}); // fs.readFile
				} // found id
				else callback();
			},
				function (err) {
					// done with glob eachSeries
					self.logDebug(9, "Job recovery complete");

					var log_spec = self.server.config.get('log_dir') + '/jobs/*.log';
					self.logDebug(4, "Looking for leftover job logs: " + log_spec);

					// look for leftover log files
					glob(log_spec, {}, function (err, files) {
						// got log files
						if (!files) files = [];
						async.eachSeries(files, function (file, callback) {
							// foreach log file
							if (file.match(/\/(\w+)(\-detached)?\.log$/)) {
								var job_id = RegExp.$1;

								// only recover logs for dead jobs
								if (!self.activeJobs[job_id]) {
									self.logDebug(5, "Recovering job log: " + job_id + ": " + file);
									self.uploadJobLog({ id: job_id, log_file: file, hostname: self.server.hostname }, callback);
								}
								else callback();
							} // found id
							else callback();
						},
							function (err) {
								// done with glob eachSeries
								self.logDebug(9, "Log recovery complete");

								// cleanup old log .tmp files, which may have failed during old archive/rotation
								glob(self.server.config.get('log_dir') + '/jobs/*.tmp', {}, function (err, files) {
									if (!files || !files.length) return;
									async.eachSeries(files, function (file, callback) { fs.unlink(file, callback); });
								}); // glob
							});
					}); // glob
				}); // eachSeries
		}); // glob
	},

	runMaintenance: function (callback) {
		// run routine daily tasks, called after storage maint completes.
		// make sure our activity logs haven't grown beyond the max limit
		const self = this;
		var max_rows = this.server.config.get('list_row_max') || 0;
		if (!max_rows) return;

		// sanity check: make sure we are still manager
		if (!this.multi.manager) return;

		// don't run this if shutting down
		if (this.server.shut) return;

		var list_paths = ['logs/activity', 'logs/completed'];

		this.storage.listGet('global/schedule', 0, 0, function (err, items) {
			if (err) {
				self.logError('maint', "Failed to fetch list: global/schedule: " + err);
				return;
			}

			for (var idx = 0, len = items.length; idx < len; idx++) {
				list_paths.push('logs/events/' + items[idx].id);
			}

			async.eachSeries(list_paths,
				function (list_path, callback) {
					// iterator function, work on single list
					self.storage.listGetInfo(list_path, function (err, info) {
						// list may not exist, skip if so
						if (err) return callback();

						// check list length
						if (info.length > max_rows) {
							// list has grown too long, needs a trim
							self.logDebug(3, "List " + list_path + " has grown too long, trimming to max: " + max_rows, info);
							self.storage.listSplice( list_path, max_rows, info.length - max_rows, null, callback );
						}
						else {
							// no trim needed, proceed to next list
							callback();
						}
					}); // get list info
				}, // iterator
				function (err) {
					if (err) {
						self.logError('maint', "Failed to trim lists: " + err);
					}

					// done with maint
					if (callback) callback();

				} // complete
			); // eachSeries
		}); // schedule loaded

		// sanity state cleanup: flagged jobs
		if (this.state.flagged_jobs && Tools.numKeys(this.state.flagged_jobs)) {
			var all_jobs = this.getAllActiveJobs();
			for (var id in this.state.flagged_jobs) {
				if (!all_jobs[id]) delete this.state.flagged_jobs[id];
			}
		}
	},

	archiveLogs: function () {
		// archive all logs (called once daily)
		const self = this;
		var src_spec = this.server.config.get('log_dir') + '/*.log';
		var dest_path = this.server.config.get('log_archive_path');

		if (dest_path) {
			this.logDebug(4, "Archiving logs: " + src_spec + " to: " + dest_path);
			// generate time label from previous day, so just subtracting 30 minutes to be safe
			var epoch = Tools.timeNow(true) - 1800;

			this.logger.archive(src_spec, dest_path, epoch, function (err) {
				if (err) self.logError('maint', "Failed to archive logs: " + err);
				else self.logDebug(4, "Log archival complete");
			});
		}
	},

	deleteExpiredJobData: function (key, data, callback) {
		// delete both job data and job log
		// called from storage maintenance system for 'cronicle_job' record types
		const self = this;
		var log_key = key + '/log.txt.gz';

		this.logDebug(6, "Deleting expired job data: " + key);
		this.storage.delete(key, function (err) {
			if (err) self.logError('maint', "Failed to delete expired job data: " + key + ": " + err);

			self.logDebug(6, "Deleting expired job log: " + log_key);
			self.storage.delete(log_key, function (err) {
				if (err) self.logError('maint', "Failed to delete expired job log: " + log_key + ": " + err);

				callback();
			}); // delete
		}); // delete
	},

	_uniqueIDCounter: 0,
	getUniqueID: function (prefix) {
		// generate unique id using high-res server time, and a static counter,
		// both converted to alphanumeric lower-case (base-36), ends up being ~10 chars.
		// allows for *up to* 1,296 unique ids per millisecond (sort of).
		this._uniqueIDCounter++;
		if (this._uniqueIDCounter >= Math.pow(36, 2)) this._uniqueIDCounter = 0;

		return [
			prefix,
			Tools.zeroPad((new Date()).getTime().toString(36), 8),
			Tools.zeroPad(this._uniqueIDCounter.toString(36), 2)
		].join('');
	},

	corsPreflight: function (args, callback) {
		// handler for HTTP OPTIONS calls (CORS AJAX preflight)
		callback("200 OK",
			{
				'Access-Control-Allow-Origin': args.request.headers['origin'] || "*",
				'Access-Control-Allow-Methods': "POST, GET, HEAD, OPTIONS",
				'Access-Control-Allow-Headers': args.request.headers['access-control-request-headers'] || "*",
				'Access-Control-Max-Age': "1728000",
				'Content-Length': "0"
			},
			null
		);
	},

	logError: function (code, msg, data) {
		// proxy request to system logger with correct component
		this.logger.set('component', 'Error');
		this.logger.error(code, msg, data);
	},

	logTransaction: function (code, msg, data) {
		// proxy request to system logger with correct component
		this.logger.set('component', 'Transaction');
		this.logger.transaction(code, msg, data);
	},

	shutdown: function (callback) {
		// shutdown api service
		const self = this;
		if (!self.normalShutdown) this.logActivity('server_sigterm', { hostname: this.server.hostname });

		this.logDebug(2, "Shutting down Cronicle");
		this.abortAllLocalJobs();
		this.shutdownCluster();
		this.shutdownScheduler(function () {

			self.shutdownQueue();
			self.shutdownDiscovery();

			if (self.gcTimer) {
				clearTimeout(self.gcTimer);
				delete self.gcTimer;
			}

			// wait for all non-detached local jobs to complete before continuing shutdown
			var count = 0;
			var ids = [];
			var first = true;

			async.whilst(
				function () {
					count = 0;
					ids = [];
					for (var id in self.activeJobs) {
						var job = self.activeJobs[id];
						if (!job.detached) { count++; ids.push(id); }
					}
					return (count > 0);
				},
				function (callback) {
					if (first) {
						self.logDebug(3, "Waiting for " + count + " active jobs to complete", ids);
						first = false;
					}
					setTimeout(function () { callback(); }, 250);
				},
				function () {
					// all non-detached local jobs complete
					callback();
				}
			); // whilst

		}); // shutdownScheduler
	},

	emergencyShutdown: function (err) {
		// perform emergency shutdown due to uncaught exception
		this.logger.set('sync', true);
		this.logError('crash', "Emergency Shutdown: " + err);
		this.logDebug(1, "Emergency Shutdown: " + err);
		let errorMsg = 'cronicle: Emergency Shutdown (uncaught exception)'
		cp.execSync(`curl -X POST -H 'Content-Type: application/json' -d '{"text":"${errorMsg}"}' ${this.server.config.get('admin_web_hook')}`);
		this.abortAllLocalJobs();
	},

	monitorWindowsEvents: function () {

		const self = this
		if (self.winmonShuttingDown || self.server.shut) return;
        
		// powershell command to watch system log events
		const cmd = `
            $lse = Get-WinEvent -LogName System -MaxEvents 1
            "Monitor started ($pid). Last event: $($lse.Id) ($($lse.RecordId), $($lse.TimeCreated))" 
            $lastRecord = $lse.RecordId
            
            while ($true) {
              $evts = Get-WinEvent -LogName System -MaxEvents 6 -ErrorAction SilentlyContinue
              if ($evts[0].RecordId -gt $lastRecord) {
                for ($i = $evts.Length; $i -ge 0; $i--) {
                  if ($evts[$i].RecordId -gt $lastRecord) {
                    "event:[$($evts[$i].Id)] ($($evts[$i].RecordId), $($evts[$i].TimeCreated))"
                  }
                }
                $lastRecord = $evts[0].RecordId
              }
              Start-Sleep -Milliseconds 1000
            }
`

		let child = cp.spawn('powershell', ['-nop', '-c', cmd])	

		child.on('error', (e)=>{
			// if failed to start powershell, just stop
			self.winmonShuttingDown = true 
			this.logError("error", "Failed to start WINMON", e)
						
		})

		child.on('exit', (c) => {
			if (!self.winmonShuttingDown && !self.server.shut) {
				this.logError("error", "WINMON", "Monitor crashed unexpectedly, restarting")
				// restart monitor on unexpected crash
				self.monitorWindowsEvents()
			}
			else {
				self.logDebug(6, "WINMON", "Windows event log monitor stopped")
			}
		})

		const rl = readline.createInterface({
			input: child.stdout,
			output: null,
			terminal: false
		});	
	
		rl.on('line', (line) => {
	
			if (self.winmonShuttingDown || self.server.shut) return;

			self.logDebug(6, "WINMON", line)
			if (line.indexOf('[1074]') > 0) { // windows restart/shutdown event received 
				self.logDebug(2, "WINMON",  "Windows is shutting down (event 1074)")
				self.winmonShuttingDown = true
				child.kill()
				process.emit('SIGTERM')
			}
		});	
	}
	
});
