// Cronicle Server Job Manager
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const async = require('async');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqparse = require('shell-quote').parse;
const zlib = require('zlib');
const Class = require("pixl-class");
const Tools = require("pixl-tools");
const JSONStream = require("pixl-json-stream");
const PixlMail = require('pixl-mail');
const dotenv = require('dotenv');

//const si = require('systeminformation');
const isUnix = os.platform() != 'win32';

module.exports = Class.create({

	launchOrQueueJob: function (event, callback) {
		// launch job, or queue upon failure (if event desires)
		var self = this;

		// must be manager to do this
		if (!this.multi.manager) return callback(new Error("Only a manager server can launch jobs."));

		this.launchJob(event, function (err, jobs) {
			if (err && event.queue) {
				// event supports queuing
				var queue_max = event.queue_max || 0;
				if (!self.eventQueue[event.id]) self.eventQueue[event.id] = 0;

				if (!queue_max || (self.eventQueue[event.id] < queue_max)) {
					// queue has room for one more
					self.eventQueue[event.id]++;
					self.authSocketEmit('update', { eventQueue: self.eventQueue });

					// special 0-job response denotes an enqueue occurred
					err = null;
					jobs = [];

					// add now time if not already set
					if (!event.now) event.now = Tools.timeNow(true);

					// add job to actual queue in storage, async
					self.storage.listPush('global/event_queue/' + event.id, event, function (err) {
						if (err) {
							self.logError('queue', "Failed to push job onto event queue: " + err);
						}
					});
				}
				else {
					// queue is full, change error message
					err = new Error("Job could not be queued: Event queue reached max of " + queue_max + " items");
				}
			}
			callback(err, jobs);
		});
	},

	// safeJobLog(job) { // print less verbose, more readable job data on logging
	// 	process.exit
	// 	if(!job) return ''
	// 	let excl = ["table", "secret", "env", "cat_secret", "plug_secret", "globalenv"]
	// 	return Object.keys(jc).filter(e => !excl.includes(e)).map(e => e + ': ' + ("params|workflow|perf".indexOf(e) > -1 ? JSON.stringify(jc[e]) : jc[e]) ).join(" | ")
	// },

	launchJob: function (event, callback) {
		// locate suitable server and launch job
		let self = this;
		let orig_event = null;
		let server_group = null;
		let plugin = null;
		let category = null;
		let servers = [];
		let globalenv = {};
		let cat_secret = {};
		let plug_secret = {};
		let lag = Date.now();

		// must be manager to do this
		if (!this.multi.manager) return callback(new Error("Only a manager server can launch jobs."));

		async.series([
			function (callback) {
				// event target may refer to server group OR hostname
				var worker = self.workers[event.target] || null;
				if (worker && !worker.disabled) {
					servers.push(worker);
					return callback();
				}

				self.storage.listFind('global/server_groups', { id: event.target }, function (err, item) {
					server_group = item;
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/plugins', { id: event.plugin }, function (err, item) {
					plugin = item;
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/categories', { id: event.category }, function (err, item) {
					category = item;
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/schedule', { id: event.id }, function (err, item) {
					orig_event = item;
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/secrets', { id: 'globalenv' }, function (err, item) {
					globalenv = item;
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/secrets', { id: event.category }, function (err, item) {
					cat_secret = item || {};
					callback(err);
				});
			},
			function (callback) {
				self.storage.listFind('global/secrets', { id: event.plugin }, function (err, item) {
					plug_secret = item || {};
					callback(err);
				});
			},
		],
			function (err) {
				// all resources loaded
				if (err) return callback(err);
				if (!server_group && !servers.length) return callback(new Error("Server or Server Group not found: " + event.target));
				if (!plugin) return callback(new Error("Plugin not found: " + event.plugin));
				if (!category) return callback(new Error("Category not found: " + event.category));
				if (!orig_event) return callback(new Error("Event not found: " + event.id));

				var all_jobs = self.getAllActiveJobs(true); // include pending jobs
				var job_list = Tools.hashValuesToArray(all_jobs);

				// check running jobs vs. max children
				if (orig_event.max_children) {

					var event_filter = { 'event': event.id }
					if(event.concurrent_arg) event_filter.arg = event.arg
					var event_jobs = Tools.findObjectsIdx(job_list, event_filter)

					if (event_jobs.length >= orig_event.max_children) {
						// too many event children running
						return callback(new Error("Maximum of " + orig_event.max_children + " " + Tools.pluralize("job", orig_event.max_children) + " already running for event: " + event.title));
					}
				}

				if (category.max_children) {
					var cat_jobs = Tools.findObjectsIdx(job_list, { 'category': event.category });
					if (cat_jobs.length >= category.max_children) {
						// too many category children running
						return callback(new Error("Maximum of " + category.max_children + " " + Tools.pluralize("job", category.max_children) + " already running for category: " + category.title));
					}
				}
				
				var max_jobs = self.server.config.get('max_jobs') || 0;
				if (max_jobs && (job_list.length >= max_jobs)) {
					return callback( new Error("Global maximum of " + max_jobs + " " + Tools.pluralize("job", max_jobs) + " already running.") );
				}

				if (!category.enabled) {
					return callback(new Error("Category '" + category.title + "' is disabled."));
				}
				if (!plugin.enabled) {
					return callback(new Error("Plugin '" + plugin.title + "' is disabled."));
				}

				// automatically pick server if needed
				if (!servers.length && server_group) {
					var candidates = [];
					var regex = new RegExp(server_group.regexp);

					for (var hostname in self.workers) {
						var worker = self.workers[hostname];

						// only consider workers that match the group hostname pattern, and are not disabled
						if (hostname.match(regex) && !worker.disabled) {
							candidates.push(self.workers[hostname]);
						}
					}

					if (!candidates.length) {
						return callback(new Error("Could not find any servers for group: " + server_group.title));
					}

					// sort the candidates by hostname ascending
					candidates = candidates.sort(function (a, b) {
						return a.hostname.localeCompare(b.hostname);
					});

					if (event.multiplex) {
						// run on ALL servers in group simultaneously (multiplex)
						servers = candidates;
					}
					else {
						// run on one server in group, chosen by custom algo
						servers.push(self.chooseServer(candidates, event));
					}
				} // find worker

				if (!servers.length) {
					// event was targetting server that is no longer with us
					return callback(new Error("Target server is not available: " + event.target));
				}

				var jobs = [];

				// loop through each matched server, launching job on each
				for (var idx = 0, len = servers.length; idx < len; idx++) {
					var worker = servers[idx];

					// construct job object based on event
					var job = Tools.copyHash(event, true);

					delete job.id;
					delete job.title;
					delete job.timing;
					delete job.ticks;
					if(!job.repeat) delete job.enabled; // allow repeat job to be disable while running
					delete job.max_children;
					//	delete job.target;
					delete job.username;
					delete job.api_key;
					delete job.session_id;
					delete job.modified;
					delete job.created;
					delete job.salt;
					delete job.token;
					delete job.uid;
					delete job.secret
					
					job.id = self.getUniqueID('j');
					job.time_start = Tools.timeNow();
					job.hostname = worker.hostname;
					job.event = event.id;
					job.params = event.params || {};
					job.now = event.now || Tools.timeNow(true);
					job.event_title = event.title;
					job.plugin_title = plugin.title;
					job.is_wf = plugin.wf;
					job.category_title = category.title;
					job.nice_target = server_group ? server_group.title : event.target;
					job.ipc = !!plugin.ipc
					job.lag	= lag
					job.stdin = !!plugin.stdin
					job.stdin_script = plugin.script		

					// SECRETS - decryption will occur at LaunchLocalJob
					job.secret = orig_event.secret	// should be encrypted
					// job.plugin_secret = plugin.secret // should be encrypted
					if (globalenv.data) { // could be unencrypted
						job.globalenv = globalenv.encrypted ? globalenv.data : self.encryptObject(globalenv.data)
					}
					if (cat_secret.data) { // could be unencrypted
						job.cat_secret = cat_secret.encrypted ? cat_secret.data : self.encryptObject(cat_secret.data)
					}
					if (plug_secret.data) { // could be unencrypted
						job.plug_secret = plug_secret.encrypted ? plug_secret.data : self.encryptObject(plug_secret.data)
					}
					
					// pull in properties from plugin

					let jobCodes = self.state.jobCodes || {}
					let jobMemos = self.state.jobMemos || {}			
					if (job.event in jobCodes) job.last_exit_code = jobCodes[job.event]
					if (job.event in jobMemos) {
						job.last_memo = jobMemos[job.event]
						job.state = job.state || jobMemos[job.event]
					}

					job.command = plugin.command;
					if (plugin.cwd) job.cwd = plugin.cwd;
					if (isUnix) {
						if (plugin.uid) job.uid = plugin.uid;
						if (job.debug_sudo) job.uid = process.getuid();
						if (plugin.gid) job.gid = plugin.gid;
					}

					job.env = self.server.config.get('job_env') || {} 
					let proto = 'http://'
					let port = self.server.config.get('WebServer').http_port
					if(self.server.config.get('WebServer').https) {
						proto = 'https://'
						port = self.server.config.get('WebServer').https_port
					}

					let base_url = proto + self.server.hostname + ':' + port

					let base_path = String(self.server.config.get('base_path') || '').trim() 
					if ((/^\/\w+$/i).test(base_path)) base_url = base_url + base_path

					job.env['BASE_URL'] = base_url

					job.env['BASE_APP_URL'] = self.server.config.get('base_app_url') || ''
					if(plugin.id === 'workflow' || plugin.wf) {
						self.workflowKeys.set(job.id, Tools.digestHex(job.id + self.config.get('secret_key'), 'MD5'))
				    }

					// for shell plug - resolve parameter placeholders using params object on config
					let xparams = JSON.parse(JSON.stringify(self.server.config.get('params') || {}));

					// add arguments (shold appear as ARG1, ARG2, ..., env var or param )
					if (job.args) {
						job.args.split(",")
							.map(e => e.trim())
							.filter(e => e.match(/^[\w\.\@\-]+$/g))
							.slice(0, 9)
							.forEach((e, i) => {
								xparams[`ARG${i + 1}`] = e;
								job.params[`ARG${i + 1}`] = e;
							});
						job.params['ARGS'] = job.args;
						delete job.args;
					}

					// shell plug - substitute params in script
					if (job.params.script && job.params.sub_params) job.params.script = Tools.sub(job.params.script, xparams);

					// plugin params may have changed outside of event, 
					// so recopy missing / hidden ones
					if (plugin.params) plugin.params.forEach(function (param) {
						if (!(param.id in job.params) || (param.type == 'hidden')) {
							job.params[param.id] = param.value;
						}
					});

					// pull in defaults from category
					if (!job.notify_success && category.notify_success) job.notify_success = category.notify_success;
					if (!job.notify_fail && category.notify_fail) job.notify_fail = category.notify_fail;
					if (!job.web_hook && category.web_hook) job.web_hook = category.web_hook;
					if (!job.memory_limit && category.memory_limit) {
						job.memory_limit = category.memory_limit;
						job.memory_sustain = category.memory_sustain || 0;
					}
					if (!job.cpu_limit && category.cpu_limit) {
						job.cpu_limit = category.cpu_limit;
						job.cpu_sustain = category.cpu_sustain || 0;
					}

					// multiplex stagger if desired
					if (event.multiplex && event.stagger && (idx > 0)) {
						// delay job by N seconds, based on stagger and host position in group
						job.when = Tools.timeNow() + (event.stagger * idx);
						job.time_start = job.when;
					}

					// send remote or run local
					// if(self.server.config.get('profile')) self.logDebug(6, `PROFILE: LAG ${job.id} manager`, Date.now() - lag)
					if (worker.manager) {
						// run the event here
						self.launchLocalJob(job);						
					}
					else if (worker.socket) {
						// send the job to remote worker server
						self.logDebug(6, "Sending remote job to: " + worker.hostname, job);
						worker.socket.emit('launch_job', job);

						// Pre-insert job into worker's active_jobs, so something will show in getAllActiveJobs() right away.
						// Important for when the scheduler is catching up, and may try to launch a bunch of jobs in a row.
						if (!worker.active_jobs) worker.active_jobs = {};
						worker.active_jobs[job.id] = job;
					}

					// fire web hook
					var hook_data = Tools.mergeHashes(job, { action: 'job_start' });

					// prepare nice text summary (compatible with Slack Incoming WebHooks)
					hook_data.base_app_url = self.server.config.get('base_app_url');
					hook_data.job_details_url = self.server.config.get('base_app_url') + '/#JobDetails?id=' + job.id;
					hook_data.edit_event_url = self.server.config.get('base_app_url') + '/#Schedule?sub=edit_event&id=' + job.event;

					var hook_text_templates = self.server.config.get('web_hook_text_templates') || self.defaultWebHookTextTemplates;

					if (hook_text_templates[hook_data.action]) {
						hook_data.text = Tools.sub(hook_text_templates[hook_data.action], hook_data);

						// include web_hook_config_keys if configured
						if (self.server.config.get('web_hook_config_keys')) {
							var web_hook_config_keys = self.server.config.get('web_hook_config_keys');
							for (var idy = 0, ley = web_hook_config_keys.length; idy < ley; idy++) {
								var key = web_hook_config_keys[idy];
								hook_data[key] = self.server.config.get(key);
							}
						}

						// include web_hook_custom_data if configured
						if (self.server.config.get('web_hook_custom_data')) {
							var web_hook_custom_data = self.server.config.get('web_hook_custom_data');
							for (var key in web_hook_custom_data) hook_data[key] = web_hook_custom_data[key];
						}

						if (job.web_hook_start) {
							let wh_data = Tools.mergeHashes(hook_data, {}) // copy hook_data
							delete wh_data.html // to avoid conflicts

							let wh_map = self.server.config.get('web_hooks') || {};
							let wh_config = wh_map[job.web_hook_start] || { url: job.web_hook_start }

							if (wh_config.compact) wh_data = {
								action: 'job_started',
								text: hook_data.text,
								job_id: job.id,
								event_title: job.event_title,
								job_code: job.code
							}

							self.fireInfoHook(wh_config, wh_data, "Firing web hook for job start: " + job.id + ": " + job.web_hook_start);

						}

						if (self.server.config.get('universal_web_hook')) {
							self.fireInfoHook(self.server.config.get('universal_web_hook'), hook_data, "Firing Universal web hook for job start")
						}

					} // yes fire hook

					jobs.push(job);
				} // foreach worker

				// no error
				callback(null, jobs);
			});
	},

	chooseServer: function (candidates, event) {
		// choose server for event, based on algo
		var server = null;

		var hostnames = [];
		for (var idx = 0, len = candidates.length; idx < len; idx++) {
			hostnames.push(candidates[idx].hostname);
		}
		this.logDebug(9, "Choosing server for event using algo: " + event.algo || 'random', hostnames);

		switch (event.algo || 'random') {
			case "random":
				// random server from group
				server = Tools.randArray(candidates);
				break;

			case "round_robin":
				// pick each server in sequence, repeat
				if (!this.state.robins) this.state.robins = {};
				var robin = this.state.robins[event.id] || 0;
				if (robin >= candidates.length) robin = 0;
				server = candidates[robin];
				this.state.robins[event.id] = robin + 1;
				break;

			case "least_cpu":
				// pick server with least CPU in use
				var cpus = {};
				var servers = this.getAllServers();
				for (var hostname in servers) {
					cpus[hostname] = 0;
					if (servers[hostname] && servers[hostname].data && servers[hostname].data.cpu) {
						cpus[hostname] = servers[hostname].data.cpu;
					}
				}
				var jobs = this.getAllActiveJobs();
				for (var job_id in jobs) {
					var job = jobs[job_id];
					if (job.cpu && job.cpu.current) {
						if (!cpus[job.hostname]) cpus[job.hostname] = 0;
						cpus[job.hostname] += job.cpu.current;
					}
				}
				var least_value = -1;
				var least_hostname = '';
				for (var idx = 0, len = candidates.length; idx < len; idx++) {
					var hostname = candidates[idx].hostname;
					if ((least_value == -1) || (cpus[hostname] < least_value)) {
						least_value = cpus[hostname];
						least_hostname = hostname;
					}
				}
				this.logDebug(9, "CPU Snapshot:", cpus);
				server = Tools.findObject(candidates, { hostname: least_hostname });
				break;

			case "least_mem":
				// pick server with least memory in use
				var mems = {};
				var servers = this.getAllServers();
				for (var hostname in servers) {
					mems[hostname] = 0;
					if (servers[hostname] && servers[hostname].data && servers[hostname].data.mem) {
						mems[hostname] = servers[hostname].data.mem;
					}
				}
				var jobs = this.getAllActiveJobs();
				for (var job_id in jobs) {
					var job = jobs[job_id];
					if (job.mem && job.mem.current) {
						if (!mems[job.hostname]) mems[job.hostname] = 0;
						mems[job.hostname] += job.mem.current;
					}
				}
				var least_value = -1;
				var least_hostname = '';
				for (var idx = 0, len = candidates.length; idx < len; idx++) {
					var hostname = candidates[idx].hostname;
					if ((least_value == -1) || (mems[hostname] < least_value)) {
						least_value = mems[hostname];
						least_hostname = hostname;
					}
				}
				this.logDebug(9, "Mem Snapshot:", mems);
				server = Tools.findObject(candidates, { hostname: least_hostname });
				break;

			case "prefer_first":
				// pick server towards top of sorted list
				server = candidates[0];
				break;

			case "prefer_last":
				// pick server towards bottom of sorted list
				server = candidates[candidates.length - 1];
				break;
		} // switch event.algo

		this.logDebug(9, "Chose server: " + server.hostname + " via algo: " + (event.algo || "random"));
		return server;
	},

	launchLocalJob: function (job) {
		// launch job as a local child process
		var self = this;
		var child = null;
		var worker = null;
		// if(self.server.config.get('profile')) self.logDebug(6, `PROFILE: LAG ${job.id} manager`, Date.now() - job.lag)

		// check for job delay request (multiplex stagger)
		if (job.when && (job.when > Tools.timeNow())) {
			this.logDebug(6, "Job " + job.id + " will be delayed for " +
				Tools.getTextFromSeconds(job.when - Tools.timeNow()));

			job.action = 'launchLocalJob';
			this.enqueueInternal(job);
			return;
		}

		if (job.cycles && job.log_file) { // if job is in "repeat loop" keep original log file

			job.time_start = Tools.timeNow()
			job.state = job.memo
			job.last_memo = job.memo
			job.last_exit_code = job.code // for repeat job LEC should come from previous cycle, not event
			delete job.memo
			delete job.code 
			delete job.description

		}
		else {

			// construct fully qualified path to job log file
			job.log_file = path.resolve(path.join(
				this.server.config.get('log_dir'), 'jobs',
				job.id + (job.detached ? '-detached' : '') + '.log'
			));
		}

		this.logDebug(6, "Launching local job", this.safeJobLog(job));

		// if we are the manager server or job is detached, 
		// save copy of job file to disk next to log (for crash recovery)
		if (this.multi.manager || job.detached) {
			fs.writeFile(job.log_file.replace(/\.log$/, '.json'), JSON.stringify(job), function (err) {
				if (err) self.logError('job', "Failed to write JSON job file: " + job.log_file.replace(/\.log$/, '.json') + ": " + err);
			});
		}

		let job_env = Tools.mergeHashes(process.env, job.env || {}) // public vars

		// decrypt secrets

		if(job.globalenv) {
			try { 
				job_env = Tools.mergeHashes(job_env, dotenv.parse(self.decryptObject(job.globalenv)))
			}
			catch (e) { self.logDebug(6, 'failed to decrypt globalenv:', e) }
			// delete job.globalenv
		}

		if(job.cat_secret) {
			try { 
				job_env = Tools.mergeHashes(job_env, dotenv.parse(self.decryptObject(job.cat_secret)))
			}
			catch (e) { self.logDebug(6, 'failed to decrypt category secret:', e) }
			// delete job.cat_secret
		}

		if(job.plug_secret) {
			try {
				job_env = Tools.mergeHashes(job_env, dotenv.parse(self.decryptObject(job.plug_secret)))
			}
			catch (e) {	self.logError(6, 'Failed to decrypt plugin secret:', e) }
			// delete job.plug_secret
		}

		if(job.secret) {
			try { 
				job_env = Tools.mergeHashes(job_env, dotenv.parse(self.decryptObject(job.secret)))
			 }
			catch (e) {	self.logError(6, 'Failed to decrypt job secret:', e) }
			// delete job.secret
		}

		if (job.is_wf || job.plugin == 'workflow') { 
			// job_env['WF_SIGNATURE'] = 'sha1=' + crypto.createHmac("sha1", self.server.config.get('secret_key')).update(job.id).digest("hex")
			job_env['WF_SIGNATURE'] = Tools.digestHex(job.id + self.config.get('secret_key'), 'MD5')
		}

		// setup environment for child
		var child_opts = {
			cwd: job.cwd || process.cwd(),
			env: job_env
		};

		if (isUnix) {
			child_opts['uid'] = job.uid || process.getuid()
			child_opts['gid'] = process.getgid()
		}

		child_opts.env['CRONICLE'] = this.server.__version;
		child_opts.env['JOB_ID'] = job.id;
		child_opts.env['JOB_LOG'] = job.log_file;
		child_opts.env['JOB_NOW'] = job.now;
		child_opts.env['PWD'] = child_opts.cwd;

		// copy all top-level job keys into child env, if number/string/boolean
		for (var key in job) {
			switch (typeof (job[key])) {
				case 'string':
				case 'number':
					child_opts.env['JOB_' + key.toUpperCase()] = '' + job[key];
					break;

				case 'boolean':
					child_opts.env['JOB_' + key.toUpperCase()] = job[key] ? 1 : 0;
					break;
			}
		}

		// get uid / gid info for child env vars. Ignore for Win32
		if (isUnix) {
			var user_info = Tools.getpwnam(child_opts.uid, true);
			if (user_info) {
				child_opts.uid = user_info.uid;
				child_opts.gid = user_info.gid;
				child_opts.env.USER = child_opts.env.USERNAME = user_info.username;
				child_opts.env.HOME = user_info.dir;
				child_opts.env.SHELL = user_info.shell;
			}
			else if (child_opts.uid != process.getuid()) {
				// user not found
				job.pid = 0;
				job.code = 1;
				job.description = "Plugin Error: User does not exist: " + child_opts.uid;
				this.logError("child", job.description);
				this.activeJobs[job.id] = job;
				this.finishLocalJob(job);
				return;
			}


			if (job.gid) {
				var grp_info = Tools.getgrnam(job.gid, true);
				if (grp_info) {
					child_opts.gid = grp_info.gid;
				}
				else {
					// group not found
					job.pid = 0;
					job.code = 1;
					job.description = "Plugin Error: Group does not exist: " + job.gid;
					this.logError("child", job.description);
					this.activeJobs[job.id] = job;
					this.finishLocalJob(job);
					return;
				}
			}

			child_opts.uid = parseInt(child_opts.uid);
			child_opts.gid = parseInt(child_opts.gid);
		} // if unix

		// add plugin params as env vars
		if (job.params) {
			// expand $INLINE vars (unless escaped) if inline_params setting is set to true
			if (self.server.config.get('inline_params')) {
				for (let key in job.params) {
					let K = key.toUpperCase()
					if(K == 'LANG' || K == 'TZ' ) K = K.toLowerCase()
					child_opts.env[K] =
						('' + job.params[key]).replace(/(\\?)\$(\w+)/g, function (m_all, m_g1, m_g2) {
							return m_g1 ? ('$' + m_g2) : ((m_g2 in child_opts.env) ? child_opts.env[m_g2] : '');
						});
				}
			}
			else { // do not expand by default (expand only if user is aware of this feature)
				for (let key in job.params) {
					let K = key.toUpperCase()
					if(K == 'LANG' || K == 'TZ' ) K = K.toLowerCase()
					child_opts.env[K] = job.params[key]
				}				
			}
		}

		this.logDebug(9, "Child spawn options:", child_opts);

		// create log file, write header to it
		var dargs = Tools.getDateArgs(new Date());

		fs.appendFileSync(job.log_file, [
			"# Job ID: " + job.id,
			"# Event Title: " + job.event_title,
			"# Hostname: " + this.server.hostname,
			"# Date/Time: " + dargs.yyyy_mm_dd + ' ' + dargs.hh_mi_ss + ' (' + dargs.tz + ')'
		].join("\n") + "\n\n");

		// make sure child can write to log file
		fs.chmodSync(job.log_file, "777");

		// Mike's update: add job to active list before spawning
		// avoid rare issue when WF event will start polling before it's in active job list (will cause auth error)

		this.activeJobs[job.id] = job;

		if (job.detached) {
			// spawn detached child
			var temp_file = path.join(os.tmpdir(), 'cronicle-job-temp-' + job.id + '.json');

			// tell child where the queue dir is
			job.queue_dir = path.resolve(this.server.config.get('queue_dir'));

			// write job file
			fs.writeFileSync(temp_file, JSON.stringify(job));
			fs.chmodSync(temp_file, "777");
			this.logDebug(9, "Job temp file: " + temp_file);

			// spawn child
			child_opts.detached = true;
			child_opts.stdio = ['ignore', 'ignore', 'ignore'];

			try {
				child = cp.spawn(process.execPath, [path.resolve("bin/run-detached.js"), "detached", temp_file], child_opts);
			}
			catch (err) {
				job.pid = 0;
				job.code = 1;
				job.description = "Child process error: " + Tools.getErrorDescription(err);
				this.logError("child", job.description);
				//this.activeJobs[job.id] = job;
				this.finishLocalJob(job);
				return;
			}

			job.pid = child.pid || 0;

			this.logDebug(3, "Spawned detached process: " + job.pid + " for job: " + job.id, job.command);

			worker = {
				pid: job.pid
			};

			child.unref();
		}
		else {
			// spawn child normally
			var child_cmd = job.command;
			var child_args = [];

			// if command has cli args, parse using shell-quote
			if (child_cmd.match(/\s+(.+)$/)) {
				var cargs_raw = RegExp.$1;
				child_cmd = child_cmd.replace(/\s+(.+)$/, '');
				child_args = sqparse(cargs_raw, child_opts.env);
			}

			worker = {};

			// attach streams
			worker.log_fd = fs.openSync(job.log_file, 'a');
			child_opts.stdio = ['pipe', 'pipe', worker.log_fd];
			if(job.plugin == 'workflow' || job.plugin == 'sshplug' || job.ipc ) {
				 child_opts.stdio = ['pipe', 'pipe', worker.log_fd, 'ipc'];
			}

			// spawn child
			try {
				child = cp.spawn(child_cmd, child_args, child_opts);
				if (!child || !child.pid || !child.stdin || !child.stdout) {
					throw new Error("Child process failed to spawn (Check executable location and permissions?)");
				}
			}
			catch (err) {
				if (child) child.on('error', function () { }); // prevent crash
				if (worker.log_fd) { fs.closeSync(worker.log_fd); worker.log_fd = null; }
				job.pid = 0;
				job.code = 1;
				job.description = "Child spawn error: " + child_cmd + ": " + Tools.getErrorDescription(err);
				this.logError("child", job.description);

				//this.activeJobs[job.id] = job;
				this.finishLocalJob(job);
				return;
			}
			job.pid = child.pid || 0;

			this.logDebug(3, "Spawned child process: " + job.pid + " for job: " + job.id, child_cmd);

			// connect json stream to child's stdio
			// order reversed deliberately (out, in)
			var stream = new JSONStream(child.stdout, child.stdin);
			// stream.EOL = "\n"
			stream.recordRegExp = /^\s*\{.+\}\s*$/;

			worker.pid = job.pid;
			worker.child = child;
			worker.stream = stream;

			stream.on('json', function (data) {
				// received data from child
				self.handleChildResponse(job, worker, data);
			});

			stream.on('text', function (line) {
				// received non-json text from child, log it
				fs.appendFileSync(job.log_file, line);
			});

			stream.on('error', function (err, text) {
				// Probably a JSON parse error (child emitting garbage)
				self.logError('job', "Child stream error: Job ID " + job.id + ": PID " + job.pid + ": " + err);
				if (text) fs.appendFileSync(job.log_file, text + "\n");
			});

			child.on('error', function (err) {
				// child error
				if (worker.log_fd) { fs.closeSync(worker.log_fd); worker.log_fd = null; }
				job.code = 1;
				job.description = "Child process error: " + Tools.getErrorDescription(err);
				worker.child_exited = true;
				self.logError("child", job.description);
				self.finishLocalJob(job);
			});

			child.on('exit', function (code, signal) {
				// child exited
				self.logDebug(3, "Child " + job.pid + " exited with code: " + (code || signal || 0));
				worker.child_exited = true;

				if (job.complete) {
					// child already reported completion, so finish job now
					if (worker.log_fd) { fs.closeSync(worker.log_fd); worker.log_fd = null; }
					self.finishLocalJob(job);
				}
				else {
					// job is not complete but process exited (could be coming in next tick)
					// set timeout just in case something went wrong
					worker.complete_timer = setTimeout(function () {
						if (worker.log_fd) { fs.closeSync(worker.log_fd); worker.log_fd = null; }
						job.code = code || 1;
						job.description = code ?
							("Child " + job.pid + " crashed with code: " + (code || signal)) :
							("Process exited without reporting job completion.");
						if (!code) job.unknown = 1;
						self.finishLocalJob(job);
					}, 1000);
				}
			}); // on exit

			if(job.lag) job.lag = Date.now() - job.lag  // measure launch delay for profiling
			// if(self.server.config.get('profile')) self.logDebug(6, "PROFILE: LAG to local", job.lag)

			
			if(job.stdin && job.stdin_script) { // pipe plugin's stdin script if specified
				stream.EOL = "\n" // on Windows some shells still use \n (e.g. node)
				child.stdin.write(job.stdin_script)
				child.stdin.write(os.EOL)
			}
			else { // send initial job + params
				stream.write(job);
			}			

			// we're done writing to the child -- don't hold open its stdin
			worker.child.stdin.end();

		} // spawn normally

		// track job in our own hash
		// moving this on top of previous IF
		// this.activeJobs[job.id] = job;
		this.kids[job.pid] = worker;
	},

	handleChildResponse: function (job, worker, data) {
		// child sent us some datas (progress or completion)
		this.logDebug(10, "Got job update from child: " + job.pid, data);

		// sanity check -- disallow updates after job completion
		if (job.complete) {
			this.logDebug(10, "Job update received after completion -- ignoring");
			return;
		}

		// only pull in properties we recognize
		['progress', 'memo', 'complete', 'code', 'description', 'perf', 'update_event', 'table', 'html', 'chain', 'chain_data', 'chain_params', 'chain_error', 'notify_success', 'notify_fail'].forEach(function (key) {
			if (key in data) job[key] = data[key];
		});

		// assume success if complete but no code specified
		if (job.complete && !job.code) job.code = 0;

		if (job.complete && worker.child_exited) {
			// in case this update came in after child exited
			this.finishLocalJob(job);
		}
	},

	detachedJobUpdate: function (data) {
		// receive update from detached child via queue system
		var id = data.id;
		delete data.id;

		var in_progress = data.in_progress || false;
		delete data.in_progress;

		this.logDebug(9, "Received update from detached job: " + id, data);

		var job = this.activeJobs[id];
		if (!job) {
			// if this is an in-progress update, we can just silently skip (queue files arrived out of order)
			if (in_progress) return;

			// service may have restarted - try to recover job from temp file
			var job_file = this.server.config.get('log_dir') + '/jobs/' + id + '-detached' + '.json';
			this.logDebug(6, "Detached job is not in memory: " + id + ": Attempting to recover from disk", job_file);

			// okay to use sync here, as this should be a very rare event
			if (fs.existsSync(job_file)) {
				var json_raw = fs.readFileSync(job_file, { encoding: 'utf8' });
				try { job = JSON.parse(json_raw); }
				catch (err) {
					this.logError('job', "Failed to read detached job file: " + job_file + ": " + err);
				}
			}
			else {
				this.logError('job', "Could not locate detached job file: " + job_file);
			}

			if (job) {
				this.logDebug(6, "Recovered job data from disk: " + job_file, this.safeJobLog(job));
				this.activeJobs[id] = job;
				this.kids[job.pid] = { pid: job.pid };
			}
			else {
				this.logError('job', "Failed to locate active job for update: " + id, data);
				return;
			}
		} // no job in memory

		// delegate to handleChildResponse, but create a temp fake worker object
		// with child_exited set to true, so detached job can complete normally
		this.handleChildResponse(job, { child_exited: true }, data);
	},

	rewindJob: function (job) {
		// reset cursor state to minute before job started (use 'now' property in case start was delayed)
		// only do this if job has catch_up, and is not multiplexed
		if (!this.multi.manager) return;

		// Note: manually started jobs will now be included in the rewind, as per GH #757

		if (job.catch_up && !job.multiplex) {
			var new_start = Tools.normalizeTime(job.now - 60, { sec: 0 });
			this.state.cursors[job.event] = new_start;

			var dargs = Tools.getDateArgs(new_start);
			this.logDebug(5, "Reset event " + job.event + " cursor to: " + dargs.yyyy_mm_dd + " " + dargs.hh + ":" + dargs.mi + ":00");
		}
	},

	findJob: function (stub) {
		// find active or pending job
		// stub should have: id
		if (!this.multi.manager) return false;
		if (typeof (stub) == 'string') stub = { id: stub };

		// check all jobs, local, remote and pending
		var all_jobs = this.getAllActiveJobs(true);
		var job = all_jobs[stub.id];
		if (!job) {
			// check pending jobs (they have separate IDs)
			for (var key in all_jobs) {
				if (all_jobs[key].id == stub.id) {
					job = all_jobs[key];
					break;
				}
			}
		}

		return job || false;
	},

	updateJob: function (stub) {
		// update active job
		// stub should have: id
		if (!this.multi.manager) return false;
		var job = this.findJob(stub);

		if (!job) {
			// should never happen
			this.logDebug(1, "Could not locate job: " + stub.id);
			return false;
		}

		if (job.hostname == this.server.hostname) {
			// local job
			this.updateLocalJob(stub);
		}
		else {
			// remote job
			var worker = this.workers[job.hostname];
			if (!worker) {
				// should never happen
				this.logDebug(1, "Could not locate worker: " + job.hostname);
				return false;
			}

			this.logDebug(6, "Sending job update command to: " + worker.hostname, stub);
			worker.socket.emit('update_job', stub);
		}

		return true;
	},

	updateLocalJob: function (stub) {
		// update local job properties
		var job = this.activeJobs[stub.id];
		if (!job) {
			// must be a pending job
			if (this.internalQueue) {
				for (var key in this.internalQueue) {
					var task = this.internalQueue[key];
					if ((task.action = 'launchLocalJob') && (task.id == stub.id)) {
						job = task;
						break;
					}
				}
			}
			if (!job) {
				// should never happen
				this.logDebug(1, "Could not locate job: " + stub.id);
				return false;
			}
		}

		this.logDebug(4, "Updating local job: " + stub.id, stub);

		// update properties
		for (var key in stub) {
			if (key != 'id') job[key] = stub[key];
		}

		return true;
	},

	abortJob: function (stub) {
		// abort active job
		// stub should have: id, reason
		if (!this.multi.manager) return false;

		// check all jobs, local, remote and pending
		var all_jobs = this.getAllActiveJobs(true);
		var job = all_jobs[stub.id];
		if (!job) {
			// check pending jobs (they have separate IDs)
			for (var key in all_jobs) {
				if (all_jobs[key].id == stub.id) {
					job = all_jobs[key];
					break;
				}
			}
		}
		if (!job) {
			// should never happen
			this.logDebug(1, "Could not locate job: " + stub.id);
			return false;
		}

		if (job.hostname == this.server.hostname) {
			// local job
			this.abortLocalJob(stub);
		}
		else {
			// remote job
			var worker = this.workers[job.hostname];
			if (!worker) {
				// should never happen
				this.logDebug(1, "Could not locate worker: " + job.hostname);
				return false;
			}

			this.logDebug(6, "Sending job abort command to: " + worker.hostname, stub);
			worker.socket.emit('abort_job', stub);
		}

		// rewind cursor if needed
		if (!stub.no_rewind) this.rewindJob(job);

		if (job.pending && !job.log_file) {
			// job is pre-launch, so log activity
			this.logActivity('error', { description: "Pending job #" + stub.id + " (" + (job.event_title || 'Unknown') + ") was aborted pre-launch: " + stub.reason });
		}

		return true;
	},

	abortLocalPendingJob: function (stub) {
		// abort job currently in pending queue
		var job = null;

		if (this.internalQueue) {
			for (var key in this.internalQueue) {
				var task = this.internalQueue[key];
				if ((task.action = 'launchLocalJob') && (task.id == stub.id)) {
					job = task;
					delete this.internalQueue[key];
					break;
				}
			}
		}

		if (!job) {
			// should never happen
			this.logDebug(1, "Could not locate pending job to abort: " + stub.id);
			return;
		}

		this.logDebug(4, "Aborting local pending job: " + stub.id + ": " + stub.reason, this.safeJobLog(job));
		job.abort_reason = stub.reason;

		// determine if job needs to be 'finished' (i.e. aborted in retry delay)
		// or hasn't actually launched yet (i.e. multiplex stagger)
		if (job.log_file) {
			this.activeJobs[job.id] = job; // trick it into acceptance
			this.finishLocalJob(job);
		}
	},

	abortLocalJob: function (stub) {
		// abort locally running job on this server
		// stub should have: id, reason
		var self = this;
		var job = this.activeJobs[stub.id];
		if (!job) {
			// must be a pending job
			this.abortLocalPendingJob(stub);
			return;
		}

		var worker = this.kids[job.pid] || {};

		this.logDebug(4, "Aborting local job: " + stub.id + ": " + stub.reason, this.safeJobLog(job));
		job.abort_reason = stub.reason;

		if (worker.child) {
			// owned process
			if (worker.log_fd) { fs.closeSync(worker.log_fd); worker.log_fd = null; }

			worker.kill_timer = setTimeout(function () {
				// child didn't die, kill with prejudice
				self.logDebug(3, "Child did not exit, killing harder: " + job.pid);
				worker.child.kill('SIGKILL');
			}, this.server.config.get('child_kill_timeout') * 1000);

			// try killing nicely first
			worker.child.connected ? worker.child.disconnect() : worker.child.kill('SIGTERM');
			// try {
			// 	worker.child.connected ? worker.child.disconnect() : worker.child.kill('SIGTERM');
			// }
			// catch (e) {
			// 	this.logDebug(3, "Failed to abort job gracefully: " + stub.id , e.message)
			// }
			// if(worker.child.connected) {
			// 	worker.child.disconnect() // jobs with ipc
			// }
			// else {
			//   worker.child.kill('SIGTERM');
			// }
		}
		else {
			// detached process
			if (job.pid) {
				try { process.kill(job.pid, 'SIGTERM'); }
				catch (e) {
					this.logDebug(5, "Could not term process: " + job.pid + ", killing it.");
					try { process.kill(job.pid, 'SIGKILL'); } catch (e) { ; }
				}

				// make sure process actually exits
				setTimeout(function () {
					var ping = false;
					try { ping = process.kill(job.pid, 0); }
					catch (e) { ; }
					if (ping) {
						self.logDebug(3, "Child did not exit, killing: " + job.pid);
						try { process.kill(job.pid, 'SIGKILL'); } catch (e) { ; }
					}
				}, this.server.config.get('child_kill_timeout') * 1000);
			} // job.pid

			// assume job is finished at this point
			this.finishLocalJob(job);
		}
	},

	finishLocalJob: function (job) {
		// complete job, remove from tracking, update history
		var self = this;

		// job may already be removed
		if (!this.activeJobs[job.id]) return;

		// if aborted, copy in those params
		if (job.abort_reason) {
			job.code = 1;
			job.description = "Job Aborted: " + job.abort_reason;
			job.retries = 0;
		}

		job.complete = 1;

		this.logDebug(5, "Job completed " + (job.code ? "with error" : "successfully"), this.safeJobLog(job));

		// kill completion timer, if set
		var worker = this.kids[job.pid] || {};
		if (worker.complete_timer) {
			clearTimeout(worker.complete_timer);
			delete worker.complete_timer;
		}
		if (worker.kill_timer) {
			clearTimeout(worker.kill_timer);
			delete worker.kill_timer;
		}
		if (worker.log_fd) {
			fs.closeSync(worker.log_fd);
			delete worker.log_fd;
		}


        // if this is repeat job - put it into queue and return
		if (parseInt(job.repeat) && !job.abort_reason && !this.server.shut && !job.suspended && job.memo !== 'stop') {	
			
			if(!job.cycles) {  // initial cycle
				job.cycles = 0
				job.time_start_initial = job.time_start
				job.trend = []	
				job.error_state = 0	
				job.success_state = 0
				job.total_errors = 0
				job.retries = 0 // set retries to 0 for repeat job
			}

			job.cycles += 1
			job.uptime = Tools.timeNow() - job.time_start_initial
			job.elapsed = Tools.timeNow() - job.time_start

			let trendSize = parseInt(self.server.config.get('repeat_job_trend_size')) || 16

			if (Array.isArray(job.trend)) { // sanity, should always be array
				job.trend.push({ code: job.code, elapsed: job.elapsed })
				if (job.trend.length > trendSize) job.trend.shift()
				// calculate job stats using for current trend window
				let errCount = 0
			    let successCount = 0
				let warningCount = 0
				job.trend.forEach(e => {					
					parseInt(e.code) % 255 ? errCount += 1 : successCount += 1
					if(255 == e.code) warningCount += 1
				})
				job.error_count = errCount
				job.success_count = successCount
				job.warning_count = warningCount
				job.health = Math.round((1 - errCount/(errCount + successCount))*100)
				job.duration_avg = parseInt(job.trend.reduce((sum, obj) => sum + obj.elapsed, 0)/job.trend.length)
			}

			if(parseInt(job.code) % 255) {
				job.error_state = parseInt(job.error_state || 0 ) + 1
				job.success_state = 0
				job.total_errors = parseInt(job.total_errors || 0 ) + 1
			}
			else {
				job.success_state = parseInt(job.success_state || 0 ) + 1
				job.error_state = 0
			}

			// job.elapsed = 0
			// job.time_start = Tools.timeNow()

			delete job.complete;
			delete job.pid;
			// keep error info until next launch 
			// delete job.code; 
			// delete job.description;
			delete job.perf;
			delete job.progress;
			delete job.cpu;
			delete job.mem;

			delete this.activeJobs[job.id];
			delete this.kids[job.pid];	

			fs.stat(job.log_file, (err, stats) =>{
				let maxSize = parseInt(self.server.config.get('repeat_job_max_log')) || 65536
				if(err) { 
					self.logError(5, 'Failed to read log file stats', err.message)
				}
				// If file exceed max value truncate log file
				else if(stats.size > maxSize*2) { 
					let buff = Buffer.alloc(maxSize)
					fs.open(job.log_file, 'r', (err,fd)=>{
						if(err) {
							self.logError(5, 'Failed to open log file', err.message)
						}
						else {
							fs.read(fd, buff, 0, maxSize, stats.size - maxSize, (err, bytesRead, buffer)=>{
								fs.close(fd)
								if(err) {
									self.logError(5, 'Failed to read bytes from log file', err.message)									
								}
								else {
									fs.writeFile(job.log_file, buffer, (err) => {
										if(err) self.logError(5, 'Failed to overwrite log file', err.message)
									})									
								}
							})
						}

					})
				}
				else { // Normal cycle completion
					let props = ['cycles', 'error_count', 'success_count', 'warning_count', 'error_state', 'success_state', 'duration_avg', 'health']

					let repeatInfo = [
						'', '#', `# Job cycle completed`
						, `# Cycle elapsed in: ${Tools.getTextFromSeconds(job.elapsed, true)} | Total uptime: ${Tools.getTextFromSeconds(job.uptime, true)} | Current log size: ${job.log_file_size}`
						, `# counters: ${props.map((prop) => (prop.toUpperCase() + ': ' + job[prop] || 0 )).join(' | ')}`
						, '#', ''
					].join(os.EOL)
					
					fs.appendFile(job.log_file, repeatInfo, (err)=>{
						if(err) self.logError(5, 'Failed to append repeat info to log file', err.message)
					})
				}

			})

			// check memo if user wants to adjust delay
			let memoInfo = typeof job.memo === 'string' ? job.memo.split(':') : []
			let cmd = memoInfo[0]
			let val = parseInt(memoInfo[1])
			
			let sleepDelay = 0
			if (cmd === 'sleep' && val > 0) sleepDelay = val  // add extra delay
			if (cmd === 'interval' && val > 0) job.repeat = val // reset repeat interval

			job.when = Tools.timeNow() + parseInt(job.repeat) + sleepDelay;
			this.launchLocalJob(job);
			return;
		}

		// retry on failure, ignore warning (exit code 255)
		if (job.code > 0 && job.code < 255 && job.retries && !this.server.shut) {
			this.logError('job', "Job failed: " + job.id + " (" + job.retries + " retries remain)");

			// add blurb to job log
			var blurb = "\n# Job failed with error";
			if (job.code != 1) blurb += ' ' + job.code;
			blurb += ": " + (job.description || 'Unknown Error') + "\n";
			blurb += "# " + job.retries + " retries remain";
			if (job.retry_delay) blurb += " (" + Tools.getTextFromSeconds(job.retry_delay, true, false) + " delay)";
			blurb += "\n\n";

			fs.appendFileSync(job.log_file, blurb);

			job.retries--;

			delete job.complete;
			delete job.pid;
			delete job.code;
			delete job.description;
			delete job.perf;
			delete job.progress;
			delete job.cpu;
			delete job.mem;

			delete this.activeJobs[job.id];
			delete this.kids[job.pid];

			// optional retry delay
			if (job.retry_delay) {
				job.when = Tools.timeNow() + job.retry_delay;
			}

			this.launchLocalJob(job);
			return;
		} // retry

		// remove secrets once there are no more retries
		delete job.secret
		delete job.plug_secret
		delete job.cat_secret
		delete job.globalenv

		// if non-zero code, we expect a string description
		if (job.code != 0) {
			if (!job.description) job.description = "Unknown Error (no description provided)";
		}
		if (job.description) {
			job.description = '' + job.description;
		}

		// upload job debug log and finish job
		var dargs = Tools.getDateArgs(new Date());
		var nice_date_time = dargs.yyyy_mm_dd + ' ' + dargs.hh_mi_ss + ' (' + dargs.tz + ')';

		var footer = "\n";
		if (job.code) {
			footer += "# Job failed at " + nice_date_time + ".\n";
			footer += "# Error";
			if (job.code != 1) footer += " " + job.code;
			footer += ": " + job.description.trim() + "\n";
		}
		else {
			footer += "# Job completed successfully at " + nice_date_time + ".\n";
			if (job.description) footer += "# Description: " + job.description.trim() + "\n";
		}
		footer += "# End of log.\n";

		// append footer to log
		try { fs.appendFileSync(job.log_file, footer); }
		catch (err) {
			self.logError('job', "Failed to append to job log file: " + job.log_file + ": " + err);
		}

		// next, get job log file size
		var stats = null;
		try { stats = fs.statSync(job.log_file); }
		catch (err) {
			self.logError('job', "Failed to stat job log file: " + job.log_file + ": " + err);
		}

		// grab job log size, for e-mail
		job.log_file_size = stats.size;

		// only proceed if server isn't shutting down
		if (!self.server.shut) {
			// upload job log file async
			self.uploadJobLog(job);

			if (self.multi.manager) {
				// we're manager, finish the job locally
				self.finishJob(job);
			} // manager
			else {
				// we're a worker, signal manager to finish job via websockets
				// (this can happen parallel to job log upload)
				// self.io.emit('finish_job', job);
				self.managerSocketEmit('finish_job', job);
			} // worker

			// delete job json file (only created on manager or for detached jobs)
			fs.unlink(job.log_file.replace(/\.log$/, '.json'), function (err) { ; });
		}
		else if (self.multi.manager) {
			// server is shutting down and is manager
			// rewrite job json for recovery (so it gets pid and log_file_size)
			fs.writeFileSync(job.log_file.replace(/\.log$/, '.json'), JSON.stringify(job));
		}

		delete self.activeJobs[job.id];
		if (job.pid) delete self.kids[job.pid];
	},

	uploadJobLog: function (job, callback) {
		// upload local job log file
		// or send to storage directly if we're manager
		var self = this;
		var path = 'jobs/' + job.id + '/log.txt.gz';

		// if we're manager, upload directly to storage
		if (this.multi.manager) {
			// call storage directly

			this.logDebug(6, "Storing job log: " + job.log_file + ": " + path);

			fs.stat(job.log_file, function (err, stats) {
				// data will be a stream
				if (err) {
					var data = Buffer.from("(Empty log file)\n");
					fs.writeFileSync(job.log_file, data);
				}

				// get read stream and prepare to compress it
				var stream = fs.createReadStream(job.log_file);
				var gzip = zlib.createGzip(self.server.config.get('gzip_opts') || {});
				stream.pipe(gzip);

				self.storage.putStream(path, gzip, function (err) {
					if (err) {
						self.logError('storage', "Failed to store job log: " + path + ": " + err);
						if (callback) callback(err);
						return;
					}

					self.logDebug(9, "Job log stored successfully: " + path);

					// delete or move local log file
					if (self.server.config.get('copy_job_logs_to')) {
						var dargs = Tools.getDateArgs(Tools.timeNow());
						var dest_path = self.server.config.get('copy_job_logs_to').replace(/\/$/, '') + '/';
						if (job.event_title) dest_path += job.event_title.replace(/\W+/g, '') + '.';
						dest_path += job.id + '.' + (dargs.yyyy_mm_dd + '-' + dargs.hh_mi_ss).replace(/\W+/g, '-');
						dest_path += '.log';

						self.logDebug(9, "Moving local file: " + job.log_file + " to: " + dest_path);

						self.logger.rotate(job.log_file, dest_path, function (err) {
							if (err) {
								self.logError('file', "Failed to move local job log file: " + job.log_file + ": " + err);
								fs.unlink(job.log_file, function (err) { ; });
							}
							else {
								self.logDebug(9, "Successfully moved local job log file: " + job.log_file + ": " + dest_path);
							}
							if (callback) callback();
						});
					}
					else {
						self.logDebug(9, "Deleting local file: " + job.log_file);
						fs.unlink(job.log_file, function (err) {
							// all done
							if (err) {
								self.logError('file', "Failed to delete local job log file: " + job.log_file + ": " + err);
							}
							else {
								self.logDebug(9, "Successfully deleted local job log file: " + job.log_file);
							}
							if (callback) callback();

						}); // fs.unlink
					} // delete
				}); // storage put
			}); // read file
		} // manager
		else {
			// we're a worker, so tell manager via websockets to come get log
			// this.io.emit('fetch_job_log', job);
			if (!this.server.shut) this.managerSocketEmit('fetch_job_log', job);
			if (callback) callback();
		} // worker
	},

	fetchStoreJobLog: function (job) {
		// fetch remote job log from worker, and then store in storage
		var self = this;
		if (!this.multi.manager) return;

		var worker = this.workers[job.hostname];
		if (!worker) {
			this.logError('job', "Failed to locate worker: " + job.hostname + " for job: " + job.id);
			worker = { hostname: job.hostname }; // hail mary
		}

		// construct url to API on remote server w/auth key
		var api_url = this.getWorkerServerBaseAPIURL(worker.hostname, worker.ip) + '/app/fetch_delete_job_log';

		api_url += Tools.composeQueryString({
			path: job.log_file,
			auth: Tools.digestHex(job.log_file + this.server.config.get('secret_key'))
		});

		this.logDebug(6, "Fetching remote job log via HTTP GET: " + api_url);

		// just in case remote server has different base dir than manager
		job.log_file = this.server.config.get('log_dir') + '/jobs/' + path.basename(job.log_file);

		this.request.get(api_url, { download: job.log_file }, function (err, resp) {
			// check for error
			if (err) {
				var err_msg = "Failed to fetch job log file: " + api_url + ": " + err;
				self.logError('job', err_msg);
			}
			else if (resp.statusCode != 200) {
				var err_msg = "Failed to fetch job log file: " + api_url + ": HTTP " + resp.statusCode + " " + resp.statusMessage;
				self.logError('job', err_msg);
			}
			else {
				// success
				self.logDebug(5, "Job log was fetched successfully", api_url);

				// then call uploadJobLog again to store it (this also deletes the file)
				self.uploadJobLog(job);
			} // http success
		}); // request.get
	},

	finishJob: function (job) {
		// finish cleaning up job
		var self = this;

		if (!job.time_end) job.time_end = Tools.timeNow();
		job.elapsed = Math.max(0, job.time_end - job.time_start);

		var dargs = Tools.getDateArgs(job.time_end);

		// log success or failure
		if (job.code == 0) {
			this.logTransaction('job', "Job completed successfully: " + job.id, this.safeJobLog(job));
		}
		else {
			this.logError('job', "Job failed: " + job.id, this.safeJobLog(job));
		}

		// store latest job result in event state
		if (!this.state.jobCodes) this.state.jobCodes = {};
		this.state.jobCodes[job.event] = job.code;
		
		// store memo
		if (!this.state.jobMemos) this.state.jobMemos = {};
		this.state.jobMemos[ job.event ] = job.memo;

		// add to global activity, event log, and completed events
		var data = Tools.copyHash(job);

		// add special 'type' property for storage custom maint delete
		data.type = 'cronicle_job';

		// remove secret data before storing
		// delete job.secret
		// delete data.secret
		// delete job.local_secret

		// store job in its own record
		this.storage.enqueue(function (task, callback) {
			self.storage.put('jobs/' + job.id, data, callback);
		});

		let expires_at =  Tools.timeNow(true) + (86400 * (job.log_expire_days || this.server.config.get('job_data_expire_days')));
		this.storage.expire('jobs/' + job.id, expires_at);

		// create stub containing a small subset of the job data, for lists
		if (job.abort_reason) { job.code = 130 } // adding indicator for aborted job
		var stub = {
			id: job.id,
			code: job.code,
			event: job.event,
			category: job.category,
			plugin: job.plugin,
			hostname: job.hostname,
			time_start: job.time_start,
			elapsed: job.elapsed,
			perf: job.perf || '',
			cpu: job.cpu || {},
			mem: job.mem || {},
			log_file_size: job.log_file_size || 0,
			action: 'job_complete',
			epoch: Tools.timeNow(true),
			has_error: parseInt(job.code) % 255 > 0 ? 1 : 0,
			expires_at: (new Date(expires_at*1000)).setHours(0,0,0,0)/1000,

			event_title: job.event_title,
			category_title: job.category_title,
			plugin_title: job.plugin_title,
			memo: job.memo || '',
			arg: job.arg,
			lag: job.lag || -1
			
		};
		if (job.code) stub.description = job.description || 'Unknown Error';

        // Activity Log: log only failures, no logging for silent jobs
		if (job.code % 255 && !job.silent) self.logActivity('job_failure', { job: stub });

		// store stub in log storage
		this.storage.enqueue(function (task, callback) {
			self.storage.listUnshift('logs/events/' + job.event, stub, callback);
		});
		
		// History logging: if job is silent, log only failed jobs
		if (!job.silent || job.code % 255 ) {
			this.storage.enqueue(function (task, callback) {
				self.storage.listUnshift('logs/completed', stub, callback);
			});
		}

		// notify people
		var email_template = '';
		var to = '';
		if (job.notify_success && (job.code == 0)) {
			email_template = "conf/emails/job_success.txt";
			to = job.notify_success;
		}
		else if (job.notify_fail && (job.code != 0)) {
			email_template = "conf/emails/job_fail.txt";
			to = job.notify_fail;
		}

		if (email_template) {
			// Populate e-mail data with strings for template placeholders
			var email_data = Tools.copyHash(data);

			email_data.env = process.env;
			email_data.config = this.server.config.get();
			email_data.job_log_url = this.server.config.get('base_app_url') + this.api.config.get('base_uri') + '/app/get_job_log?id=' + job.id;
			email_data.edit_event_url = this.server.config.get('base_app_url') + '/#Schedule?sub=edit_event&id=' + job.event;
			email_data.job_details_url = this.server.config.get('base_app_url') + '/#JobDetails?id=' + job.id;
			email_data.nice_date_time = dargs.yyyy_mm_dd + ' ' + dargs.hh_mi_ss + ' (' + dargs.tz + ')';
			email_data.nice_elapsed = Tools.getTextFromSeconds(data.elapsed, false, false);
			email_data.perf = data.perf || '(No metrics provided)';
			email_data.description = (data.description || '(No description provided)').trim();
			email_data.notes = (data.notes || '(None)').trim();
			email_data.nice_log_size = Tools.getTextFromBytes(data.log_file_size || 0);
			email_data.pid = data.pid || '(Unknown)';
			email_data.status = "Success"
			if (job.code > 0) { email_data.status = "Error" }
			if (job.code == 255) { email_data.status = "Warning" }

			// compose nice mem/cpu usage info
			email_data.nice_mem = '(Unknown)';
			if (data.mem && data.mem.count) {
				var mem_avg = Math.floor(data.mem.total / data.mem.count);
				email_data.nice_mem = Tools.getTextFromBytes(mem_avg);
				email_data.nice_mem += ' (Peak: ' + Tools.getTextFromBytes(data.mem.max) + ')';
			}
			email_data.nice_cpu = '(Unknown)';
			if (data.cpu && data.cpu.count) {
				var cpu_avg = Tools.shortFloat(data.cpu.total / data.cpu.count);
				email_data.nice_cpu = '' + cpu_avg + '%';
				email_data.nice_cpu += ' (Peak: ' + Tools.shortFloat(data.cpu.max) + '%)';
			}

			// perf may be an object
			if (Tools.isaHash(email_data.perf)) email_data.perf = JSON.stringify(email_data.perf);

			// have link download log if too big
			if (data.log_file_size > 1024 * 1024 * 10) email_data.job_log_url += '&download=1';

			// construct mailer
			var mail = new PixlMail(this.server.config.get('smtp_hostname'), this.server.config.get('smtp_port') || 25);
			mail.setOptions(this.server.config.get('mail_options') || {});

			// send it
			var max_emails_per_day = this.server.config.get('max_emails_per_day') || 0;
			if (max_emails_per_day && this.state.stats.emails_sent && (this.state.stats.emails_sent >= max_emails_per_day)) {
				var err_msg = "Failed to send e-mail for job: " + job.id + ": " + to + ": " + `Maximum limit has been reached for today (${max_emails_per_day})`;
				this.logError( 'mail', err_msg, { text: raw_email } );
				this.logActivity( 'error', { description: err_msg } );
			}
			else {
				mail.send( email_template, email_data, function(err, raw_email) {
					if (err) {
						var err_msg = "Failed to send e-mail for job: " + job.id + ": " + to + ": " + err;
						self.logError( 'mail', err_msg, { text: raw_email } );
						self.logActivity( 'error', { description: err_msg } );
					}
					else {
						self.logDebug(5, "Email sent successfully for job: " + job.id, { text: raw_email } );
						self.state.stats.emails_sent = (self.state.stats.emails_sent || 0) + 1;
					}
				} );
			}
		} // mail

		// fire web hook
		var hook_data = Tools.mergeHashes(data, { action: 'job_complete' });

		// prepare nice text summary (compatible with Slack Incoming WebHooks)
		hook_data.base_app_url = this.server.config.get('base_app_url');
		hook_data.job_details_url = this.server.config.get('base_app_url') + '/#JobDetails?id=' + job.id;
		hook_data.edit_event_url = this.server.config.get('base_app_url') + '/#Schedule?sub=edit_event&id=' + job.event;

		var hook_text_templates = this.server.config.get('web_hook_text_templates') || this.defaultWebHookTextTemplates;
		var hook_action = hook_data.action;
		if (job.code != 0) hook_action = 'job_failure';
		if (job.code == 255) hook_action = 'job_warning';

		if (hook_text_templates[hook_action]) {
			hook_data.text = Tools.sub(hook_text_templates[hook_action], hook_data);

			// include web_hook_config_keys if configured
			if (this.server.config.get('web_hook_config_keys')) {
				var web_hook_config_keys = this.server.config.get('web_hook_config_keys');
				for (var idy = 0, ley = web_hook_config_keys.length; idy < ley; idy++) {
					var key = web_hook_config_keys[idy];
					hook_data[key] = this.server.config.get(key);
				}
			}

			// include web_hook_custom_data if configured
			if (this.server.config.get('web_hook_custom_data')) {
				var web_hook_custom_data = this.server.config.get('web_hook_custom_data');
				for (var key in web_hook_custom_data) hook_data[key] = web_hook_custom_data[key];
			}

			// web hook on complete
			if (job.web_hook) {

				let wh_data = Tools.mergeHashes(hook_data, {}) // copy hook_data
				delete wh_data.html // to avoid conflicts

				let wh_map = self.server.config.get('web_hooks') || {};
				let wh_config = wh_map[job.web_hook] || { url: job.web_hook }

				if (wh_config.compact) wh_data = {
					action: hook_action,
					text: hook_data.text,
					job_id: job.id,
					event_title: job.event_title,
					job_code: job.code
				}

				// check if user needs to fire webhook on error only
				if ( !(parseInt(job.code) % 255 == 0 && job.web_hook_error) ) {
					self.fireInfoHook(wh_config, wh_data, "Firing web hook for job complete: " + job.id + ": " + job.web_hook);
				}
			}  // job.webhook on completion


			if (self.server.config.get('universal_web_hook')) {
				self.fireInfoHook(self.server.config.get('universal_web_hook'), hook_data, "Firing Universal web hook for job complete")
			}

		} // yes fire hook

		// delete from worker job hash, if applicable
		var worker = this.workers[job.hostname];
		if (worker && worker.active_jobs && worker.active_jobs[job.id]) {
			delete worker.active_jobs[job.id];
		}

		// just in case job was in limbo, we can remove it now
		delete this.deadJobs[job.id];

		// delete workflow key if exist
		self.workflowKeys.delete(job.id)

		// we can clear high mem/cpu flags too, if applicable
		if (this.state.flagged_jobs) {
			delete this.state.flagged_jobs[job.id];
		}

		// update daemon stats (reset every day)
		var stats = this.state.stats;

		if (!stats.jobs_completed) stats.jobs_completed = 1;
		else stats.jobs_completed++;

		if (job.code != 0 && job.code != 255) {
			stats.jobs_failed ? stats.jobs_failed++ : stats.jobs_failed = 1
			if(! stats.errorLog) stats.errorLog  = {}
			stats.errorLog[job.event_title] = stats.errorLog[job.event_title] + 1 || 1
		}

		if (job.code == 255) {
			if (!stats.jobs_warn) stats.jobs_warn = 1;
			else stats.jobs_warn++;
		}

		if (!stats.jobs_elapsed) stats.jobs_elapsed = job.elapsed;
		else stats.jobs_elapsed += job.elapsed;

		if (!stats.jobs_log_size) stats.jobs_log_size = job.log_file_size || 0;
		else stats.jobs_log_size += (job.log_file_size || 0);

		// send updated stats to clients
		this.authSocketEmit('update', { state: this.state });

		// if event is catch_up, tickle scheduler (after some safety checks)
		// (in case it needs to launch another job right away)
		if (job.catch_up && !this.schedulerGraceTimer && !this.schedulerTicking && (dargs.sec != 59) && !job.update_event) {
			this.schedulerMinuteTick(null, true);
		}

		// chain reaction (success or error)
		if (job.chain && job.chain.length && (job.code == 0)) {
			this.chainReaction(job, job.chain);
		}
		else if (job.chain_error && job.chain_error.length && (job.code != 0) && !job.abort_reason) {
			// only fire error chain reaction if job was not manually aborted (job.abort_reason)
			this.chainReaction(job, job.chain_error);
		}


		// job can optionally update event
		if (job.update_event) {
			this.storage.listFindUpdate('global/schedule', { id: job.event }, job.update_event, function (err) {
				if (err) {
					self.logError('event', "Failed to update event: " + job.event + ": " + err);
					return;
				}

				var event_stub = Tools.mergeHashes(job.update_event, { id: job.event, title: job.event_title });

				self.logDebug(6, "Successfully updated event: " + job.event + " (" + job.event_title + ")", job.update_event);
				self.logTransaction('event_update', job.event_title, event_stub);
				self.logActivity('event_update', { event: event_stub });

				// broadcast update to all websocket clients
				self.updateClientData('schedule');
			}); // listFindUpdate
		} // job.update_event

		// check event queue if applicable
		if (job.queue) this.checkEventQueues(job.event);
	},

	getAllActiveJobs: function (inc_pending) {
		// gather all active jobs, local and remote
		var jobs = Tools.copyHash(this.activeJobs);

		// include pending jobs (i.e. stagger or retry delay) from internal queues
		if (inc_pending && this.internalQueue) {
			for (var key in this.internalQueue) {
				var task = this.internalQueue[key];
				if ((task.action == 'launchLocalJob') && task.id && !jobs[task.id]) {
					jobs[key] = Tools.mergeHashes(task, { pending: 1 });
				} // is pending job
			} // foreach queue item
		} // internalQueue

		for (var hostname in this.workers) {
			var worker = this.workers[hostname];
			if (worker.active_jobs) {
				Tools.mergeHashInto(jobs, worker.active_jobs);
			}

			if (inc_pending && worker.queue) {
				for (var key in worker.queue) {
					var task = worker.queue[key];
					if ((task.action == 'launchLocalJob') && task.id && !jobs[task.id]) {
						jobs[key] = Tools.mergeHashes(task, { pending: 1 });
					} // is pending job
				} // foreach queue item
			} // has queue
		} // foreach worker		

		return jobs;
	},

	abortAllLocalJobs: function () {
		// abort all locally running jobs for server shutdown
		// omit detached jobs
		for (var id in this.activeJobs) {
			var job = this.activeJobs[id];
			if (!job.detached) {
				this.abortLocalJob({ id: id, reason: "Shutting down server" });

				// Rewind event cursor here
				this.rewindJob(job);
			}
			else {
				// detached job, update JSON job file on disk for recovery (now with PID)
				this.logDebug(5, "Detached job is still running in the background: " + job.id + ": PID " + job.pid);
				try {
					fs.writeFileSync(job.log_file.replace(/\.log$/, '.json'), JSON.stringify(job));
				}
				catch (err) {
					this.logError('job', "Failed to write JSON job file: " + job.log_file.replace(/\.log$/, '.json') + ": " + err);
				}
			}
		}
	},

	monitorAllActiveJobs: function () {
		// monitor all active jobs, local and remote (called once per minute)
		// only a manager server should do this
		if (!this.multi.manager) return;

		var all_jobs = this.getAllActiveJobs();
		var now = Tools.timeNow();

		// keep flagged jobs in state, so will be saved periodically
		if (!this.state.flagged_jobs) this.state.flagged_jobs = {};
		var flagged_jobs = this.state.flagged_jobs;

		// iterate over all jobs
		for (var id in all_jobs) {
			var job = all_jobs[id];

			var job_memory_max = job.memory_limit || this.server.config.get('job_memory_max');
			var job_memory_sustain = job.memory_sustain || this.server.config.get('job_memory_sustain');
			var job_cpu_max = job.cpu_limit || this.server.config.get('job_cpu_max');
			var job_cpu_sustain = job.cpu_sustain || this.server.config.get('job_cpu_sustain');
			var job_log_max_size = job.log_max_size || this.server.config.get('job_log_max_size');

			// check for max run time
			if (job.timeout && (now - job.time_start >= job.timeout)) {
				this.logDebug(4, "Job has exceeded max run time and will be aborted: " + id + " (" + job.timeout + " sec)");
              
				var nice_timeout = Tools.getTextFromSeconds(job.timeout, false, false);
				this.abortJob({ id: id, reason: "Exceeded maximum run time (" + nice_timeout + ")", no_rewind: 1 });
				continue;
			} // timed out

			// monitor mem for threshold limits
			if (job_memory_max && job.mem) {
				var current = job.mem.current || 0;
				if (current > job_memory_max) {
					// job is currently exceeding memory limits
					if (!flagged_jobs[id]) flagged_jobs[id] = {};
					if (!flagged_jobs[id].mem) {
						this.logDebug(6, "Job has exceeded memory usage limit: " + id, job.mem);
						flagged_jobs[id].mem = now;
					}
					if ((now - flagged_jobs[id].mem) >= job_memory_sustain) {
						// job has exceeded memory for too long -- abort it
						var msg = "Exceeded memory limit of " + Tools.getTextFromBytes(job_memory_max);
						if (job_memory_sustain) msg += " for over " + Tools.getTextFromSeconds(job_memory_sustain, false, true);

						this.logDebug(4, "Job " + id + " is being aborted: " + msg);
						this.abortJob({ id: id, reason: msg });
						continue;
					}
				}
				else {
					// job mem is within limits - remove flag, if applicable
					if (flagged_jobs[id] && flagged_jobs[id].mem) {
						this.logDebug(6, "Job is now under the memory usage limit: " + id, job.mem);
						delete flagged_jobs[id].mem;
					}
					if (!Tools.numKeys(flagged_jobs[id])) delete flagged_jobs[id];
				}
			} // mem check

			// monitor cpu for threshold limits
			if (job_cpu_max && job.cpu) {
				var current = job.cpu.current || 0;
				if (current > job_cpu_max) {
					// job is currently exceeding cpu limits
					if (!flagged_jobs[id]) flagged_jobs[id] = {};
					if (!flagged_jobs[id].cpu) {
						this.logDebug(6, "Job has exceeded CPU usage limit: " + id, job.cpu);
						flagged_jobs[id].cpu = now;
					}
					if ((now - flagged_jobs[id].cpu) >= job_cpu_sustain) {
						// job has exceeded cpu for too long -- abort it
						var msg = "Exceeded CPU limit of " + job_cpu_max + "%";
						if (job_cpu_sustain) msg += " for over " + Tools.getTextFromSeconds(job_cpu_sustain, false, true);

						this.logDebug(4, "Job " + id + " is being aborted: " + msg);
						this.abortJob({ id: id, reason: msg });
						continue;
					}
				}
				else {
					// job cpu is within limits - remove flag, if applicable
					if (flagged_jobs[id] && flagged_jobs[id].cpu) {
						this.logDebug(6, "Job is now under the CPU usage limit: " + id, job.cpu);
						delete flagged_jobs[id].cpu;
					}
					if (!Tools.numKeys(flagged_jobs[id])) delete flagged_jobs[id];
				}
			} // cpu check

			// monitor job log file sizes
			if (job_log_max_size && job.log_file_size && (job.log_file_size > job_log_max_size)) {
				// job has exceeded log file size limit -- abort it
				var msg = "Exceeded log file size limit of " + Tools.getTextFromBytes(job_log_max_size);
				this.logDebug(4, "Job " + id + " is being aborted: " + msg);
				this.abortJob({ id: id, reason: msg });
				continue;
			}
		} // foreach job

		// monitor jobs in limbo (i.e. caused by dead servers)
		// jobs stuck in limbo for N seconds are auto-aborted
		var dead_job_timeout = this.server.config.get('dead_job_timeout');
		for (var id in this.deadJobs) {
			var job = this.deadJobs[id];
			if (now - job.time_dead >= dead_job_timeout) {
				job.complete = 1;
				job.code = 1;
				job.description = "Aborted Job: Server '" + job.hostname + "' shut down unexpectedly.";
				this.finishJob(job);

				// Rewind cursor here too
				this.rewindJob(job);
			}
		} // foreach dead job
	},

	/*

	monitorServerResources: function (callback) {
		if (this.server.config.get('use_si_monitor')) {
			this.monitorServerResourcesSi(callback); // using systeminformaiton module
		}
		else {
			this.monitorServerResourcesPs(callback);  // using ps or Get-CimInstance
		}
	},

	monitorServerResourcesSi: function (callback) { //
		var self = this;
		var now = Tools.timeNow();
		var job_startup_grace = this.server.config.get('job_startup_grace') || 5;
		this.logDebug(10, "Checking server resources: (sysinfo)");
		si.processes((data) => {

			let pids = {};
			for (let i = 0; i < data.list.length; i++) {
				let p = data.list[i]
				pids[p.pid] = {
					ppid: p.parentPid,
					cpu: p.cpu*CPU_COUNT,				
					mem: p.memRss*1024
				}
			}

			self.logDebug(10, "Raw process data:", pids);
			///-------
			// match up pids with jobs
			for (var id in self.activeJobs) {
				var job = self.activeJobs[id];

				// only match jobs that have been running for more than N seconds
				// this way we don't record cpu/mem for a process that is just starting up
				if (pids[job.pid] && (now - job.time_start >= job_startup_grace)) {
					var info = pids[job.pid];
					var cpu = info.cpu;
					var mem = info.mem;

					// also consider children of the child (up to 100 generations deep)
					var levels = 0;
					var family = {};
					family[job.pid] = 1;

					while (Tools.numKeys(family) && (++levels <= 100)) {
						for (var fpid in family) {
							for (var cpid in pids) {
								if (pids[cpid].ppid == fpid) {
									family[cpid] = 1;
									cpu += pids[cpid].cpu;
									mem += pids[cpid].mem;
								} // matched
							} // cpid loop
							delete family[fpid];
						} // fpid loop
					} // while

					if (job.cpu) {
						if (cpu < job.cpu.min) job.cpu.min = cpu;
						if (cpu > job.cpu.max) job.cpu.max = cpu;
						job.cpu.total += cpu;
						job.cpu.count++;
						job.cpu.current = cpu;
					}
					else {
						job.cpu = { min: cpu, max: cpu, total: cpu, count: 1, current: cpu };
					}

					if (job.mem) {
						if (mem < job.mem.min) job.mem.min = mem;
						if (mem > job.mem.max) job.mem.max = mem;
						job.mem.total += mem;
						job.mem.count++;
						job.mem.current = mem;
					}
					else {
						job.mem = { min: mem, max: mem, total: mem, count: 1, current: mem };
					}

					if (self.debugLevel(10)) {
						self.logDebug(10, "Active Job: " + job.pid + ": CPU: " + cpu + "%, Mem: " + Tools.getTextFromBytes(mem));
					}
				} // matched job with pid
			} // foreach job

			// grab stats for daemon pid as well
			// store in multi.data to be shared with cluster
			if (pids[process.pid]) {
				var info = pids[process.pid];
				self.multi.data.cpu = info.cpu;
				self.multi.data.mem = info.mem;
			}

			// monitor all active job log sizes
			async.eachOfSeries(self.activeJobs,
				function (job, id, callback) {
					if (job && job.log_file) {
						fs.stat(job.log_file, function (err, stats) {
							if (stats && stats.size) job.log_file_size = stats.size;
							callback();
						});
					}
					else callback();
				},
				function () {
					if (callback) { callback(); callback = null; }
				}
			); // eachOfSeries

		})

	},

	*/

	monitorServerResources: function (callback) {
		// monitor local CPU and memory for all active jobs (once per minute)
		// shell exec to get running process cpu and memory usage
		// this works on at least: OS X, Fedora, Ubuntu and CentOS
		var self = this;
		var now = Tools.timeNow();

		var defCmd = '/bin/ps -eo "ppid pid %cpu rss"' 
		var kb = 1024

		if(process.platform == 'win32') {
			//defCmd = 'powershell -c "get-cimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process | % { $_.CreatingProcessID, $_.idprocess, $_.PercentProcessorTime, ($_.WorkingSetPrivate/1024) -join \' \' }"';
			defCmd = 'wmic path Win32_PerfFormattedData_PerfProc_Process get  CreatingProcessID, idprocess, PercentProcessorTime, WorkingSetPrivate'
			var kb = 1
		}

		var cmd = this.server.config.get('ps_monitor_cmd') || defCmd;
		var job_startup_grace = this.server.config.get('job_startup_grace') || 5;

		this.logDebug(10, "Checking server resources: " + cmd);

		var finish = function (err, stdout, stderr) {
			if (err) {
				self.logError('job', "Failed to exec ps: " + err);
				if (callback) { callback(); callback = null; }
				return;
			}
			var lines = stdout.split(os.EOL);
			var pids = {};

			// process each line from ps response
			for (var idx = 0, len = lines.length; idx < len; idx++) {
				var line = lines[idx];
				if (line.match(/(\d+)\s+(\d+)\s+([\d\.]+)\s+(\d+)/)) {
					var ppid = parseInt(RegExp.$1);
					var pid = parseInt(RegExp.$2);
					var cpu = parseFloat(RegExp.$3);
					var mem = parseInt(RegExp.$4) * kb; // k to bytes
					pids[pid] = { ppid: ppid, cpu: cpu, mem: mem };
				} // good line
			} // foreach line

			self.logDebug(10, "Raw process data:", pids);

			// match up pids with jobs
			for (var id in self.activeJobs) {
				var job = self.activeJobs[id];

				// only match jobs that have been running for more than N seconds
				// this way we don't record cpu/mem for a process that is just starting up
				if (pids[job.pid] && (now - job.time_start >= job_startup_grace)) {
					var info = pids[job.pid];
					var cpu = info.cpu;
					var mem = info.mem;

					// also consider children of the child (up to 100 generations deep)
					var levels = 0;
					var family = {};
					family[job.pid] = 1;

					while (Tools.numKeys(family) && (++levels <= 100)) {
						for (var fpid in family) {
							for (var cpid in pids) {
								if (pids[cpid].ppid == fpid) {
									family[cpid] = 1;
									cpu += pids[cpid].cpu;
									mem += pids[cpid].mem;
								} // matched
							} // cpid loop
							delete family[fpid];
						} // fpid loop
					} // while

					if (job.cpu) {
						if (cpu < job.cpu.min) job.cpu.min = cpu;
						if (cpu > job.cpu.max) job.cpu.max = cpu;
						job.cpu.total += cpu;
						job.cpu.count++;
						job.cpu.current = cpu;
					}
					else {
						job.cpu = { min: cpu, max: cpu, total: cpu, count: 1, current: cpu };
					}

					if (job.mem) {
						if (mem < job.mem.min) job.mem.min = mem;
						if (mem > job.mem.max) job.mem.max = mem;
						job.mem.total += mem;
						job.mem.count++;
						job.mem.current = mem;
					}
					else {
						job.mem = { min: mem, max: mem, total: mem, count: 1, current: mem };
					}

					if (self.debugLevel(10)) {
						self.logDebug(10, "Active Job: " + job.pid + ": CPU: " + cpu + "%, Mem: " + Tools.getTextFromBytes(mem));
					}
				} // matched job with pid
			} // foreach job

			// grab stats for daemon pid as well
			// store in multi.data to be shared with cluster
			if (pids[process.pid]) {
				var info = pids[process.pid];
				self.multi.data.cpu = info.cpu;
				self.multi.data.mem = info.mem;
			}

			// monitor all active job log sizes
			async.eachOfSeries(self.activeJobs,
				function (job, id, callback) {
					if (job && job.log_file) {
						fs.stat(job.log_file, function (err, stats) {
							if (stats && stats.size) job.log_file_size = stats.size;
							callback();
						});
					}
					else callback();
				},
				function () {
					if (callback) { callback(); callback = null; }
				}
			); // eachOfSeries
		}; // finish

		var child = null;
		try {
			child = cp.exec(cmd, { timeout: 5 * 1000 }, finish);
		}
		catch (err) {
			self.logError('job', "Failed to exec ps: " + err);
			if (callback) { callback(); callback = null; }
		}
		if (child && child.pid && child.on) child.on('error', function (err) {
			self.logError('job', "Failed to exec ps: " + err);
			if (callback) { callback(); callback = null; }
		});
	},

	watchJobLog: function (args, socket) {
		// websocket request to watch live job log
		var self = this;
		var ip = socket.request.connection.remoteAddress || 'Unknown';

		// allow active or pending jobs (retry delay)
		var job = this.activeJobs[args.id];
		if (!job && this.internalQueue) {
			for (var key in this.internalQueue) {
				var task = this.internalQueue[key];
				if ((task.action = 'launchLocalJob') && (task.id == args.id)) {
					job = task;
					break;
				}
			}
		}

		if (!job) {
			// logging this as a debug (non-error) because it can happen naturally
			// if #JobDetails page is loaded just as job is completing
			self.logDebug(2, "watchJobLog: Could not locate active job: " + args.id + ", canceling watch");
			return;
		}
		if (!args.token) {
			self.logError('watchJobLog', "Missing authentication token");
			return;
		}

		// prepare to log watch
		var log_file = job.log_file;
		var log_fd = null;
		var log_stats = null;
		var log_chunk_size = 32678;
		var log_buffer = Buffer.alloc(log_chunk_size);
		var log_pos = 0;

		self.logDebug(5, "Socket client " + socket.id + " (IP: " + ip + ") now watching job log file: " + log_file);

		// open log file and locate ideal position to start from
		// (~32K from end, aligned to line boundary)
		async.series([
			function (callback) {
				// validate auth token
				var correct_token = Tools.digestHex(args.id + self.server.config.get('secret_key'));
				if (args.token != correct_token) {
					var err = new Error("Invalid authentication token (mismatched secret keys between servers?)");
					self.logError('watchJobLog', "Socket client " + socket.id + " failed to authenticate (IP: " + ip + ")");
					return callback(err);
				}

				self.logDebug(4, "watchJobLog: Socket client " + socket.id + " has authenticated via user session (IP: " + ip + ")");
				socket._pixl_auth = true;
				callback();
			},
			function (callback) {
				fs.open(log_file, 'r', function (err, fd) {
					log_fd = fd;
					callback(err);
				});
			},
			function (callback) {
				fs.fstat(log_fd, function (err, stats) {
					log_stats = stats;
					callback(err);
				});
			},
			function (callback) {
				log_pos = Math.max(0, log_stats.size - log_chunk_size);
				fs.read(log_fd, log_buffer, 0, log_chunk_size, log_pos, function (err, bytesRead, buffer) {
					if (err) return callback(err);

					if (bytesRead > 0) {
						var slice = buffer.slice(0, bytesRead);
						var text = slice.toString();
						var lines = text.split(/\n/);
						if (bytesRead == log_chunk_size) {
							// remove first line, as it is likely partial
							var line = lines.shift();
							log_pos += line.length + 1;
						}
					}

					callback();
				});
			}
		],
			function (err) {
				if (err) {
					self.logError('socket', "Could not watch job log file: " + log_file + ": " + err);
					return;
				}

				socket._pixl_log_watcher = setInterval(function () {
					// monitor log size
					if (socket._pixl_disconnected) {
						fs.close(log_fd, function () { });
						clearTimeout(socket._pixl_log_watcher);
						return;
					}

					fs.fstat(log_fd, function (err, stats) {
						if (stats && (stats.size > log_pos)) {
							// log grew, read new chunk
							fs.read(log_fd, log_buffer, 0, log_chunk_size, log_pos, function (err, bytesRead, buffer) {
								if (err) {
									self.logError('socket', "Could not read job log file: " + log_file + ": " + err);
									fs.close(log_fd, function () { });
									clearTimeout(socket._pixl_log_watcher);
									return;
								}

								if (bytesRead > 0) {
									var slice = buffer.slice(0, bytesRead);
									var text = slice.toString();
									var lines = text.split(/\n/);
									log_pos += text.length;

									if (!text.match(/\n$/)) {
										// last line is partial, must compensate
										var line = lines.pop();
										log_pos -= line.length;

										// tricky situation: single log line longer than 32K
										// in this case we gotta split it up
										if (!lines.length && (bytesRead == log_chunk_size)) {
											lines.push(line);
											log_pos += line.length;
										}
									}

									// emit lines to client
									if (lines.length && !socket._pixl_disconnected) {
										socket.emit('log_data', lines);
										//self.authSocketEmit('log_data', lines); // experiment 2
									}
								} // bytesRead
							}); // fs.read
						} // log grew
					}); // fs.fstat
				}, 250); // setInterval
			}); // async.series
	}

});
