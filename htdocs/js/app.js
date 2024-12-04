// Cronicle Web App
// Author: Joseph Huckaby
// Copyright (c) 2015 Joseph Huckaby and PixlCore.com

if (!window.app) throw new Error("App Framework is not present.");

app.extend({
	
	name: '',
	preload_images: ['loading.gif'],
	activeJobs: {},
	eventQueue: {},
	state: null,
	filter: {
		schedule: {	}
	},
	plain_text_post: true,
	clock_visible: false,
	scroll_time_visible: false,
	default_prefs: {
		schedule_group_by: 'category'
	},

	receiveConfig: function(resp) {
		// receive config from server
		if (resp.code) {
			app.showProgress( 1.0, "Waiting for manager server..." );
			setTimeout( function() { load_script( 'api/app/config' ); }, 1000 );
			return;
		}
		delete resp.code;
		window.config = resp.config;
		
		for (var key in resp) {
			this[key] = resp[key];
		}

		this.initTheme()
		
		// allow visible app name to be changed in config
		this.name = config.name;
		$('#d_header_title').html( '<b>' + filterXSS(this.name) + '</b>' );
		
		// hit the manager server directly from now on
		this.setmanagerHostname( resp.manager_hostname );
		
		this.config.Page = [
			{ ID: 'Home' },
			{ ID: 'Login' },
			{ ID: 'Schedule' },
			{ ID: 'History' },
			{ ID: 'JobDetails' },
			{ ID: 'MyAccount' },
			{ ID: 'Admin' }
		];
		this.config.DefaultPage = 'Home';
		
		// did we try to init and fail?  if so, try again now
		if (this.initReady) {
			this.hideProgress();
			delete this.initReady;
			this.init();
		}
	},
	
	init: function() {
		// initialize application
		if (this.abort) return; // fatal error, do not initialize app
		
		if (!this.config) {
			// must be in manager server wait loop
			this.initReady = true;
			return;
		}

		if (!this.servers) this.servers = {};
		this.server_groups = [];
		
		// timezone support
		this.tz = this.config.tz || jstz.determine().name();
		this.zones = moment.tz.names();

		this.hh24 = (this.config.ui || {}).hh24
		if(this.hh24) { // override hour labels
			_hour_names = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23']
		}
		
		// preload a few essential images
		for (var idx = 0, len = this.preload_images.length; idx < len; idx++) {
			var filename = '' + this.preload_images[idx];
			var img = new Image();
			img.src = 'images/'+filename;
		}
		
		// populate prefs for first time user
		for (var key in this.default_prefs) {
			if (!(key in window.localStorage)) {
				window.localStorage[key] = this.default_prefs[key];
			}
		}
		
		// pop version into footer
		$('#d_footer_version').html( "Version " + this.version || 0 );
		
		// some css classing for browser-specific adjustments
		var ua = navigator.userAgent;
		if (ua.match(/Safari/) && !ua.match(/(Chrome|Opera)/)) {
			$('body').addClass('safari');
		}
		else if (ua.match(/Chrome/)) {
			$('body').addClass('chrome');
		}
		else if (ua.match(/Firefox/)) {
			$('body').addClass('firefox');
		}
		
		// follow scroll so we can fade in/out the scroll time widget
		window.addEventListener( "scroll", function() {
			app.checkScrollTime();
		}, false );
		app.checkScrollTime();
		
		this.page_manager = new PageManager( always_array(config.Page) );
		
		// this.setHeaderClock();
		this.socketConnect();
		
		// Nav.init();
	},
	
	updateHeaderInfo: function() {
		// update top-right display
		let userName = (this.user.full_name || app.username).replace(/\s+.+$/, '') 
		let avatarUrl = this.getUserAvatarURL( this.retina ? 64 : 32 )
		let html = `
		<div id="d_header_divider" class="right" style="margin-right:0;"></div>
		<div class="header_option logout right" onMouseUp="app.doUserLogout()"><i class="fa fa-power-off fa-lg">&nbsp;&nbsp;</i>Logout</div>
		<div id="d_header_divider" class="right"></div>
		<div id="d_theme_ctrl" class="header_option right" onmouseup="app.toggleTheme()"></div>
		<div id="d_header_divider" class="right"></div>   
		<div id="d_header_user_bar" class="right" style="background-image:url(${avatarUrl})" onMouseUp="app.doMyAccount()">${userName}</div>
		`
		$('#d_header_user_container').html( html );
		this.initTheme();
	},

	// overwriting getUserAvatarURL to handle custom avatar url from external auth provider
	getUserAvatarURL: function() {
		// user may have custom avatar
		if (this.user && this.user.avatar_url) {			
			try { // try parse URL in order to encode any special characters in URL / prevent html injection
				return new URL(app.user.avatar_url).toString() 
			}
			catch { 
				// on any error proceed with gravatar
			}
		}

		// get URL to user's avatar using Gravatar.com service
		let size = 0;
		let email = '';
		if (arguments.length == 2) {
			email = arguments[0];
			size = arguments[1];
		}
		else if (arguments.length == 1) {
			email = this.user.email;
			size = arguments[0];
		}
		
		return '//en.gravatar.com/avatar/' + hex_md5( email.toLowerCase() ) + '.jpg?s=' + size + '&d=mm';
	},
	
	doUserLogin: function(resp) {
		// user login, called from login page, or session recover
		// overriding this from base.js, so we can pass the session ID to the websocket
		delete resp.code;
		
		for (var key in resp) {
			if(key === 'secrets' && !this.isAdmin()) continue // secrets admin only
			this[key] = resp[key];
		}
		
		if (this.isCategoryLimited()  || this.isGroupLimited() ) {
			this.pruneSchedule();
			this.pruneCategories();
			this.pruneActiveJobs();
		}
		
		this.setPref('username', resp.username);
		this.setPref('session_id', resp.session_id);
		
		this.updateHeaderInfo();
		
		// update clock
		this.setHeaderClock( this.epoch );
		
		// show scheduler manager switch
		this.updatemanagerSwitch();
		if (this.hasPrivilege('state_update')) $('#d_tab_manager').addClass('active');
		
		// show admin tab if user is worthy
		if (this.isAdmin()) $('#tab_Admin').show();
		else $('#tab_Admin').hide();
		
		// authenticate websocket
		this.socket.emit( 'authenticate', { token: resp.session_id } );
	},
	
	doUserLogout: function(bad_cookie) {
		// log user out and redirect to login screen
		var self = this;
		
		if (!bad_cookie) {
			// user explicitly logging out
			this.showProgress(1.0, "Logging out...");
			this.setPref('username', '');
		}
		
		this.api.post( 'user/logout', {
			session_id: this.getPref('session_id')
		}, 
		function(resp, tx) {
			delete self.user;
			delete self.username;
			delete self.user_info;
			
			if (self.socket) self.socket.emit( 'logout', {} );
			
			self.setPref('session_id', '');
			
			$('#d_header_user_container').html( '' );
			$('#d_tab_manager').html( '' );
			
			$('div.header_clock_layer').fadeTo( 1000, 0 );
			$('#d_tab_time > span').html( '' );
			self.clock_visible = false;
			self.checkScrollTime();
			
			if (app.config.external_users) {
				// external user api
				Debug.trace("User session cookie was deleted, querying external user API");
				setTimeout( function() {
					if (bad_cookie) app.doExternalLogin(); 
					else app.doExternalLogout(); 
				}, 250 );
			}
			else {
				Debug.trace("User session cookie was deleted, redirecting to login page");
				self.hideProgress();
				Nav.go('Login');
			}
			
			setTimeout( function() {
				if (!app.config.external_users) {
					if (bad_cookie) {
						self.showMessage('error', "Your session has expired.  Please log in again.");
						console.log('bad cookieee', bad_cookie)
					}
					else self.showMessage('success', "You were logged out successfully.");
				}
				
				self.activeJobs = {};
				delete self.servers;
				delete self.schedule;
				delete self.categories;
				delete self.plugins;
				delete self.secrets;
				delete self.server_groups;
				delete self.epoch;
				
			}, 150 );
			
			$('#tab_Admin').hide();
		} );
	},
	
	doExternalLogin: function() {
		// login using external user management system
		// Force API to hit current page hostname vs. manager server, so login redirect URL reflects it
		app.api.post( 'user/external_login', { cookie: document.cookie }, function(resp) {
			if (resp.user) {
				Debug.trace("User Session Resume: " + resp.username + ": " + resp.session_id);
				app.hideProgress();
				app.doUserLogin( resp );
				Nav.refresh();
			}
			else if (resp.location) {
				Debug.trace("External User API requires redirect");
				app.showProgress(1.0, "Logging in...");
				setTimeout( function() { window.location = resp.location; }, 250 );
			}
			else app.doError(resp.description || "Unknown login error.");
		} );
	},
	
	doExternalLogout: function() {
		// redirect to external user management system for logout
		var url = app.config.external_user_api;
		url += (url.match(/\?/) ? '&' : '?') + 'logout=1';
		
		Debug.trace("External User API requires redirect");
		app.showProgress(1.0, "Logging out...");
		setTimeout( function() { window.location = url; }, 250 );
	},

	show_info: function(title) {
        // just display stuff and close dialog
		this.confirm_callback = this.hideDialog;

		let buttons_html = `
		  <center><table><tr>
		  <td><div class="button" style="width:100px; font-weight:normal;" onMouseUp="app.confirm_click(false)">OK</div></td>
		  </tr></table></center>
		`

		let html = `
		  <div class="dialog_title">${title}</div>
		  <div class="dialog_buttons">${buttons_html}</div>
		`
		Dialog.showAuto( "", html );
		// special mode for key capture
		Dialog.active = 'confirmation';
	},
	
	socketConnect: function() {
		// init socket.io client
		var self = this;

		let socket_io_path = "/socket.io"
		if ((/^\/\w+$/i).test(config.base_path)) socket_io_path = config.base_path + "/socket.io"		

		var url = this.proto + this.managerHostname + ':' + this.port;
		if (!config.web_socket_use_hostnames && this.servers && this.servers[this.managerHostname] && this.servers[this.managerHostname].ip) {
			// use ip instead of hostname if available
			url = this.proto + this.servers[this.managerHostname].ip + ':' + this.port;
		}
		if (!config.web_direct_connect) {
			url = this.proto + location.host;
		}
		Debug.trace("Websocket Connect: " + url);
		
		if (this.socket) {
			Debug.trace("Destroying previous socket");
			this.socket.removeAllListeners();
			if (this.socket.connected) this.socket.disconnect();
			this.socket = null;
		}
		
		var socket = this.socket = io( url, {
			// forceNew: true,
			transports: config.socket_io_transports || ['websocket'],
			reconnection: false,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 2000,
			reconnectionAttempts: 9999,
			timeout: 3000,
			path: socket_io_path,
		} );
		
		socket.on('connect', function() {
			if (!Nav.inited) Nav.init();
			
			Debug.trace("socket.io connected successfully");
			// if (self.progress) self.hideProgress();
			
			// if we are already logged in, authenticate websocket now
			var session_id = app.getPref('session_id');
			if (session_id) socket.emit( 'authenticate', { token: session_id } );
		} );
		
		socket.on('connect_error', function(err) {
			Debug.trace("socket.io connect error: " + err);
		} );
		
		socket.on('connect_timeout', function(err) {
			Debug.trace("socket.io connect timeout");
		} );
		
		socket.on('reconnecting', function() {
			Debug.trace("socket.io reconnecting...");
			// self.showProgress( 0.5, "Reconnecting to server..." );
		} );
		
		socket.on('reconnect', function() {
			Debug.trace("socket.io reconnected successfully");
			// if (self.progress) self.hideProgress();
		} );
		
		socket.on('reconnect_failed', function() {
			Debug.trace("socket.io has given up -- we must refresh");
			location.reload();
		} );
		
		socket.on('disconnect', function() {
			// unexpected disconnection
			Debug.trace("socket.io disconnected unexpectedly");
		} );
		
		socket.on('status', function(data) {
			if (!data.manager) {
				// OMG we're not talking to manager anymore?
				self.recalculatemanager(data);
			}
			else {
				// connected to manager
				self.epoch = data.epoch;
				self.servers = data.servers;
				self.setHeaderClock( data.epoch );
				
				// update active jobs				
				self.updateActiveJobs( data );
				
				// notify current page
				var id = self.page_manager.current_page_id;
				var page = self.page_manager.find(id);
				if (page && page.onStatusUpdate) page.onStatusUpdate(data);
				
				// remove dialog if present
				if (self.waitingFormanager && self.progress) {
					self.hideProgress();
					delete self.waitingFormanager;
				}
			} // manager
		} );
		
		socket.on('update', function(data) {
			// receive data update (global list contents)
			var limited_user = self.isCategoryLimited() || self.isGroupLimited();
			
			for (var key in data) {
				if(key === 'secrets' && !self.isAdmin()) continue // secrets are admin only
				self[key] = data[key];
				
				if (limited_user) {
					if (key == 'schedule') self.pruneSchedule();
					else if (key == 'categories') self.pruneCategories();
				}
				
				var id = self.page_manager.current_page_id;
				var page = self.page_manager.find(id);
				if (page && page.onDataUpdate) page.onDataUpdate(key, data[key]);
			}
			
			// update manager switch (once per minute)
			if (data.state) self.updatemanagerSwitch();
			
			// clear event autosave data if schedule was updated
			if (data.schedule) delete self.autosave_event;
		} );
		
		// --- Keep socket.io connected forever ---
		// This is the worst hack in history, but socket.io-client
		// is simply not behaving, and I have tried EVERYTHING ELSE.
		setInterval( function() {
			if (socket && !socket.connected) {
				Debug.trace("Forcing socket to reconnect");
				socket.connect();
			}
		}, 5000 );
	},
	
	updateActiveJobs: function(data) {
		// update active jobs
		var jobs = data.active_jobs;
		var changed = false;
		
		// hide silent jobs?
		// if(jobs) jobs = jobs.map(j=>!j.silent)
		
		// determine if jobs have been added or deleted
		for (var id in jobs) {
			// check for new jobs added
			if (!this.activeJobs[id]) changed = true;
		}
		for (var id in this.activeJobs) {
			// check for jobs completed
			if (!jobs[id]) changed = true;
		}
		
		this.activeJobs = jobs;
		if (this.isCategoryLimited()  || this.isGroupLimited() ) this.pruneActiveJobs();
		data.jobs_changed = changed;
	},
	
	pruneActiveJobs: function() {
		// remove active jobs that the user should not see, due to category/group privs
		if (!this.activeJobs) return;
		
		for (var id in this.activeJobs) {
			var job = this.activeJobs[id];
			if (!this.hasCategoryAccess(job.category) || !this.hasGroupAccess(job.target)) {
				delete this.activeJobs[id];
			}
		}
	},
	
	pruneSchedule: function() {
		// remove schedule items that the user should not see, due to category/group privs
		if (!this.schedule || !this.schedule.length) return;
		var new_items = [];
		
		for (var idx = 0, len = this.schedule.length; idx < len; idx++) {
			var item = this.schedule[idx];
			if (this.hasCategoryAccess(item.category) && this.hasGroupAccess(item.target)) {
				new_items.push(item);
			}
		}
		
		this.schedule = new_items;
	},
	
	pruneCategories: function() {
		// remove categories that the user should not see, due to category/group privs
		if (!this.categories || !this.categories.length) return;
		var new_items = [];
		
		for (var idx = 0, len = this.categories.length; idx < len; idx++) {
			var item = this.categories[idx];
			if (this.hasCategoryAccess(item.id)) new_items.push(item);
		}
		
		this.categories = new_items;
	},
	
	isCategoryLimited: function() {
		// return true if user is limited to specific categories, false otherwise
		if (this.isAdmin()) return false;
		return( app.user && app.user.privileges && app.user.privileges.cat_limit );
	},
	
	isGroupLimited: function() {
		// return true if user is limited to specific server groups, false otherwise
		if (this.isAdmin()) return false;
		return( app.user && app.user.privileges && app.user.privileges.grp_limit );
	},

	hasCategoryAccess: function(cat_id) {
		// check if user has access to specific category
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		if (!app.user.privileges.cat_limit) return true;
		
		var priv_id = 'cat_' + cat_id;
		return( !!app.user.privileges[priv_id] );
	},

	hasGroupAccess: function(grp_id) {
		// check if user has access to specific server group
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		if (!app.user.privileges.grp_limit) return true;

		var priv_id = 'grp_' + grp_id;
		var result = !!app.user.privileges[priv_id];
		if (result) return true;

		// make sure grp_id is a hostname from this point on
		if (find_object(app.server_groups, { id: grp_id })) return false;

		var groups = app.server_groups.filter( function(group) {
			return grp_id.match( group.regexp );
		} );

		// we just need one group to match, then the user has permission to target the server
		for (var idx = 0, len = groups.length; idx < len; idx++) {
			priv_id = 'grp_' + groups[idx].id;
			result = !!app.user.privileges[priv_id];
			if (result) return true;
		}
		return false;
	},
	
	hasPrivilege: function(priv_id) {
		// check if user has privilege
		if (!app.user || !app.user.privileges) return false;
		if (app.user.privileges.admin) return true;
		return( !!app.user.privileges[priv_id] );
	},
	
	recalculatemanager: function(data) {
		// Oops, we're connected to a worker!  manager must have been restarted.
		// If worker knows who is manager, switch now, otherwise go into wait loop
		var self = this;
		this.showProgress( 1.0, "Waiting for manager server..." );
		this.waitingFormanager = true;
		
		if (data.manager_hostname) {
			// reload browser which should connect to manager
			location.reload();
		}
	},
	
	setmanagerHostname: function(hostname) {
		// set new manager hostname, update stuff
		Debug.trace("New manager Hostname: " + hostname);
		this.managerHostname = hostname;
		
		if (config.web_direct_connect) {
			this.base_api_url = this.proto + this.managerHostname + ':' + this.port + config.base_api_uri;
			if (!config.web_socket_use_hostnames && this.servers && this.servers[this.managerHostname] && this.servers[this.managerHostname].ip) {
				// use ip instead of hostname if available
				this.base_api_url = this.proto + this.servers[this.managerHostname].ip + ':' + this.port + config.base_api_uri;
			}
		}
		else {
			this.base_api_url = this.proto + location.host + config.base_api_uri;
		}
		
		Debug.trace("API calls now going to: " + this.base_api_url);
	},
	
	setHeaderClock: function(when) {
		// move the header clock hands to the selected time
		
		if (!when) when = time_now();
		var dargs = get_date_args( when );
		
		// hour hand
		var hour = (((dargs.hour + (dargs.min / 60)) % 12) / 12) * 360;
		$('#d_header_clock_hour').css({
			transform: 'rotateZ('+hour+'deg)',
			'-webkit-transform': 'rotateZ('+hour+'deg)'
		});
		
		// minute hand
		var min = ((dargs.min + (dargs.sec / 60)) / 60) * 360;
		$('#d_header_clock_minute').css({
			transform: 'rotateZ('+min+'deg)',
			'-webkit-transform': 'rotateZ('+min+'deg)'
		});
		
		// second hand
		var sec = (dargs.sec / 60) * 360;
		$('#d_header_clock_second').css({
			transform: 'rotateZ('+sec+'deg)',
			'-webkit-transform': 'rotateZ('+sec+'deg)'
		});
		
		// show clock if needed
		if (!this.clock_visible) {
			this.clock_visible = true;
			$('div.header_clock_layer, #d_tab_time').fadeTo( 1000, 1.0 );
			this.checkScrollTime();
		}
		
		// date/time in tab bar
		// $('#d_tab_time, #d_scroll_time > span').html( get_nice_date_time( when, true, true ) );
		var num_active = num_keys( app.activeJobs || {} );
		var nice_active = commify(num_active) + ' ' + pluralize('Job', num_active);
		if (!num_active) nice_active = "Idle";
		
		$('#d_tab_time > span, #d_scroll_time > span').html(
			// get_nice_date_time( when, true, true ) + ' ' + 
			get_nice_time(when, true) + ' ' + 
			moment.tz( when * 1000, app.tz).format("z") + ' - ' + 
			nice_active
		);
	},
	
	updatemanagerSwitch: function() {
		// update manager switch display
		var html = '';
		if (this.hasPrivilege('state_update')) {
			html = '<i '+(this.state.enabled ? 'class="fa fa-check-square-o">' : 'class="fa fa-square-o">')+'</i>&nbsp;<b>Scheduler Enabled</b>';
		}
		else {
			if (this.state.enabled) html = '<i class="fa fa-check">&nbsp;</i><b>Scheduler Enabled</b>';
			else html = '<i class="fa fa-times">&nbsp;</i><b>Scheduler Disabled</b>';
		}
		
		$('#d_tab_manager')
			.css( 'color', this.state.enabled ? '#3f7ed5' : '#777' )
			.html( html );
	},
	
	togglemanagerSwitch: function() {
		// toggle manager scheduler switch on/off
		var self = this;
		var enabled = this.state.enabled ? 0 : 1;
		
		if (!this.hasPrivilege('state_update')) return;
		
		// $('#d_tab_manager > i').removeClass().addClass('fa fa-spin fa-spinner');
		
		app.api.post( 'app/update_manager_state', { enabled: enabled }, function(resp) {
			app.showMessage('success', "Scheduler has been " + (enabled ? 'enabled' : 'disabled') + ".");
			self.state.enabled = enabled;
			self.updatemanagerSwitch();
		} );
	},
	
	checkScrollTime: function() {
		// check page scroll, see if we need to fade in/out the scroll time widget
		var pos = get_scroll_xy();
		var y = pos.y;
		var min_y = 70;
		
		if ((y >= min_y) && this.clock_visible) {
			if (!this.scroll_time_visible) {
				// time to fade it in
				$('#d_scroll_time').stop().css('top', '0px').fadeTo( 1000, 1.0 );
				this.scroll_time_visible = true;
			}
		}
		else {
			if (this.scroll_time_visible) {
				// time to fade it out
				$('#d_scroll_time').stop().fadeTo( 500, 0, function() {
					$(this).css('top', '-30px');
				} );
				this.scroll_time_visible = false;
			}
		}
	},
	
	get_password_type: function() {
		// get user's pref for password field type, defaulting to config
		return this.getPref('password_type') || config.default_password_type || 'password';
	},
	
	get_password_toggle_html: function() {
		// get html for a password toggle control
		var text = (this.get_password_type() == 'password') ? 'Show' : 'Hide';
		return '<span class="link password_toggle" onMouseUp="app.toggle_password_field(this)">' + text + '</span>';
	},
	
	toggle_password_field: function(span) {
		// toggle password field visible / masked
		var $span = $(span);
		var $field = $span.prev();
		if ($field.attr('type') == 'password') {
			$field.attr('type', 'text');
			$span.html( 'Hide' );
			this.setPref('password_type', 'text');
		}
		else {
			$field.attr('type', 'password');
			$span.html( 'Show' );
			this.setPref('password_type', 'password');
		}
	},
	
	password_strengthify: function(sel) {
		// add password strength meter (text field should be wrapped by div)

		let user = app.user || {}
		if(user.ext_auth) return // no password strength for external auth

		var $field = $(sel);
		var $div = $field.parent();
		
		var $cont = $('<div class="psi_container" title="Password strength indicator" onClick=""></div>');
		$cont.css('width', $field[0].offsetWidth );
		$cont.html( '<div class="psi_bar"></div>' );
		$div.append( $cont );
		
		$field.keyup( function() {
			setTimeout( function() {
				app.update_password_strength($field, $cont);
			}, 1 );
		} );
		
		//if (!window.zxcvbn) load_script('js/external/zxcvbn.js');
	},
	
	update_password_strength: function ($field, $cont) {

		// update password strength indicator after keypress

		let score = 0
		let crack_time = 'instant'
		let password = $field.val()
		if(password.length > 20) score = 3

		if (window.zxcvbn) {
			var result = zxcvbn(password);
			// Debug.trace("Password score: " + password + ": " + result.score);
			var $bar = $cont.find('div.psi_bar');
			$bar.removeClass('str0 str1 str2 str3 str4');
			if (password.length) $bar.addClass('str' + result.score);
			app.last_password_strength = result;
		}
		else { // basic strength checker
			if (password.match(/[a-z]+/)) score += 0.5
			if (password.match(/[A-Z]+/)) score += 0.5
			if (password.match(/[0-9]+/)) score += 1
			if (password.match(/[$@#&!]+/)) score += 1
			if (password.length >= 8) {
				score += 0.5
				crack_time = 'few hours or days'
			} else { score -= 0.5}

			app.last_password_strength = {
				score: score,
				crack_time_display: crack_time
			}
		}
	},
	
	get_password_warning: function() {
		// return string of text used for bad password dialog
		var est_length = app.last_password_strength.crack_time_display;
		if (est_length == 'instant') est_length = 'instantly';
		else est_length = 'in about ' + est_length;
		
		return "The password you entered is <b>insecure</b>, and could be easily compromised by hackers.  Our anaysis indicates that it could be cracked via brute force " + est_length + ". For more details see <a href=\"http://en.wikipedia.org/wiki/Password_strength\" target=\"_blank\">this article</a>.<br/><br/>Do you really want to use this password?";
	},
	
	get_color_checkbox_html: function(id, label, checked) {
		// get html for color label checkbox, with built-in handlers to toggle state
		if (checked === true) checked = "checked";
		else if (checked === false) checked = "";
		
		return '<span id="'+id+'" class="color_label checkbox ' + checked + '" onMouseUp="app.toggle_color_checkbox(this)"><i class="fa '+(checked.match(/\bchecked\b/) ? 'fa-check-square-o' : 'fa-square-o')+'">&nbsp;</i>'+label+'</span>';
	},
	
	toggle_color_checkbox: function(elem) {
		// toggle color checkbox state
		var $elem = $(elem);
		if ($elem.hasClass('checked')) {
			// uncheck
			$elem.removeClass('checked').find('i').removeClass('fa-check-square-o').addClass('fa-square-o');
		}
		else {
			// check
			$elem.addClass('checked').find('i').addClass('fa-check-square-o').removeClass('fa-square-o');
		}
	}
	
}); // app

function get_pretty_int_list(arr, ranges) {
	// compose int array to string using commas + spaces, and
	// the english "and" to group the final two elements.
	// also detect sequences and collapse those into dashed ranges
	if (!arr || !arr.length) return '';
	if (arr.length == 1) return arr[0].toString();
	arr = deep_copy_object(arr).sort( function(a, b) { return a - b; } );
	
	// check for ranges and collapse them
	if (ranges) {
		var groups = [];
		var group = [];
		for (var idx = 0, len = arr.length; idx < len; idx++) {
			var elem = arr[idx];
			if (!group.length || (elem == group[group.length - 1] + 1)) group.push(elem);
			else { groups.push(group); group = [elem]; }
		}
		if (group.length) groups.push(group);
		arr = [];
		for (var idx = 0, len = groups.length; idx < len; idx++) {
			var group = groups[idx];
			if (group.length == 1) arr.push( group[0] );
			else if (group.length == 2) {
				arr.push( group[0] );
				arr.push( group[1] );
			}
			else {
				arr.push( group[0] + ' - ' + group[group.length - 1] );
			}
		}
	} // ranges
	
	if (arr.length == 1) return arr[0].toString();
	return arr.slice(0, arr.length - 1).join(', ') + ' and ' + arr[ arr.length - 1 ];
}

function summarize_event_interval(interval, short) {	
	if(!parseInt(interval)) return 'Inactive Interval' // sanity, should check before passing this arg
	if(interval % (3600*24) === 0) {
		return (short ? `Every ${interval/(3600*24)} days` : `Interval: Every ${interval/(3600*24)} days`)
	}
	if(interval % 3600 === 0) {
		return (short ? `Every ${interval/3600} hours` : `Interval: Every ${interval/3600} hours`)
	}
	return  (short ? `Every ${interval/60} min` : `Interval: Every ${interval/60} minutes` )

}

// override get_nice_time from base class
function get_nice_time(epoch, secs) {
	let dargs = get_date_args(epoch);
	if (dargs.min < 10) dargs.min = '0' + dargs.min;
	if (dargs.sec < 10) dargs.sec = '0' + dargs.sec;
	let output = (app.hh24 ? dargs.hour : dargs.hour12) + ':' + dargs.min;
	let ampm = app.hh24 ? '' : dargs.ampm.toUpperCase()
	if (secs) output += ':' + dargs.sec;
	output += ' ' + ampm;
	return output;
}

function summarize_event_timing_short(timing) {		
	if(!timing) return "On Demand"
	let type = 'Hourly'
	let total = (timing.minutes || []).length || 60
	if(timing.hours) { total = total*(timing.hours.length || 24); type = 'Daily'} else { total = total*24}
	if(timing.weekdays) { total = total*(timing.weekdays.length || 1); type = 'Weekly'}
	if(timing.days) { total = total*(timing.days.length || 1); type = 'Monthly'}
	if(timing.months) { total = total*(timing.months.length || 1); type = 'Yearly'}
	if(timing.years) { total = total*(timing.years.length || 1); type = 'Custom'}
	return `${type} :: ${total}`
}

function summarize_event_timing(timing, timezone, extra) {
	// summarize event timing into human-readable string
	if (!timing && extra) {
		return `<span title="${'Extra Ticks: ' + extra.toString().split(/[\,\;\|]/).filter(e => e).join(', ')}">On Demand +</span>`
	}
	if (!timing) { return "On demand" };	
	
	// years
	var year_str = '';
	if (timing.years && timing.years.length) {
		year_str = get_pretty_int_list(timing.years, true);
	}
	
	// months
	var mon_str = '';
	if (timing.months && timing.months.length) {
		mon_str = get_pretty_int_list(timing.months, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return _months[ parseInt(m_g1) - 1 ][1];
		});
	}
	
	// days
	var mday_str = '';
	if (timing.days && timing.days.length) {
		mday_str = get_pretty_int_list(timing.days, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return m_g1 + _number_suffixes[ parseInt( m_g1.substring(m_g1.length - 1) ) ];
		});
	}
	
	// weekdays	
	var wday_str = '';
	if (timing.weekdays && timing.weekdays.length) {
		wday_str = get_pretty_int_list(timing.weekdays, true).replace(/(\d+)/g, function(m_all, m_g1) {
			return _day_names[ parseInt(m_g1) ] + 's';
		});
		wday_str = wday_str.replace(/Mondays\s+\-\s+Fridays/, 'weekdays');
	}
	
	// hours
	var hour_str = '';
	if (timing.hours && timing.hours.length) {
		hour_str = get_pretty_int_list(timing.hours, true).replace(/(\d+)/g, function(m_all, m_g1) {
              return _hour_names[ parseInt(m_g1) ];
		});
	}
	
	// minutes
	var min_str = '';
	if (timing.minutes && timing.minutes.length) {
		min_str = get_pretty_int_list(timing.minutes, false).replace(/(\d+)/g, function(m_all, m_g1) {
			return ':' + ((m_g1.length == 1) ? ('0'+m_g1) : m_g1);
		});
	}
	
	// construct final string
	var groups = [];
	var mday_compressed = false;
	
	if (year_str) {
		groups.push( 'in ' + year_str );
		if (mon_str) groups.push( mon_str );
	}
	else if (mon_str) {
		// compress single month + single day
		if (timing.months && timing.months.length == 1 && timing.days && timing.days.length == 1) {
			groups.push( 'on ' + mon_str + ' ' + mday_str );
			mday_compressed = true;
		}
		else {
			groups.push( 'in ' + mon_str );
		}
	}
	
	if (mday_str && !mday_compressed) {
		if (mon_str || wday_str) groups.push( 'on the ' + mday_str );
		else groups.push( 'monthly on the ' + mday_str );
	}
	if (wday_str) groups.push( 'on ' + wday_str );
	
	// compress single hour + single minute
	if (timing.hours && timing.hours.length == 1 && timing.minutes && timing.minutes.length == 1) {
		new_str = hour_str + min_str;
		if(!app.hh24) {
		hour_str.match(/^(\d+)(\w+)$/);
		var hr = RegExp.$1;
		var ampm = RegExp.$2;
		var new_str = hr + min_str + ampm;
		}
		
		if (mday_str || wday_str) groups.push( 'at ' + new_str );
		else groups.push( 'daily at ' + new_str );
	}
	else {
		var min_added = false;
		if (hour_str) {
			if (mday_str || wday_str) groups.push( 'at ' + hour_str );
			else groups.push( 'daily at ' + hour_str );
		}
		else {
			// check for repeating minute pattern
			if (timing.minutes && timing.minutes.length) {
				var interval = detect_num_interval( timing.minutes, 60 );
				if (interval) {
					var new_str = 'every ' + interval + ' minutes';
					if (timing.minutes[0] > 0) {
						var m_g1 = timing.minutes[0].toString();
						new_str += ' starting on the :' + ((m_g1.length == 1) ? ('0'+m_g1) : m_g1);
					}
					groups.push( new_str );
					min_added = true;
				}
			}
			
			if (!min_added) {
				if (min_str) groups.push( 'hourly' );
			}
		}
		
		if (!min_added) {
			if (min_str) groups.push( 'on the ' + min_str.replace(/\:00/, 'hour').replace(/\:30/, 'half-hour') );
			else groups.push( 'every minute' );
		}
	}
	
	var text = groups.join(', ');
	var output = text.substring(0, 1).toUpperCase() + text.substring(1, text.length);
	
	if (timezone && (timezone != app.tz)) {
		// get tz abbreviation
		output += ' (' + moment.tz.zone(timezone).abbr( (new Date()).getTime() ) + ')';
	}
	
	if(extra) {
		let xtitle = extra.toString().split(/[\,\;\|]/).filter(e=>e).join(', ')
		return `<span title="Extra Ticks: ${xtitle}">${output} +</span>`
	}
	
	return output
};

function detect_num_interval(arr, max) {
	// detect interval between array elements, return if found
	// all elements must have same interval between them
	if (arr.length < 2) return false;
	// if (arr[0] > 0) return false;
	
	var interval = arr[1] - arr[0];
	for (var idx = 1, len = arr.length; idx < len; idx++) {
		var temp = arr[idx] - arr[idx - 1];
		if (temp != interval) return false;
	}
	
	// if max is provided, final element + interval must equal max
	// if (max && (arr[arr.length - 1] + interval != max)) return false;
	if (max && ((arr[arr.length - 1] + interval) % max != arr[0])) return false;
	
	return interval;
};

// Crontab Parsing Tools
// by Joseph Huckaby, (c) 2015, MIT License

var cron_aliases = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12,
	
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};
var cron_alias_re = new RegExp("\\b(" + hash_keys_to_array(cron_aliases).join('|') + ")\\b", "g");

