// Cronicle Server Communication Layer
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const cp = require('child_process');
const os = require('os')
const SocketIO = require('socket.io');
const SocketIOClient = require('socket.io-client');

const Class = require("pixl-class");
const Tools = require("pixl-tools");

module.exports = Class.create({

	workers: null,
	sockets: null,
	
	setupCluster: function() {
		// establish communication channel with all workers
		var self = this;
		
		// workers are servers the manager can send jobs to
		this.workers = {};
		
		// we're a worker too (but no socket needed)
		this.workers[ this.server.hostname ] = {
			manager: 1,
			hostname: this.server.hostname
		};
		
		// add any registered workers
		this.storage.listGet( 'global/servers', 0, 0, function(err, servers) {
			if (err) servers = [];
			for (var idx = 0, len = servers.length; idx < len; idx++) {
				var server = servers[idx];
				self.addServer( server );
			}
		} );
	},
	
	addServer: function(server, args) {
		// add new server to cluster
		var self = this;
		if (this.workers[ server.hostname ]) return;
		
		this.logDebug(5, "Adding worker to cluster: " + server.hostname + " (" + (server.ip || 'n/a') + ")");
		
		var worker = {
			hostname: server.hostname,
			ip: server.ip || ''
		};
		
		// connect via socket.io
		this.connectToworker(worker);
		
		// add worker to cluster
		this.workers[ worker.hostname ] = worker;
		
		// notify clients of the server change
		this.authSocketEmit( 'update', { servers: this.getAllServers() } );
		
		// log activity for new server
		this.logActivity( 'server_add', { hostname: worker.hostname, ip: worker.ip || '' }, args );
	},
	
	connectToworker: function(worker) {
		// establish communication with worker via socket.io
		var self = this;
		var port = this.server.config.get('remote_server_port') || this.web.config.get('http_port');
		
		var url = '';
		if (this.server.config.get('server_comm_use_hostnames')) {
			url = 'http://' + worker.hostname + ':' + port;
		}
		else {
			url = 'http://' + (worker.ip || worker.hostname) + ':' + port;
		}
		
		this.logDebug(8, "Connecting to worker via socket.io: " + url);

		let socket_io_path = "/socket.io" // default
		let base_path = String(this.server.config.get('base_path') || '').trim()
		if ((/^\/\w+$/i).test(base_path)) socket_io_path = base_path + "/socket.io"
		
		var socket = new SocketIOClient( url, {
			multiplex: false,
			forceNew: true,
			reconnection: false,
			// reconnectionDelay: 1000,
			// reconnectionDelayMax: 1000,
			// reconnectionDelayMax: this.server.config.get('manager_ping_freq') * 1000,
			// reconnectionAttempts: Infinity,
			// randomizationFactor: 0,
			timeout: 5000,
			path: socket_io_path
		} );
		
		socket.on('connect', function() {
			self.logDebug(6, "Successfully connected to worker: " + worker.hostname);
			
			var now = Tools.timeNow(true);
			var token = Tools.digestHex( self.server.hostname + now + self.server.config.get('secret_key') );
			
			// authenticate server-to-server with time-based token
			socket.emit( 'authenticate', {
				token: token,
				now: now,
				manager_hostname: self.server.hostname
			} );
			
			// remove disabled flag, in case this is a reconnect
			if (worker.disabled) {
				delete worker.disabled;
				self.logDebug(5, "Marking worker as enabled: " + worker.hostname);
				
				// log activity for this
				self.logActivity( 'server_enable', { hostname: worker.hostname, ip: worker.ip || '' } );
				
				// notify clients of the server change
				self.authSocketEmit( 'update', { servers: self.getAllServers() } );
			} // disabled
			
			// reset reconnect delay
			delete worker.socketReconnectDelay;
		} );
		
		/*socket.on('reconnectingDISABLED', function(err) {
			self.logDebug(6, "Reconnecting to worker: " + worker.hostname);
			
			// mark worker as disabled to avoid sending it new jobs
			if (!worker.disabled) {
				worker.disabled = true;
				self.logDebug(5, "Marking worker as disabled: " + worker.hostname);
				
				// notify clients of the server change
				self.authSocketEmit( 'update', { servers: self.getAllServers() } );
				
				// if worker had active jobs, move them to limbo
				if (worker.active_jobs) {
					for (var id in worker.active_jobs) {
						self.logDebug(5, "Moving job to limbo: " + id);
						self.deadJobs[id] = worker.active_jobs[id];
						self.deadJobs[id].time_dead = Tools.timeNow(true);
					}
					delete worker.active_jobs;
				}
			} // not disabled yet
		} );*/
		
		socket.on('disconnect', function() {
			if (!socket._pixl_disconnected) {
				self.logError('server', "worker disconnected unexpectedly: " + worker.hostname);
				self.reconnectToworker(worker);
			}
			else {
				self.logDebug(5, "worker disconnected: " + worker.hostname, socket.id);
			}
		} );
		socket.on('error', function(err) {
			self.logError('server', "worker socket error: " + worker.hostname + ": " + err);
		} );
		socket.on('connect_error', function(err) {
			self.logError('server', "worker connection failed: " + worker.hostname + ": " + err);
			if (!socket._pixl_disconnected) self.reconnectToworker(worker);
		} );
		socket.on('connect_timeout', function() {
			self.logError('server', "worker connection timeout: " + worker.hostname);
		} );
		/*socket.on('reconnect_error', function(err) {
			self.logError('server', "worker reconnection failed: " + worker.hostname + ": " + err);
		} );
		socket.on('reconnect_failed', function() {
			self.logError('server', "worker retries exhausted: " + worker.hostname);
		} );*/
		
		// Custom commands:
		
		socket.on('status', function(status) {
			self.logDebug(10, "Got status from worker: " + worker.hostname, status);
			Tools.mergeHashInto( worker, status );
			self.checkServerClock(worker);
			self.checkServerJobs(worker);
			
			// sanity check (should never happen)
			if (worker.manager) self.managerConflict(worker);
		} );
		
		socket.on('finish_job', function(job) {
			self.finishJob( job );
		} );
		
		socket.on('fetch_job_log', function(job) {
			self.fetchStoreJobLog( job );
		} );
		
		socket.on('auth_failure', function(data) {
			var err_msg = "Authentication failure, cannot add worker: " + worker.hostname + " ("+data.description+")";
			self.logError('server', err_msg);
			self.logActivity('error', { description: err_msg } );
			self.removeServer( worker );
		} );
		
		worker.socket = socket;
	},
	
	reconnectToworker: function(worker) {
		// reconnect to worker after socket error
		var self = this;
		
		// mark worker as disabled to avoid sending it new jobs
		if (!worker.disabled) {
			worker.disabled = true;
			self.logDebug(5, "Marking worker as disabled: " + worker.hostname);
			
			// log activity for this
			self.logActivity( 'server_disable', { hostname: worker.hostname, ip: worker.ip || '' } );
			
			// notify clients of the server change
			self.authSocketEmit( 'update', { servers: self.getAllServers() } );
			
			// if worker had active jobs, move them to limbo
			if (worker.active_jobs) {
				for (var id in worker.active_jobs) {
					self.logDebug(5, "Moving job to limbo: " + id);
					self.deadJobs[id] = worker.active_jobs[id];
					self.deadJobs[id].time_dead = Tools.timeNow(true);
				}
				delete worker.active_jobs;
			}
		} // not disabled yet
		
		// slowly back off retries to N sec to avoid spamming the logs too much
		if (!worker.socketReconnectDelay) worker.socketReconnectDelay = 0;
		if (worker.socketReconnectDelay < this.server.config.get('manager_ping_freq')) worker.socketReconnectDelay++;
		
		worker.socketReconnectTimer = setTimeout( function() {
			delete worker.socketReconnectTimer;
			if (!self.server.shut) {
				self.logDebug(6, "Reconnecting to worker: " + worker.hostname);
				self.connectToworker(worker);
			}
		}, worker.socketReconnectDelay * 1000 );
	},
	
	checkServerClock: function(worker) {
		// make sure worker clock is close to ours
		if (!worker.clock_drift) worker.clock_drift = 0;
		var now = Tools.timeNow();
		var drift = Math.abs( now - worker.epoch );
		
		if ((drift >= 10) && (worker.clock_drift < 10)) {
			var err_msg = "Server clock is " + Tools.shortFloat(drift) + " seconds out of sync: " + worker.hostname;
			this.logError('server', err_msg);
			this.logActivity('error', { description: err_msg } );
		}
		
		worker.clock_drift = drift;
	},
	
	checkServerJobs: function(worker) {
		// remove any worker jobs from limbo, if applicable
		if (worker.active_jobs) {
			for (var id in worker.active_jobs) {
				if (this.deadJobs[id]) {
					this.logDebug(5, "Taking job out of limbo: " + id);
					delete this.deadJobs[id];
				}
			}
		}
	},
	
	removeServer: function(server, args) {
		// remove server from cluster
		var worker = this.workers[ server.hostname ];
		if (!worker) return;
		
		this.logDebug(5, "Removing worker from cluster: " + worker.hostname + " (" + (worker.ip || 'n/a') + ")");
		
		// Deal with active jobs that were on the lost server
		// Stick them in limbo with a short timeout
		if (worker.active_jobs) {
			for (var id in worker.active_jobs) {
				this.logDebug(5, "Moving job to limbo: " + id);
				this.deadJobs[id] = worker.active_jobs[id];
				this.deadJobs[id].time_dead = Tools.timeNow(true);
			}
			delete worker.active_jobs;
		}
		
		if (worker.socket) {
			worker.socket._pixl_disconnected = true;
			worker.socket.off('disconnect');
			worker.socket.disconnect();
			delete worker.socket;
		}
		if (worker.socketReconnectTimer) {
			clearTimeout( worker.socketReconnectTimer );
			delete worker.socketReconnectTimer;
		}
		
		delete this.workers[ worker.hostname ];
		
		// notify clients of the server change
		this.authSocketEmit( 'update', { servers: this.getAllServers() } );
		
		// log activity for lost server
		this.logActivity( 'server_remove', { hostname: worker.hostname }, args );
	},
	
	startSocketListener: function() {
		// start listening for websocket connections
		this.numSocketClients = 0;
		this.sockets = {};

		let socket_io_path = "/socket.io" // default
		let base_path = String(this.server.config.get('base_path') || '').trim()
		if ((/^\/\w+$/i).test(base_path)) socket_io_path = base_path + "/socket.io"

		let io = this.io = SocketIO({ serveClient: false, path: socket_io_path });
		
		if (this.web.listeners) {
			// modern pixl-server-web
			this.web.listeners.forEach( function(listener) {
				io.attach( listener );
			} );
		}
		else {
			// legacy pixl-server-web
			this.io.attach( this.web.http );
			if (this.web.https) this.io.attach( this.web.https );
		}
		
		this.io.on('connection', this.handleNewSocket.bind(this) );
	},
	
	handleNewSocket: function(socket) {
		// handle new socket connection from socket.io
		// this could be from a web browser, or a server-to-server conn
		var self = this;
		var ip = socket.request.connection.remoteAddress || socket.client.conn.remoteAddress || 'Unknown';
		
		socket._pixl_auth = false;
		
		this.numSocketClients++;
		this.sockets[ socket.id ] = socket;
		this.logDebug(5, "New socket.io client connected: " + socket.id + " (IP: " + ip + ")");
		
		socket.on('authenticate', function(params) {
			// client is trying to authenticate
			if (params.manager_hostname && params.now && params.token) {
				// manager-to-worker connection (we are the worker)
				var correct_token = Tools.digestHex( params.manager_hostname + params.now + self.server.config.get('secret_key') );
				if (params.token != correct_token) {
					socket.emit( 'auth_failure', { description: "Secret Keys do not match." } );
					return;
				}
				/*if (Math.abs(Tools.timeNow() - params.now) > 60) {
					socket.emit( 'auth_failure', { description: "Server clocks are too far out of sync." } );
					return;
				}*/
				
				self.logDebug(4, "Socket client " + socket.id + " has authenticated via secret key (IP: "+ip+")");
				socket._pixl_auth = true;
				socket._pixl_manager = true;
				
				// force multi-server init (quick startup: to skip waiting for the tock)
				self.logDebug(3, "manager server is: " + params.manager_hostname);
				
				// set some flags
				self.multi.cluster = true;
				self.multi.managerHostname = params.manager_hostname;
				self.multi.managerIP = ip;
				self.multi.manager = false;
				self.multi.lastPingReceived = Tools.timeNow(true);
				
				if (!self.multi.worker) self.goworker();
				
				// need to recheck this
				self.checkmanagerEligibility();
			} // secret_key
			else {
				// web client to server connection
				self.storage.get( 'sessions/' + params.token, function(err, data) {
					if (err) {
						self.logError('socket', "Socket client " + socket.id + " failed to authenticate (IP: "+ip+")");
						socket.emit( 'auth_failure', { description: "Session not found." } );
					}
					else {
						self.logDebug(4, "Socket client " + socket.id + " has authenticated via user session (IP: "+ip+")");
						socket._pixl_auth = true;
					}
				} );
			}
		} );
		
		socket.on('launch_job', function(job) {
			// launch job (server-to-server comm)
			if (socket._pixl_manager) self.launchLocalJob( job );
		} );
		
		socket.on('abort_job', function(stub) {
			// abort job (server-to-server comm)
			if (socket._pixl_manager) self.abortLocalJob( stub );
		} );
		
		socket.on('update_job', function(stub) {
			// update job (server-to-server comm)
			if (socket._pixl_manager) self.updateLocalJob( stub );
		} );
		
		socket.on('restart_server', function(args) {
			// restart server (server-to-server comm)
			if (socket._pixl_manager) self.restartLocalServer(args);
		} );
		
		socket.on('shutdown_server', function(args) {
			// shut down server (server-to-server comm)
			if (socket._pixl_manager) self.shutdownLocalServer(args);
		} );
		
		socket.on('watch_job_log', function(args) {
			// tail -f job log
			self.watchJobLog(args, socket);
		} );
		
		socket.on('groups_changed', function(args) {
			// recheck manager server eligibility
			self.logDebug(4, "Server groups have changed, rechecking manager eligibility");
			self.checkmanagerEligibility();
		} );
		
		socket.on('logout', function(args) {
			// user wants out?  okay then
			socket._pixl_auth = false;
			socket._pixl_manager = false;
		} );
		
		socket.on('manager_ping', function(args) {
			// manager has given dobby a ping!
			self.logDebug(10, "Received ping from manager server");
			self.multi.lastPingReceived = Tools.timeNow(true);
		} );
		
		socket.on('error', function(err) {
			self.logError('socket', "Client socket error: " + socket.id + ": " + err);
		} );
		
		socket.on('disconnect', function() {
			// client disconnected
			socket._pixl_disconnected = true;
			self.numSocketClients--;
			delete self.sockets[ socket.id ];
			self.logDebug(5, "Socket.io client disconnected: " + socket.id + " (IP: " + ip + ")");
		} );
	},
	
	sendmanagerPings: function() {
		// send a ping to all workers
		this.workerBroadcastAll('manager_ping');
	},
	
	workerNotifyGroupChange: function() {
		// notify all workers that server groups have changed
		this.workerBroadcastAll('groups_changed');
	},
	
	workerBroadcastAll: function(key, data) {
		// broadcast message to all workers
		if (!this.multi.manager) return;
		
		for (var hostname in this.workers) {
			var worker = this.workers[hostname];
			if (worker.socket) {
				worker.socket.emit(key, data || {});
			}
		}
	},
	
	getAllServers: function() {
		// get combo hash of all UDP-managed servers, and any manually added workers
		if (!this.multi.manager) return null;
		var servers = {};
		var now = Tools.timeNow(true);
		
		// add us first (the manager)
		servers[ this.server.hostname ] = {
			hostname: this.server.hostname,
			ip: this.server.ip,
			manager: 1,
			uptime: now - (this.server.started || now),
			data: this.multi.data || {},
			disabled: 0,
			pid: process.pid,
			nodev: process.version,
			engine: this.storage.config.get('engine'),
			platform: os.platform() || 'Unknown',
			release: os.release() || 'Unknown'
		};
		
		// then add all workers
		for (var hostname in this.workers) {
			var worker = this.workers[hostname];
			if (!servers[hostname]) {
				servers[hostname] = {
					hostname: hostname,
					ip: worker.ip || '',
					manager: 0,
					uptime: worker.uptime || 0,
					data: worker.data || {},
					disabled: worker.disabled || 0,
					pid: worker.pid || -1,
					nodev: worker.nodev || 'NA',
					platform: worker.platform || 'Unknown',
					release: worker.release || 'Unknown'
					// engine: worker.engine || 'unknown'
				};
			} // unique hostname
		} // foreach worker
		
		return servers;
	},
	
	shutdownLocalServer: function(args) {
		// shut down local server
		if (this.server.debug) {
			this.logDebug(5, "Skipping shutdown command, as we're in debug mode.");
			return;
		}
		
		this.logDebug(1, "Shutting down server: " + (args.reason || 'Unknown reason'));
		
		// issue shutdown command
		this.server.shutdown();
	},
	
	restartLocalServer: function(args) {
		// restart server, but only if in daemon mode
		if (this.server.debug) {
			this.logDebug(5, "Skipping restart command, as we're in debug mode.");
			return;
		}
		
		this.logDebug(1, "Restarting server: " + (args.reason || 'Unknown reason'));
		
		// issue a restart command by shelling out to our control script in a detached child
		child = cp.spawn( "bin/control.sh", ["restart"], { 
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'] 
		} );
		child.unref();
	},
	
	shutdownCluster: function() {
		// shut down all server connections
		if (this.sockets) {
			for (var id in this.sockets) {
				var socket = this.sockets[id];
				this.logDebug(9, "Closing client socket: " + socket.id);
				socket.disconnect();
			}
		}
		
		if (this.multi.manager) {
			for (var hostname in this.workers) {
				var worker = this.workers[hostname];
				if (worker.socket) {
					this.logDebug(9, "Closing worker connection: " + worker.hostname, worker.socket.id);
					worker.socket._pixl_disconnected = true;
					worker.socket.off('disconnect');
					worker.socket.disconnect();
					delete worker.socket;
				}
				if (worker.socketReconnectTimer) {
					clearTimeout( worker.socketReconnectTimer );
					delete worker.socketReconnectTimer;
				}
			}
			this.workers = {};
		} // manager
	}
	
});
