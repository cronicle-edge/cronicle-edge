// Cronicle API Layer - Jobs
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const async = require('async');
const Class = require("pixl-class");
const Tools = require("pixl-tools");
const readLastLines = require('read-last-lines');

module.exports = Class.create({

	api_get_job_log: function (args, callback) {
		// view job log (plain text or download)
		// client API, no auth
		var self = this;

		if (!this.requireParams(args.query, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {

			if(self.server.config.get('protect_job_log')) {
				if (err) return self.doError('session', err.message, callback);
				if (!self.requireValidUser(session, user, callback)) return;
			}

			let key = 'jobs/' + args.query.id + '/log.txt.gz';

			self.storage.getStream(key, function (err, stream) {
				if (err) {
					return callback("404 Not Found", {}, "(No log file found.)\n");
				}
	
				let headers = {
					'Content-Type': "text/plain; charset=utf-8",
					'Content-Encoding': "gzip"
				};
	
				// optional download instead of view
				if (args.query.download) {
					headers['Content-disposition'] = "attachment; filename=Cronicle-Job-Log-" + args.query.id + '.txt';
				}
	
				// pass stream to web server
				callback("200 OK", headers, stream);
			});
		
		});

	},

	get_active_job_by_id(id) {

		let activeJobs = this.getAllActiveJobs(true)
		if (activeJobs[id]) return activeJobs[id]
		// deep scan for queued jobs
		for (let key in activeJobs) {
			if (activeJobs[key].id === id) return activeJobs[key]
		}
		return undefined
	},

	// get log tail of active job (while log is stored on fs). Local    
	// get_job_log_tail(params, callback) {
	// 	let tailSize = parseInt(params.tailSize) || 80;
	// 	let log_file = params.log_file

	// 	readLastLines.read(log_file, tailSize)
	// 	.then(lines => callback({ data: lines, event_title: params.event_title, hostname: params.hostname }))
	// 	.catch(e => { return self.doError('log', `Failed to read log file: ${log_file}`, callback) })

	// },

	// this is efficient replacement for get_job_log_tail. Just reads new bytes from offset
	get_job_log_chunk(params, callback) {

		const self = this;
	
		let start = new Date
		let filePath =  params.log_file
		let offset = parseInt(params.offset) || 0
		let maxBytes = parseInt(params.max_bytes) || self.server.config.get('live_log_page_size') || 8192

		if(!filePath) return self.doError('log', 'Missing log_file parameter', callback)

		fs.stat(filePath, (err, stats) => {
			if (err) {
			   return  callback({ error: err.message || true, dur: new Date - start, next: offset })
			}
	
			let fileSize = stats.size;
			let skipBytes = 0;
	
			// if we can't read file to the end, just read max bytes from the end, skipping some bytes in the middle
			if(fileSize - offset > maxBytes) {
				skipBytes = fileSize - maxBytes - offset
				offset = fileSize - maxBytes
			}
	
			let availableBytes = fileSize - offset
	
			// if offset exceeds file size, return right away
			if (availableBytes < 1) {
				return callback({ skipBytes: skipBytes, fileSize: fileSize, next: offset, dur: new Date - start })
			}
	
			let bytesToRead = availableBytes
	
			if (availableBytes > maxBytes) {
				bytesToRead = maxBytes
			}
	
			fs.open(filePath, 'r', (err, fd) => {
	
				if (err) {
					return callback({ error: err.message || true, skipBytes: skipBytes, fileSize: fileSize, next: offset, dur: new Date - start, })
				}
	
				let buffer = Buffer.alloc(bytesToRead);
				fs.read(fd, buffer, 0, bytesToRead, offset, (err, bytesRead, buffer) => {
	
					fs.close(fd, () => {
						let dur = new Date - start
						if (err) {
							return callback({ error: err.message || true, skipBytes: skipBytes, fileSize: fileSize, next: offset, dur: dur})
						}
	
						return callback({ data: String(buffer), fileSize: fileSize, skipBytes: skipBytes, next: offset + bytesRead, dur: dur})    
					
					}); 
					 
				});
			});
	
		});
	},
    
	// this is proxy between and user and logs on different nodes
	api_get_live_console: async function (args, callback) {
		// runs on manager 
		const self = this;

		self.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requiremanager(args, callback)) return;
			if (!self.requireValidUser(session, user, callback)) return;			

			//let query = args.query;
			let params = Tools.mergeHashes(args.params, args.query);

			if (!self.requireParams(params, {
				id: /^\w+$/
			}, callback)) return;

			let job = self.get_active_job_by_id(params.id)

			if (!job) return self.doError('job', "Invalid or Completed job", callback);

			let pageSize = self.server.config.get('live_log_page_size') || 8192

			if(self.server.hostname === job.hostname) { 
				// if job is running on this server (manager), read file right away
        params.log_file = job.log_file
			  params.event_title = job.event_title 
        params.hostname = job.hostname
        params.max_bytes = params.download ? pageSize*16 : pageSize
				self.logDebug(10, "log", `Reading local log file (${job.log_file} on ${job.hostname})`)
				return self.get_job_log_chunk(params, callback)
			}
			else {  // otherwise request remote node
				let port = self.server.config.get('WebServer').http_port;
				let tailUrl = `http://${job.hostname}:${port}/api/app/get_live_log_chunk` //?id=${job.id}
				// let tailSize = parseInt(params.tail) || 80;
				let offset = parseInt(params.offset) || 0;
				let maxBytes = params.download ? pageSize*16 : pageSize
				let auth = Tools.digestHex(params.id + self.server.config.get('secret_key'))
				let reqParams = { id: job.id,  auth: auth, offset: offset, max_bytes: maxBytes }  // download: params.download || 0, tail: tailSize,
				self.logDebug(10, "log", "Reading remote log file", reqParams )	
				self.request.json(tailUrl, reqParams, (err, resp, data) => {
					if (err) return self.doError('job', "Failed to fetch live job log: " + err.message, callback);
					data.hostname = job.hostname;
					data.event_title = job.event_title;
					callback(data);
				});

			}

		});
	},
    
	// manager node should call this api and return result to end user
	// this is internal api and shouldn't (can't) be called by user
	api_get_live_log_chunk: function (args, callback) {

		const self = this;
		let params = Tools.mergeHashes(args.params, args.query);

		if (!this.requireParams(params, {
			id: /^\w+$/,
			auth: /^\w+$/
		}, callback)) return;

		if (params.auth != Tools.digestHex(params.id + self.server.config.get('secret_key'))) {
			return callback("403 Forbidden", {}, "Authentication failure.\n");
		}	

		let job = self.get_active_job_by_id(params.id)

		if(!job) {
			return callback("404 Not Found", {}, "Completed or Invalid job")
		}

		params.log_file= job.log_file
		params.event_title = job.event_title 
		params.hostname = job.hostname

		//self.get_job_log_tail(params, callback)
		self.get_job_log_chunk(params, callback)
	},


	api_get_live_job_log: function (args, callback) {
		// get live job job, as it is being written
		// client API, no auth
		var self = this;
		var query = args.query;

		if (!this.requireParams(query, {
			id: /^\w+$/
		}, callback)) return;

		job = this.activeJobs[query.id] || {};

		// see if log file exists on this server
		// var log_file = this.server.config.get('log_dir') + '/jobs/' + query.id + '.log';
		var log_file = this.server.config.get('log_dir') + '/jobs/' + query.id + (job.detached ? '-detached' : '') + '.log';

		fs.stat(log_file, function (err, stats) {
			if (err) {
				return self.doError('job', "Failed to fetch job log: " + err, callback);
			}

			var headers = { 'Content-Type': "text/html; charset=utf-8" };

			// optional download instead of view
			if (query.download) {
				headers['Content-disposition'] = "attachment; filename=Cronicle-Partial-Job-Log-" + query.id + '.txt';
			}

			// get readable stream to file
			var stream = fs.createReadStream(log_file);

			// stream to client as plain text
			callback("200 OK", headers, stream);
		});
	},

	api_fetch_delete_job_log: function (args, callback) {
		// fetch and delete job log, part of finish process
		// server-to-server API, deletes log, requires secret key auth
		var self = this;
		var query = args.query;

		if (!this.requireParams(query, {
			path: /^[\w\-\.\/\\\:]+\.log$/,
			auth: /^\w+$/
		}, callback)) return;

		if (query.auth != Tools.digestHex(query.path + this.server.config.get('secret_key'))) {
			return callback("403 Forbidden", {}, "Authentication failure.\n");
		}

		var log_file = query.path;

		fs.stat(log_file, function (err, stats) {
			if (err) {
				return callback("404 Not Found", {}, "Log file not found: " + log_file + ".\n");
			}

			var headers = { 'Content-Type': "text/plain" };

			// get readable stream to file
			var stream = fs.createReadStream(log_file);

			// stream to client as plain text
			callback("200 OK", headers, stream);

			args.response.on('finish', function () {
				// only delete local log file once log is COMPLETELY sent
				self.logDebug(4, "Deleting log file: " + log_file);

				fs.unlink(log_file, function (err) {
					// ignore error
				});

			}); // response finish

		}); // fs.stat
	},

	api_get_log_watch_auth: function (args, callback) {
		// generate auth token for watching live job log stream
		// (websocket to target server which may be a worker, hence might not have storage)
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			args.user = user;
			args.session = session;

			var job = null;

			// due to a race condition, the job may not be registered yet
			async.retry( { times: 20, interval: 250 },
				async.ensureAsync( function(callback) {
					job = self.findJob(params);
					return job ? callback() : callback("NOPE");
				} ),
				function(err) {
					if (err) return self.doError('job', "Failed to locate job for log watch auth: " + params.id, callback);
					if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
					if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

					// generate token
					var token = Tools.digestHex(params.id + self.server.config.get('secret_key'));

					callback({ code: 0, token: token });
				}
			); // async.retry
		});
	},

	api_update_job: function (args, callback) {
		// update running job
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_events", callback)) return;

			args.user = user;
			args.session = session;

			var job = self.findJob(params);
			if (!job) return self.doError('job', "Failed to locate job: " + params.id, callback);
			if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
			if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

			var result = self.updateJob(params);
			if (!result) return self.doError('job', "Failed to update job.", callback);

			self.logTransaction('job_update', params.id, self.getClientInfo(args, params));

			callback({ code: 0 });
		});
	},

	api_update_jobs: function (args, callback) {
		// update multiple running jobs, search based on criteria (plugin, category, event)
		// stash updates in 'updates' key
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "edit_events", callback)) return;

			args.user = user;
			args.session = session;

			var updates = params.updates;
			delete params.updates;

			var all_jobs = self.getAllActiveJobs(true);
			var jobs_arr = [];
			for (var key in all_jobs) {
				jobs_arr.push(all_jobs[key]);
			}
			var jobs = Tools.findObjects(jobs_arr, params);
			var count = 0;

			for (var idx = 0, len = jobs.length; idx < len; idx++) {
				var job = jobs[idx];
				if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;
			}

			for (var idx = 0, len = jobs.length; idx < len; idx++) {
				var job = jobs[idx];
				var result = self.updateJob(Tools.mergeHashes(updates, { id: job.id }));
				if (result) {
					count++;
					self.logTransaction('job_update', job.id, self.getClientInfo(args, updates));
				}
			} // foreach job

			callback({ code: 0, count: count });
		});
	},

	api_abort_job: function (args, callback) {
		// abort running job
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

			var job = self.findJob(params);
			if (!job) return self.doError('job', "Failed to locate job: " + params.id, callback);
			if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
			if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

			var reason = '';
			if (user.key) {
				// API Key
				reason = "Manually aborted by API Key: " + user.key + " (" + user.title + ")";
			}
			else {
				reason = "Manually aborted by user: " + user.username;
			}

			var result = self.abortJob({
				id: params.id,
				reason: reason,
				no_rewind: 1 // don't rewind cursor for manually aborted jobs
			});
			if (!result) return self.doError('job', "Failed to abort job.", callback);

			callback({ code: 0 });
		});
	},

	api_abort_jobs: function (args, callback) {
		// abort multiple running jobs, search based on criteria (plugin, category, event)
		// by default this WILL rewind catch_up events, unless 'no_rewind' is specified
		// this will NOT abort any detached jobs
		var self = this;
		var params = args.params;
		if (!this.requiremanager(args, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			if (!self.requirePrivilege(user, "abort_events", callback)) return;

			args.user = user;
			args.session = session;

			var reason = '';
			if (user.key) {
				// API Key
				reason = "Manually aborted by API Key: " + user.key + " (" + user.title + ")";
			}
			else {
				reason = "Manually aborted by user: " + user.username;
			}

			var no_rewind = params.no_rewind || 0;
			delete params.no_rewind;

			var all_jobs = self.getAllActiveJobs(true);
			var jobs_arr = [];
			for (var key in all_jobs) {
				jobs_arr.push(all_jobs[key]);
			}
			var jobs = Tools.findObjects(jobs_arr, params);
			var count = 0;

			for (var idx = 0, len = jobs.length; idx < len; idx++) {
				var job = jobs[idx];
				if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;
			}

			for (var idx = 0, len = jobs.length; idx < len; idx++) {
				var job = jobs[idx];
				if (!job.detached) {
					var result = self.abortJob({
						id: job.id,
						reason: reason,
						no_rewind: no_rewind
					});
					if (result) count++;
				}
			} // foreach job

			callback({ code: 0, count: count });
		});
	},

	api_get_job_details: function (args, callback) {
		// get details for completed job
		// need_log: will fail unless job log is also in storage
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			args.user = user;
			args.session = session;

			// job log must be available for this to work
			self.storage.head('jobs/' + params.id + '/log.txt.gz', function (err, info) {
				if (err && params.need_log) {
					return self.doError('job', "Failed to fetch job details: " + err, callback);
				}

				// now fetch job details
				self.storage.get('jobs/' + params.id, function (err, job) {
					if (err) {
						return self.doError('job', "Failed to fetch job details: " + err, callback);
					}

					if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
					if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

					delete job.params; // do not expose params on UI

					callback({ code: 0, job: job });
				}); // job get
			}); // log head
		}); // session
	},

	api_get_job_status: function (args, callback) {
		// get details for job in progress, or completed job
		// can be used for polling for completion, look for `complete` flag
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			args.user = user;
			args.session = session;

			// check live jobs first
			var all_jobs = self.getAllActiveJobs();
			var job = all_jobs[params.id];
			if (job) {
				if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

				return callback({
					code: 0,
					job: Tools.mergeHashes(job, {
						elapsed: Tools.timeNow() - job.time_start
					})
				});
			} // found job

			// TODO: Rare but possible race condition here...
			// worker server may have removed job from activeJobs, and synced with manager, 
			// but before manager created the job record

			// no good?  see if job completed...
			self.storage.get('jobs/' + params.id, function (err, job) {
				if (err) {
					return self.doError('job', "Failed to fetch job details: " + err, callback);
				}

				if (!self.requireCategoryPrivilege(user, job.category, callback)) return;
				if (!self.requireGroupPrivilege(args, user, job.target, callback)) return;

				callback({ code: 0, job: job });
			}); // job get
		}); // session
	},

	api_delete_job: function (args, callback) {
		// delete all files for completed job
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(params, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireAdmin(session, user, callback)) return;

			args.user = user;
			args.session = session;

			// fetch job details
			self.storage.get('jobs/' + params.id, function (err, job) {
				if (err) {
					return self.doError('job', "Failed to fetch job details: " + err, callback);
				}

				var stub = {
					action: 'job_delete',
					id: job.id,
					event: job.event
				};

				async.series(
					[
						function (callback) {
							// update event history
							// ignore error as this may fail for a variety of reasons
							self.storage.listFindReplace('logs/events/' + job.event, { id: job.id }, stub, function (err) { callback(); });
						},
						function (callback) {
							// update global history
							// ignore error as this may fail for a variety of reasons
							self.storage.listFindReplace('logs/completed', { id: job.id }, stub, function (err) { callback(); });
						},
						function (callback) {
							// delete job log
							// ignore error as this may fail for a variety of reasons
							self.storage.delete('jobs/' + job.id + '/log.txt.gz', function (err) { callback(); });
						},
						function (callback) {
							// delete job details
							// this should never fail
							self.storage.delete('jobs/' + job.id, callback);
						}
					],
					function (err) {
						// check for error
						if (err) {
							return self.doError('job', "Failed to delete job: " + err, callback);
						}

						// add note to admin log
						self.logActivity('job_delete', stub, args);

						// log transaction
						self.logTransaction('job_delete', job.id, self.getClientInfo(args));

						// and we're done
						callback({ code: 0 });
					}
				); // async.series
			}); // job get
		}); // session
	},

	api_get_active_jobs: function (args, callback) {
		// get all active jobs in progress
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requiremanager(args, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;

			// make a copy of active job, remove .params property since it might contain key info
			let activeJobs = JSON.parse(JSON.stringify(self.getAllActiveJobs(true)));
			for (let id in activeJobs) {
				delete activeJobs[id].params
			}

			return callback({
				code: 0,
				jobs: activeJobs
			});
		}); // session
	}

});