function parse_crontab_part(timing, raw, key, min, max, rand_seed) {
	// parse one crontab part, e.g. 1,2,3,5,20-25,30-35,59
	// can contain single number, and/or list and/or ranges and/or these things: */5 or 10-50/5
	if (raw == '*') { return; } // wildcard
	if (raw == 'h') {
		// unique value over accepted range, but locked to random seed
		// https://github.com/jhuckaby/Cronicle/issues/6
		raw = min + (parseInt( hex_md5(rand_seed), 16 ) % ((max - min) + 1));
		raw = '' + raw;
	}
	if (!raw.match(/^[\w\-\,\/\*]+$/)) { throw new Error("Invalid crontab format: " + raw); }
	var values = {};
	var bits = raw.split(/\,/);
	
	for (var idx = 0, len = bits.length; idx < len; idx++) {
		var bit = bits[idx];
		if (bit.match(/^\d+$/)) {
			// simple number, easy
			values[bit] = 1;
		}
		else if (bit.match(/^(\d+)\-(\d+)$/)) {
			// simple range, e.g. 25-30
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			for (var idy = start; idy <= end; idy++) { values[idy] = 1; }
		}
		else if (bit.match(/^\*\/(\d+)$/)) {
			// simple step interval, e.g. */5
			var step = parseInt( RegExp.$1 );
			var start = min;
			var end = max;
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else if (bit.match(/^(\d+)\-(\d+)\/(\d+)$/)) {
			// range step inverval, e.g. 1-31/5
			var start = parseInt( RegExp.$1 );
			var end = parseInt( RegExp.$2 );
			var step = parseInt( RegExp.$3 );
			for (var idy = start; idy <= end; idy += step) { values[idy] = 1; }
		}
		else {
			throw new Error("Invalid crontab format: " + bit + " (" + raw + ")");
		}
	}
	
	// min max
	var to_add = {};
	var to_del = {};
	for (var value in values) {
		value = parseInt( value );
		if (value < min) {
			to_del[value] = 1;
			to_add[min] = 1;
		}
		else if (value > max) {
			to_del[value] = 1;
			value -= min;
			value = value % ((max - min) + 1); // max is inclusive
			value += min;
			to_add[value] = 1;
		}
	}
	for (var value in to_del) delete values[value];
	for (var value in to_add) values[value] = 1;
	
	// convert to sorted array
	var list = hash_keys_to_array(values);
	for (var idx = 0, len = list.length; idx < len; idx++) {
		list[idx] = parseInt( list[idx] );
	}
	list = list.sort( function(a, b) { return a - b; } );
	if (list.length) timing[key] = list;
};

function parse_crontab(raw, rand_seed) {
	// parse standard crontab syntax, return timing object
	// e.g. 1,2,3,5,20-25,30-35,59 23 31 12 * *
	// optional 6th element == years
	if (!rand_seed) rand_seed = get_unique_id();
	var timing = {};
	
	// resolve all @shortcuts
	raw = trim(raw).toLowerCase();
	if (raw.match(/\@(yearly|annually)/)) raw = '0 0 1 1 *';
	else if (raw == '@monthly') raw = '0 0 1 * *';
	else if (raw == '@weekly') raw = '0 0 * * 0';
	else if (raw == '@daily') raw = '0 0 * * *';
	else if (raw == '@hourly') raw = '0 * * * *';
	
	// expand all month/wday aliases
	raw = raw.replace(cron_alias_re, function(m_all, m_g1) {
		return cron_aliases[m_g1];
	} );
	
	// at this point string should not contain any alpha characters or '@', except for 'h'
	if (raw.match(/([a-gi-z\@]+)/i)) throw new Error("Invalid crontab keyword: " + RegExp.$1);
	
	// split into parts
	var parts = raw.split(/\s+/);
	if (parts.length > 6) throw new Error("Invalid crontab format: " + parts.slice(6).join(' '));
	if (!parts[0].length) throw new Error("Invalid crontab format");
	
	// parse each part
	if ((parts.length > 0) && parts[0].length) parse_crontab_part( timing, parts[0], 'minutes', 0, 59, rand_seed );
	if ((parts.length > 1) && parts[1].length) parse_crontab_part( timing, parts[1], 'hours', 0, 23, rand_seed );
	if ((parts.length > 2) && parts[2].length) parse_crontab_part( timing, parts[2], 'days', 1, 31, rand_seed );
	if ((parts.length > 3) && parts[3].length) parse_crontab_part( timing, parts[3], 'months', 1, 12, rand_seed );
	if ((parts.length > 4) && parts[4].length) parse_crontab_part( timing, parts[4], 'weekdays', 0, 6, rand_seed );
	if ((parts.length > 5) && parts[5].length) parse_crontab_part( timing, parts[5], 'years', 1970, 3000, rand_seed );
	
	return timing;
};

// TAB handling code from http://www.webdeveloper.com/forum/showthread.php?t=32317
// Hacked to do my bidding - JH 2008-09-15
function setSelectionRange(input, selectionStart, selectionEnd) {
  if (input.setSelectionRange) {
    input.focus();
    input.setSelectionRange(selectionStart, selectionEnd);
  }
  else if (input.createTextRange) {
    var range = input.createTextRange();
    range.collapse(true);
    range.moveEnd('character', selectionEnd);
    range.moveStart('character', selectionStart);
    range.select();
  }
};

function replaceSelection (input, replaceString) {
	var oldScroll = input.scrollTop;
	if (input.setSelectionRange) {
		var selectionStart = input.selectionStart;
		var selectionEnd = input.selectionEnd;
		input.value = input.value.substring(0, selectionStart)+ replaceString + input.value.substring(selectionEnd);

		if (selectionStart != selectionEnd){ 
			setSelectionRange(input, selectionStart, selectionStart + 	replaceString.length);
		}else{
			setSelectionRange(input, selectionStart + replaceString.length, selectionStart + replaceString.length);
		}

	}else if (document.selection) {
		var range = document.selection.createRange();

		if (range.parentElement() == input) {
			var isCollapsed = range.text == '';
			range.text = replaceString;

			 if (!isCollapsed)  {
				range.moveStart('character', -replaceString.length);
				range.select();
			}
		}
	}
	input.scrollTop = oldScroll;
};

function catchTab(item,e){
	var c = e.which ? e.which : e.keyCode;

	if (c == 9){
		replaceSelection(item,String.fromCharCode(9));
		setTimeout("document.getElementById('"+item.id+"').focus();",0);	
		return false;
	}
};

function get_text_from_seconds_round_custom(sec, abbrev) {
	// convert raw seconds to human-readable relative time
	// round to nearest instead of floor, but allow one decimal point if under 10 units
	var neg = '';
	if (sec < 0) { sec =- sec; neg = '-'; }
	
	var text = abbrev ? "sec" : "second";
	var amt = sec;
	
	if (sec > 59) {
		var min = sec / 60;
		text = abbrev ? "min" : "minute"; 
		amt = min;
		
		if (min > 59) {
			var hour = min / 60;
			text = abbrev ? "hr" : "hour"; 
			amt = hour;
			
			if (hour > 23) {
				var day = hour / 24;
				text = "day"; 
				amt = day;
			} // hour>23
		} // min>59
	} // sec>59
	
	if (amt < 10) amt = Math.round(amt * 10) / 10;
	else amt = Math.round(amt);
	
	var text = "" + amt + " " + text;
	if ((amt != 1) && !abbrev) text += "s";
	
	return(neg + text);
};
