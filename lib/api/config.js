// Cronicle API Layer - Configuration
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

var fs = require('fs');
var assert = require("assert");
var async = require('async');

var Class = require("pixl-class");
var Tools = require("pixl-tools");

module.exports = Class.create({
	
	api_config: function(args, callback) {
		// send config to client
		var self = this;


		// do not cache this API response
		this.forceNoCacheResponse(args);
		
		// if there is no manager server, this has to fail (will be polled for retries)
		if (!this.multi.managerHostname) {
			// return callback({ code: 'manager', description: "No manager server found" }); 
			var resp = { code: 'manager', description: "No manager server found" };
			var payload = 'app.receiveConfig(' + JSON.stringify(resp) + ');' + "\n";
			return callback( "200 OK", { 'Content-Type': 'text/javascript' }, payload );
		}

		let base_path = String(this.server.config.get('base_path') || '').trim()
		if (!(/^\/\w+$/i).test(base_path)) base_path = "/"

		let oauth = this.server.config.get('oauth') || {}
		
		var resp = {
			code: 0,
			version: this.server.__version,
			config: Tools.mergeHashes( this.server.config.get('client'), {
				debug: this.server.debug ? 1 : 0,
				job_memory_max: this.server.config.get('job_memory_max'),
				base_api_uri: this.api.config.get('base_uri'),
				default_privileges: this.usermgr.config.get('default_privileges'),
				free_accounts: this.usermgr.config.get('free_accounts'),
				external_users: this.usermgr.config.get('external_user_api') ? 1 : 0,
				external_user_api: this.usermgr.config.get('external_user_api') || '',
				web_socket_use_hostnames: this.server.config.get('web_socket_use_hostnames') || 0,
				web_direct_connect: this.server.config.get('web_direct_connect') || 0,
				custom_live_log_socket_url: this.server.config.get('custom_live_log_socket_url'),
				ui: this.server.config.get('ui') || {},
				socket_io_transports: this.server.config.get('socket_io_transports') || 0,
				base_path: base_path,
				oauth: oauth.enabled || 0,
				live_log_page_size: this.server.config.get('live_log_page_size') || 8192,
				cas_auth: this.server.config.get('cas_auth') || false,
				cas_url: this.server.config.get('cas_url') || '',
				cas_login_auto_redirect: this.server.config.get('cas_login_auto_redirect') || false,
				cas_logout: this.server.config.get('cas_logout') || false
			} ),
			port: args.request.headers.ssl ? this.web.config.get('https_port') : this.web.config.get('http_port'),
			manager_hostname: this.multi.managerHostname
		};
		
		// if we're manager, then return our ip for websocket connect
		if (this.multi.manager) {
			resp.servers = {};
			resp.servers[ this.server.hostname ] = {
				hostname: this.server.hostname,
				ip: this.server.ip
			};
		}
		
		// wrap response in JavaScript
		var payload = 'app.receiveConfig(' + JSON.stringify(resp) + ');' + "\n";
		callback( "200 OK", { 'Content-Type': 'text/javascript' }, payload );
	}
	
} );
