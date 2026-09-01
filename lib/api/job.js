// Cronicle API Layer - Jobs
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const path = require('path');
const async = require('async');
const Class = require("pixl-class");
const Tools = require("pixl-tools");
const readLastLines = require('read-last-lines');
const PassThrough = require('stream').PassThrough;

module.exports = Class.create({

	getRawJobLogHeaders: function () {
		return {
			'Content-Type': 'text/plain; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
			'Pragma': 'no-cache',
			'Expires': '0'
		};
	},

	abortJobLogHTTPResponse: function (response, destination, message) {
		// Returning false from pixl-request preflight switches it to buffer mode.
		// Destroy the network response first so an incompatible/unbounded body can
		// never be accumulated in manager memory.
		if (response && response.destroy && !response.destroyed) {
			response.destroy(new Error(message || "Incompatible job-log response"));
		}
		if (destination && destination.destroy && !destination.destroyed) destination.destroy();
	},

	requireJobLogAccess: function (args, user, job, callback) {
		// Authorize against the immutable job snapshot, rather than the current
		// event (which may have been edited or deleted after the job ran).
		if (!job || !job.category || !job.target) {
			this.doError('job', "Job authorization metadata is unavailable.", callback);
			return false;
		}
		if (!this.requireCategoryPrivilege(user, job.category, callback)) return false;
		if (!this.requireGroupPrivilege(args, user, job.target, callback)) return false;
		return true;
	},

	sameFileIdentity: function (left, right) {
		return !!left && !!right &&
			(String(left.dev) == String(right.dev)) &&
			(String(left.ino) == String(right.ino));
	},

	openJobLogFile: function (file_path, callback) {
		// Validate the directory entry, open it once without following links where
		// supported, and verify that the descriptor still refers to that entry.
		// All reads below use this descriptor, never a second path lookup.
		var self = this;
		fs.lstat(file_path, function (err, before) {
			if (err) return callback(err);
			if (!before.isFile() || (before.nlink != 1)) {
				return callback(new Error("Job log is not a single-link regular file"));
			}

			var flags = fs.constants.O_RDONLY;
			if (typeof fs.constants.O_NOFOLLOW == 'number') flags |= fs.constants.O_NOFOLLOW;
			if (typeof fs.constants.O_NONBLOCK == 'number') flags |= fs.constants.O_NONBLOCK;

			fs.open(file_path, flags, function (err, fd) {
				if (err) return callback(err);
				fs.fstat(fd, function (err, opened) {
					if (err || !opened.isFile() || (opened.nlink != 1) || !self.sameFileIdentity(before, opened)) {
						return fs.close(fd, function () {
							callback(err || new Error("Job log changed while it was being opened"));
						});
					}
					callback(null, fd, opened);
				});
			});
		});
	},

	deleteJobLogIfUnchanged: function (file_path, opened) {
		// Node does not expose a portable unlink-by-descriptor operation.  Recheck
		// identity and file type immediately before deleting the fixed job slot.
		// Eliminating the final lstat/unlink window altogether would require a
		// private quarantine plus retry lifecycle (or a two-phase transfer).
		var self = this;
		fs.lstat(file_path, function (err, current) {
			if (err) return;
			if (!current.isFile() || (current.nlink != 1) || !self.sameFileIdentity(opened, current)) {
				return self.logError('file', "Refusing to delete a replaced job log: " + file_path);
			}
			fs.unlink(file_path, function (err) {
				if (err) self.logError('file', "Failed to delete fetched job log: " + file_path + ": " + err);
			});
		});
	},

	deleteJobLogAfterCompleteTransfer: function (response, source, file_path, opened, expected_size) {
		// HTTP `finish` only means the response was ended.  pixl-server also ends a
		// response after a source-stream error, so require a clean source `end` too.
		var self = this;
		var source_ended = false;
		var response_finished = false;
		var source_failed = false;
		var deleted = false;
		var maybe_delete = function () {
			if (deleted || source_failed || !source_ended || !response_finished) return;
			deleted = true;
			self.deleteJobLogIfUnchanged(file_path, opened);
		};
		source.once('error', function () { source_failed = true; });
		source.once('end', function () {
			source_ended = true;
			if ((typeof expected_size == 'number') &&
				(!source.jobLogComplete || (source.jobLogBytesRead != expected_size))) {
				source_failed = true;
			}
			maybe_delete();
		});
		response.once('finish', function () { response_finished = true; maybe_delete(); });
		response.once('close', function () {
			// A client disconnect can leave a backpressured source paused after
			// unpipe, so destroy it explicitly and let its descriptor owner close
			// after any pending positional read completes.  Never delete the log.
			if (!response_finished) {
				source_failed = true;
				if (source && source.destroy) source.destroy();
			}
		});
	},

	getMutableJobUpdates: function (updates, callback) {
		var allowed = [
			'title', 'timeout', 'repeat', 'interval', 'enabled', 'retries',
			'retry_delay', 'chain', 'chain_error', 'notify_success', 'notify_fail',
			'web_hook', 'cpu_limit', 'cpu_sustain', 'memory_limit',
			'memory_sustain', 'log_max_size', 'suspended'
		];
		if (!updates || (typeof updates != 'object') || Array.isArray(updates)) {
			this.doError('api', "Job updates must be an object.", callback);
			return false;
		}

		var clean = Object.create(null);
		var keys = Object.keys(updates);
		for (var idx = 0; idx < keys.length; idx++) {
			var key = keys[idx];
			if (allowed.indexOf(key) < 0) {
				this.doError('api', "Cannot update protected job property: " + key, callback);
				return false;
			}
			clean[key] = updates[key];
		}
		if (!this.requireValidEventData(clean, callback)) return false;
		if (!this.validateOptionalParams(clean, {
			repeat: [ /^(boolean|number)$/, /^(\d+|false)$/ ],
			interval: [ /^(boolean|number)$/, /^(\d+|false)$/ ],
			suspended: [ /^(boolean|number)$/, /^(\d+|true|false)$/ ]
		}, callback)) return false;
		return clean;
	},

	buildMutableJobStub: function (id, updates) {
		// updateLocalJob historically iterates with `for...in`, so hand it a
		// null-prototype object even if another API polluted Object.prototype.
		var stub = Object.create(null);
		stub.id = id;
		Object.keys(updates).forEach(function (key) { stub[key] = updates[key]; });
		return stub;
	},

	api_get_job_log: function (args, callback) {
		// view job log (plain text or download)
		var self = this;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(args.query, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			args.user = user;
			args.session = session;

			let key = 'jobs/' + args.query.id + '/log.txt.gz';

			self.storage.get('jobs/' + args.query.id, function (err, job) {
				if (err) {
					return callback("404 Not Found", {}, "(No log file found.)\n");
				}
				if (!self.requireJobLogAccess(args, user, job, callback)) return;

				self.storage.getStream(key, function (err, stream) {
					if (err) {
						return callback("404 Not Found", {}, "(No log file found.)\n");
					}

					let headers = self.getRawJobLogHeaders();
					headers['Content-Encoding'] = 'gzip';

					// optional download instead of view
					if (args.query.download) {
						headers['Content-Disposition'] = "attachment; filename=Cronicle-Job-Log-" + args.query.id + '.txt';
					}

					// pass stream to web server
					callback("200 OK", headers, stream);
				});
			});
		
		});

	},

	get_active_job_by_id(id) {
		// On a manager, prefer the immutable launch snapshot.  worker.active_jobs
		// is status telemetry and must not define log authorization metadata.
		let managerJob = this.getManagerJobLogSnapshot(id)
		if (managerJob) return managerJob
		if (this.multi.manager) return undefined

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

		self.openJobLogFile(filePath, (err, fd, stats) => {
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
				return fs.close(fd, function () {
					callback({ skipBytes: skipBytes, fileSize: fileSize, next: offset, dur: new Date - start })
				});
			}
	
			let bytesToRead = availableBytes
	
			if (availableBytes > maxBytes) {
				bytesToRead = maxBytes
			}
	
			let buffer = Buffer.alloc(bytesToRead);
			fs.read(fd, buffer, 0, bytesToRead, offset, (err, bytesRead) => {
				fs.close(fd, () => {
					let dur = new Date - start
					if (err) {
						return callback({ error: err.message || true, skipBytes: skipBytes, fileSize: fileSize, next: offset, dur: dur})
					}

					return callback({ data: String(buffer.subarray(0, bytesRead)), fileSize: fileSize, skipBytes: skipBytes, next: offset + bytesRead, dur: dur})
				});
			});
	
		});
	},
    
	// this is proxy between and user and logs on different nodes
	api_get_live_console: function (args, callback) {
		// runs on manager 
		const self = this;

		if (!self.requiremanager(args, callback)) return;
		self.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			args.user = user;
			args.session = session;

			//let query = args.query;
			let params = Tools.mergeHashes(args.params, args.query);

			if (!self.requireParams(params, {
				id: /^\w+$/
			}, callback)) return;

			let job = self.get_active_job_by_id(params.id)

			if (!job) return self.doError('job', "Invalid or Completed job", callback);
			if (!self.requireJobLogAccess(args, user, job, callback)) return;

			let pageSize = self.server.config.get('live_log_page_size') || 8192

			if(self.server.hostname === job.hostname) { 
				// if job is running on this server (manager), read file right away
				params.log_file = self.getJobLogFilePath(job.id, job.detached)
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

		params.log_file = self.getJobLogFilePath(job.id, job.detached)
		params.event_title = job.event_title 
		params.hostname = job.hostname

		//self.get_job_log_tail(params, callback)
		self.get_job_log_chunk(params, callback)
	},

	api_get_live_job_log_file: function (args, callback) {
		// Internal manager-to-worker raw stream.  User authorization happens on
		// the manager before it calls this endpoint.
		var self = this;
		var params = Tools.mergeHashes(args.params, args.query);
		if (!this.requireParams(params, {
			id: /^\w+$/,
			auth: /^[a-f0-9]{64}$/i
		}, callback)) return;

		var expected = Tools.digestHex(params.id + this.server.config.get('secret_key'));
		if (!this.secureCompareStrings(params.auth, expected)) {
			return callback("403 Forbidden", {}, "Authentication failure.\n");
		}

		var job = this.get_active_job_by_id(params.id);
		if (!job) return callback("404 Not Found", {}, "Completed or invalid job.\n");

		var log_file = this.getJobLogFilePath(job.id, job.detached);
		this.openJobLogFile(log_file, function (err, fd) {
			if (err) return callback("404 Not Found", {}, "Live job log is unavailable.\n");
			var headers = self.getRawJobLogHeaders();
			headers['X-Cronicle-Live-Job-Log-Protocol'] = '2';
			callback("200 OK", headers, fs.createReadStream(null, { fd: fd, autoClose: true }));
		});
	},


	api_get_live_job_log: function (args, callback) {
		// get live job job, as it is being written
		var self = this;
		var query = args.query;
		if (!this.requiremanager(args, callback)) return;

		if (!this.requireParams(query, {
			id: /^\w+$/
		}, callback)) return;

		this.loadSession(args, function (err, session, user) {
			if (err) return self.doError('session', err.message, callback);
			if (!self.requireValidUser(session, user, callback)) return;
			args.user = user;
			args.session = session;

			var job = self.get_active_job_by_id(query.id);
			if (!job) return self.doError('job', "Failed to locate job: " + query.id, callback);
			if (!self.requireJobLogAccess(args, user, job, callback)) return;
			var headers = self.getRawJobLogHeaders();
			if (query.download) {
				headers['Content-Disposition'] = "attachment; filename=Cronicle-Partial-Job-Log-" + query.id + '.txt';
			}

			if (job.hostname == self.server.hostname) {
				var log_file = self.getJobLogFilePath(job.id, job.detached);
				return self.openJobLogFile(log_file, function (err, fd) {
					if (err) return self.doError('job', "Failed to fetch job log: " + err, callback);
					callback("200 OK", headers, fs.createReadStream(null, { fd: fd, autoClose: true }));
				});
			}

			var worker = self.workers[job.hostname];
			if (!worker) return self.doError('job', "Failed to locate job server: " + job.hostname, callback);
			var api_url = self.getWorkerServerBaseAPIURL(worker.hostname, worker.ip) + '/app/get_live_job_log_file';
			api_url += Tools.composeQueryString({
				id: job.id,
				auth: Tools.digestHex(job.id + self.server.config.get('secret_key'))
			});

			var proxy = new PassThrough();
			var response_started = false;
			self.request.get(api_url, {
				download: proxy,
				headers: { 'Accept-Encoding': 'identity' },
				preflight: function (err, resp, stream) {
					var valid = !err && resp && (resp.statusCode == 200) &&
						(resp.headers['x-cronicle-live-job-log-protocol'] == '2') &&
						/^text\/plain\b/i.test(resp.headers['content-type'] || '');
					if (!valid) {
						self.abortJobLogHTTPResponse(resp, stream, "Incompatible live job-log response");
						return false;
					}
					response_started = true;
					callback("200 OK", headers, proxy);
					resp.pipe(stream);
				}
			}, function (err) {
				if (err && response_started) return proxy.destroy(err);
				if (err) {
					proxy.destroy();
					return self.doError('job', "Failed to fetch live job log: " + err.message, callback);
				}
				if (!response_started) {
					proxy.destroy();
					return self.doError('job', "Job server returned an incompatible live-log response.", callback);
				}
			});
		});
	},

	api_fetch_delete_job_log: function (args, callback) {
		// fetch and delete job log, part of finish process
		// server-to-server API, deletes log, requires secret key auth
		var self = this;
		var query = args.query;

		var id = '';
		var detached = false;

		if (('id' in query) || ('detached' in query)) {
			// Protocol v2: the manager supplies only immutable job identity.
			if (!this.requireParams(query, {
				id: /^\w+$/,
				detached: /^[01]$/,
				auth: /^[a-f0-9]{64}$/i
			}, callback)) return;
			id = query.id;
			detached = (query.detached == '1');
			if (!this.verifyJobLogFetchAuth(id, detached, query.auth)) {
				return callback("403 Forbidden", {}, "Authentication failure.\n");
			}
		}
		else {
			// Worker-first rolling upgrade compatibility.  Old managers send the
			// worker path back to it.  Accept it only when it is exactly the locally
			// derived canonical job slot; a correctly signed outside path still fails.
			if (!this.requireParams(query, { auth: /^[a-f0-9]{64}$/i }, callback)) return;
			if ((typeof query.path != 'string') || !query.path.match(/\.log$/i) ||
				(Buffer.byteLength(query.path, 'utf8') > 32768)) {
				return callback("403 Forbidden", {}, "Invalid job log path.\n");
			}
			var resolved = path.resolve(query.path);
			var filename_match = path.basename(resolved).match(/^(\w+)(-detached)?\.log$/);
			if (!filename_match) return callback("403 Forbidden", {}, "Invalid job log path.\n");
			id = filename_match[1];
			detached = !!filename_match[2];
			if (resolved != this.getJobLogFilePath(id, detached)) {
				return callback("403 Forbidden", {}, "Invalid job log path.\n");
			}
			var legacy_auth = Tools.digestHex(query.path + this.server.config.get('secret_key'));
			if (!this.secureCompareStrings(query.auth, legacy_auth)) {
				return callback("403 Forbidden", {}, "Authentication failure.\n");
			}
		}

		var log_file = this.getJobLogFilePath(id, detached);

		this.openJobLogFile(log_file, function (err, fd, opened) {
			if (err) {
				return callback("404 Not Found", {}, "Job log file is unavailable.\n");
			}

			var headers = self.getRawJobLogHeaders();
			headers['X-Cronicle-Job-Log-Protocol'] = '2';
			headers['Content-Length'] = String(opened.size);
			var descriptor = self.createJobLogDescriptorOwner(fd);
			var stream = self.createJobLogDescriptorStream(descriptor, opened.size);
			var close_descriptor = function () { descriptor.close(function () {}); };
			stream.once('end', close_descriptor);
			stream.once('error', close_descriptor);
			stream.once('close', close_descriptor);

			// Delete only after the committed number of bytes reached a clean source
			// EOF and the HTTP response completed.
			self.deleteJobLogAfterCompleteTransfer(args.response, stream, log_file, opened, opened.size);

			// stream to manager as plain text
			callback("200 OK", headers, stream);

		}); // openJobLogFile
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
					job = self.get_active_job_by_id(params.id);
					return job ? callback() : callback("NOPE");
				} ),
				function(err) {
					if (err) return self.doError('job', "Failed to locate job for log watch auth: " + params.id, callback);
					if (!self.requireJobLogAccess(args, user, job, callback)) return;

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

			// `hostname` was historically sent by the UI as a lookup hint.  Keep
			// accepting it, but never let it (or any other invariant) reach the job.
			var requested_updates = {};
			Object.keys(params).forEach(function (key) {
				if ((key != 'id') && (key != 'hostname')) requested_updates[key] = params[key];
			});
			var updates = self.getMutableJobUpdates(requested_updates, callback);
			if (updates === false) return;
			var stub = self.buildMutableJobStub(params.id, updates);

			var result = self.updateJob(stub);
			if (!result) return self.doError('job', "Failed to update job.", callback);

			self.logTransaction('job_update', params.id, self.getClientInfo(args, stub));

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

			var updates = self.getMutableJobUpdates(params.updates, callback);
			if (updates === false) return;
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
				var stub = self.buildMutableJobStub(job.id, updates);
				var result = self.updateJob(stub);
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
					
					let params = job.params || {}
					let visibleParams = {} 
					if(params.cols) visibleParams.cols = params.cols 
					if(params.rows) visibleParams.rows = params.rows
					if(params.lang) visibleParams.lang = params.lang
					
					job.params = visibleParams; // do not expose params on UI
					if(job.stdin_script) delete job.stdin_script

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
