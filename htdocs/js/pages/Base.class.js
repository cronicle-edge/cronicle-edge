Class.subclass(Page, "Page.Base", {

	graph_colors: ["0,0,255", "138,43,226", "0,128,0", "255,20,147", "0,191,255", "210,105,30", "100,149,237", "220,20,60", "0,139,139", "128,128,128"],

	requireLogin: function (args) {
		// user must be logged into to continue
		var self = this;

		if (!app.user) {
			// require login
			app.navAfterLogin = this.ID;
			if (args && num_keys(args)) app.navAfterLogin += compose_query_string(args);

			this.div.hide();

			var session_id = app.getPref('session_id') || '';
			if (session_id) {
				Debug.trace("User has cookie, recovering session: " + session_id);

				app.api.post('user/resume_session', {
					session_id: session_id
				},
					function (resp) {
						if (resp.user) {
							Debug.trace("User Session Resume: " + resp.username + ": " + resp.session_id);
							app.hideProgress();
							app.doUserLogin(resp);
							Nav.refresh();
						}
						else {
							Debug.trace("User cookie is invalid, redirecting to login page");
							// Nav.go('Login');
							self.setPref('session_id', '');
							self.requireLogin(args);
						}
					});
			}
			else if (app.config.external_users) {
				Debug.trace("User is not logged in, querying external user API");
				app.doExternalLogin();
			}
			else {
				Debug.trace("User is not logged in, redirecting to login page (will return to " + this.ID + ")");
				setTimeout(function () { Nav.go('Login'); }, 1);
			}
			return false;
		}
		return true;
	},

	isAdmin: function () {
		// return true if user is logged in and admin, false otherwise
		// Note: This is used for UI decoration ONLY -- all privileges are checked on the server
		return (app.user && app.user.privileges && app.user.privileges.admin);
	},

	getNiceJob: function (id) {
		if (!id) return '(None)';
		if (typeof (id) == 'object') id = id.id;
		return '<div style="white-space:nowrap;"><i class="fa fa-pie-chart">&nbsp;</i>' + id + '</div>';
	},

	getNiceEvent: function (title, width, style, extra, extraTooltip) {
		if (!width) width = 500;
		if (!title) return '(None)';
		if (!style) style = '';
		if (!extra) extra = '';
		
		let tooltip = title.notes ? title.notes.replace(/\"/g, "&quot;") : ""
		let cat = title.category_title || '(none)'
		let plug = title.plugin_title || '(none)'
		let target = title.group_title || '(none)'

		if(extraTooltip) {
			tooltip = `<b>Category: </b>${cat}<br><b>Plugin: </b>${plug}<br><b>Target: </b>${target}<b><br>Notes:</b><br>${tooltip}`
		}

		let icon_class = 'fa fa-clock-o';
		if(title.plugin == 'workflow') icon_class = 'fa fa-folder';

		let icon =  `<i title="${tooltip}" class="${icon_class}">&nbsp;</i>`

		if (extraTooltip) {
			if (plug.toUpperCase().startsWith("DOCKER")) icon = `<span title="${tooltip}" class="mdi mdi-docker"></span>`
			// if (title.plugin == 'shellplug') icon = `<span title="${tooltip}" class="mdi mdi-script"></span>`
			if (plug.toUpperCase().startsWith("SSH")) icon = `<span title="${tooltip}" class="mdi mdi-console"></span>`
			if (plug.toUpperCase().startsWith("HTTP")) icon = `<span title="${tooltip}" class="mdi mdi-web"></span>`
		}

		if (typeof (title) == 'object') {
			title = title.title
        }
		
		return `<div class="ellip" style="max-width:${width}px;${style}">${icon} ${title}${extra}</div>`;
	},

	getNiceCategory: function (cat, width, collapse) {

		if (!cat) return '(None)';

		if (!width) width = 500;
		let icon = 'fa fa-folder-open-o'
		let iconClosed = 'fa fa-folder'

		let title = cat.title;
		if (!cat.enabled) title += ' (Disabled)';
		let onClick = arguments.length > 2 ? `onclick="this.className = this.className == '${icon}' ? '${iconClosed}' : '${icon}' ;$('.event_group_${cat.id}').toggle()"` : ''
		return `<div class="ellip" style="max-width:${width}px;"><i class="${collapse ? iconClosed : icon}" ${onClick}>&nbsp;</i>${title}</div>`;
	},

	getNiceGroup: function (group, target, width, collapse) {
		
		if (!group && !target) return '(None)';

        if (!width) width = 500;


		if (group) {

			let icon = 'mdi mdi-server-network'
			let iconClosed = 'fa fa-plus-square'
			let onClick = arguments.length > 3 ? `onclick="this.className = this.className == '${icon}' ? '${iconClosed}' : '${icon}' ;$('.event_group_${group.id}').toggle()"` : ''

			var title = group.title;
			if (group.multiplex) title += '&nbsp;(<i class="fa fa-bolt" title="Multiplexed"></i>)';
			return `<div class="ellip" style="max-width:${width}px;"><i class="${collapse ? iconClosed : icon}" ${onClick}>&nbsp;</i>${title}</div>`;
		}
		else {
			return '<div class="ellip" style="max-width:' + width + 'px;" title=""><i class="mdi mdi-desktop-tower mdi-lg">&nbsp;</i>' + target.replace(/\.[\w\-]+\.\w+$/, '') + '</div>';
		}
	},

	getNicePlugin: function (plugin, width, collapse) {

		if (!plugin) return '(None)';
		if (!width) width = 500;
		let icon = 'fa fa fa-plug'
		let iconClosed = 'fa fa-plus-square'

		var title = plugin.title;
		if (!plugin.enabled) title += ' (Disabled)';
		let onClick = arguments.length > 2 ? `onclick="this.className = this.className == '${icon}' ? '${iconClosed}' : '${icon}' ;$('.event_group_${plugin.id}').toggle()"` : ''
		return `<div class="ellip" style="max-width:${width}px;"><i class="${collapse ? iconClosed : icon}" ${onClick}>&nbsp;</i>${title}</div>`;
	},

	getNiceAPIKey: function (item, link, width) {
		if (!item) return 'n/a';
		if (!width) width = 500;
		var key = item.api_key || item.key;
		var title = item.api_title || item.title;

		var html = '<div class="ellip" style="max-width:' + width + 'px;">';
		if (link && key) html += '<a href="#Admin?sub=edit_api_key&id=' + item.id + '">';

		html += '<i class="mdi mdi-key-variant">&nbsp;</i>' + title;

		if (link && key) html += '</a>';
		html += '</div>';

		return html;
	},

	getNiceUsername: function (user, link, width) {
		if (!user) return 'n/a';
		if ((typeof (user) == 'object') && (user.key || user.api_title)) {
			return this.getNiceAPIKey(user, link, width);
		}
		if (!width) width = 500;
		var username = user.username ? user.username : user;
		if (!username || (typeof (username) != 'string')) return 'n/a';

		var html = '<div class="ellip" style="max-width:' + width + 'px;">';
		if (link) html += '<a href="#Admin?sub=edit_user&username=' + username + '">';

		html += '<i class="fa fa-user">&nbsp;&nbsp;</i>' + username;

		if (link) html += '</a>';
		html += '</div>';

		return html;
	},

	getNiceArgument: function(arg, maxWidth, context) {
		context = context || {}
		let nice_arg = encode_entities(`${arg || ''}`)
		if(nice_arg.length > maxWidth) nice_arg = nice_arg.substring(0,maxWidth-3) + "..."
		let href = '#History?sub=error_history'
		if(context.id) href += ('&id=' + context.id)
		if(context.error) href += '&error=1'
		return `<a href="${href}&max=25&arg=${encodeURIComponent(arg)}">${nice_arg}</a>`
	},

	setGroupVisible: function (group, visible) {
		// set web groups of form fields visible or invisible, 
		// according to manager checkbox for each section
		var selector = 'tr.' + group + 'group';
		if (visible) {
			if ($(selector).hasClass('collapse')) {
				$(selector).hide().removeClass('collapse');
			}
			$(selector).show(250);
		}
		else $(selector).hide(250);

		return this; // for chaining
	},

	checkUserExists: function (pre) {
		// check if user exists, update UI checkbox
		// called after field changes
		var username = trim($('#fe_' + pre + '_username').val().toLowerCase());
		var $elem = $('#d_' + pre + '_valid');

		if (username.match(/^[\w\.\-]+@?[\w\.\-]+$/)) {
			// check with server
			// $elem.css('color','#444').html('<span class="fa fa-spinner fa-spin fa-lg">&nbsp;</span>');
			app.api.get('app/check_user_exists', { username: username }, function (resp) {
				if (resp.user_exists) {
					// username taken
					$elem.css('color', 'red').html('<span class="fa fa-exclamation-triangle fa-lg">&nbsp;</span>Username Taken');
				}
				else {
					// username is valid and available!
					$elem.css('color', 'green').html('<span class="fa fa-check-circle fa-lg">&nbsp;</span>Available');
				}
			});
		}
		else if (username.length) {
			// bad username
			$elem.css('color', 'red').html('<span class="fa fa-exclamation-triangle fa-lg">&nbsp;</span>Bad Username');
		}
		else {
			// empty
			$elem.html('');
		}
	},

	check_add_remove_me: function ($elem) {
		// check if user's e-mail is contained in text field or not
		var value = $elem.val().toLowerCase();
		var email = app.user.email.toLowerCase();
		var regexp = new RegExp("\\b" + escape_regexp(email) + "\\b");
		return !!value.match(regexp);
	},

	update_add_remove_me: function ($elems) {
		// update add/remove me text based on if user's e-mail is contained in text field
		var self = this;

		$elems.each(function () {
			var $elem = $(this);
			var $span = $elem.next();

			if (self.check_add_remove_me($elem)) $span.html('&raquo; Remove me');
			else $span.html('&laquo; Add me');
		});
	},

	add_remove_me: function ($elem) {
		// toggle user's e-mail in/out of text field
		var value = trim($elem.val().replace(/\,\s*\,/g, ',').replace(/^\s*\,\s*/, '').replace(/\s*\,\s*$/, ''));

		if (this.check_add_remove_me($elem)) {
			// remove e-mail
			var email = app.user.email.toLowerCase();
			var regexp = new RegExp("\\b" + escape_regexp(email) + "\\b", "i");
			value = value.replace(regexp, '').replace(/\,\s*\,/g, ',').replace(/^\s*\,\s*/, '').replace(/\s*\,\s*$/, '');
			$elem.val(trim(value));
		}
		else {
			// add email
			if (value) value += ', ';
			$elem.val(value + app.user.email);
		}

		this.update_add_remove_me($elem);
	},

	get_custom_combo_unit_box: function (id, value, items, class_name) {
		// get HTML for custom combo text/menu, where menu defines units of measurement
		// items should be array for use in render_menu_options(), with an increasing numerical value
		if (!class_name) class_name = 'std_combo_unit_table';
		var units = 0;
		var value = parseInt(value || 0);

		for (var idx = items.length - 1; idx >= 0; idx--) {
			var max = items[idx][0];
			if ((value >= max) && (value % max == 0)) {
				units = max;
				value = Math.floor(value / units);
				idx = -1;
			}
		}
		if (!units) {
			// no exact match, so default to first unit in list
			units = items[0][0];
			value = Math.floor(value / units);
		}

		return (
			'<table cellspacing="0" cellpadding="0" class="' + class_name + '"><tr>' +
			'<td style="padding:0"><input type="text" id="' + id + '" style="width:30px;" value="' + value + '"/></td>' +
			'<td style="padding:0"><select id="' + id + '_units">' + render_menu_options(items, units) + '</select></td>' +
			'</tr></table>'
		);
	},

	get_relative_time_combo_box: function (id, value, class_name, inc_seconds) {
		// get HTML for combo textfield/menu for a relative time based input
		// provides Minutes, Hours and Days units
		var unit_items = [[60, 'Minutes'], [3600, 'Hours'], [86400, 'Days']];
		if (inc_seconds) unit_items.unshift([1, 'Seconds']);

		return this.get_custom_combo_unit_box(id, value, unit_items, class_name);
	},

	get_relative_size_combo_box: function (id, value, class_name) {
		// get HTML for combo textfield/menu for a relative size based input
		// provides MB, GB and TB units
		var TB = 1024 * 1024 * 1024 * 1024;
		var GB = 1024 * 1024 * 1024;
		var MB = 1024 * 1024;
		var KB = 1024;

		return this.get_custom_combo_unit_box(id, value, [[KB, 'KB'], [MB, 'MB'], [GB, 'GB'], [TB, 'TB']], class_name);
	},

	expand_fieldset: function ($span) {
		// expand neighboring fieldset, and hide click control
		var $div = $span.parent();
		var $fieldset = $div.next();
		$fieldset.show(350);
		$div.hide(350);
	},

	collapse_fieldset: function ($legend) {
		// collapse fieldset, and show click control again
		var $fieldset = $legend.parent();
		var $div = $fieldset.prev();
		$fieldset.hide(350);
		$div.show(350);
	},

	choose_date_time: function (args) {
		// show dialog for selecting a date/time
		// args: {
		//		when: default date/time (epoch or Date object, defaults to now)
		//		timezone: custom timezone (defaults to app.tz)
		//		title: dialog title
		//		description: optional description
		//		button: optional button label ("Select")
		//		callback: fired when complete, passed new date/time
		// }
		var self = this;
		var html = '';

		if (!args.when) args.when = time_now();
		if (!args.timezone) args.timezone = app.tz;
		if (!args.title) args.title = "Select Date/Time";
		if (!args.button) args.button = "Select";

		if (args.description) {
			html += '<div style="font-size:12px; color:#777; margin-bottom:20px;">' + args.description + '</div>';
		}

		// var dargs = get_date_args( args.when );
		var margs = moment.tz(args.when * 1000, args.timezone);

		html += '<center><table><tr>';

		// years
		var year_items = [];
		for (var idx = margs.year() - 10; idx <= margs.year() + 10; idx++) {
			year_items.push(idx);
		}
		html += '<td align="left"><fieldset class="dt_fs"><legend>Year</legend>';
		html += '<select id="fe_dt_year">' + render_menu_options(year_items, margs.year()) + '</select>';
		html += '</fieldset></td>';

		// months
		html += '<td align="left"><fieldset class="dt_fs" style="margin-left:5px;"><legend>Month</legend>';
		html += '<select id="fe_dt_month">' + render_menu_options(_months, margs.month() + 1) + '</select>';
		html += '</fieldset></td>';

		// days
		html += '<td align="left"><fieldset class="dt_fs" style="margin-left:5px;"><legend>Day</legend>';
		html += '<select id="fe_dt_day">' + render_menu_options(_days, margs.date()) + '</select>';
		html += '</fieldset></td>';

		// hours
		var hour_items = _hour_names.map(function (value, idx) {
			return [idx, value.toUpperCase().replace(/^(\d+)(\w+)$/, '$1 $2')];
		});
		html += '<td align="left"><fieldset class="dt_fs" style="margin-left:5px;"><legend>Hour</legend>';
		html += '<select id="fe_dt_hour">' + render_menu_options(hour_items, margs.hour()) + '</select>';
		html += '</fieldset></td>';

		// minutes
		var min_items = [];
		for (var idx = 0; idx < 60; idx++) {
			min_items.push([idx, (idx < 10) ? ('0' + idx) : ('' + idx)]);
		}
		html += '<td align="left"><fieldset class="dt_fs" style="margin-left:5px;"><legend>Minute</legend>';
		html += '<select id="fe_dt_minute">' + render_menu_options(min_items, margs.minute()) + '</select>';
		html += '</fieldset></td>';

		html += '</tr>';
		html += '<tr><td align="left" colspan="5">';
		html += '<div class="caption">Timezone: ' + args.timezone + '</div>';
		html += '</td></tr>';
		html += '</table></center>';

		app.confirm('<i class="fa fa-calendar">&nbsp;</i>' + args.title, html, args.button, function (result) {
			app.clearError();

			if (result) {
				Dialog.hide();

				margs.year(parseInt($('#fe_dt_year').val()));
				margs.month(parseInt($('#fe_dt_month').val()) - 1);
				margs.date(parseInt($('#fe_dt_day').val()));
				margs.hour(parseInt($('#fe_dt_hour').val()));
				margs.minute(parseInt($('#fe_dt_minute').val()));
				margs.second(0);

				args.callback(margs.unix());
			}
		}); // app.confirm
	},

	render_target_menu_options: function (value) {
		// render menu items for server group (target)
		// including optgroups for both server group and individual servers
		var html = '';

		var server_groups = app.server_groups.sort(function (a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		})
			.filter(function (group) {
				if (!app.user.privileges.grp_limit) return true; // user is not limited by groups
				return app.hasPrivilege('grp_' + group.id);
			});

		html += '<optgroup label="Groups:">' + render_menu_options(server_groups, value, false) + '</optgroup>';

		if (find_object(server_groups, { id: value })) value = '';

		// trim hostname suffixes
		var hostnames = hash_keys_to_array(app.servers).sort();
		if (value && !app.servers[value]) hostnames.push(value);

		// filter hostnames by server group privilege
		if (app.user.privileges.grp_limit) {
			hostnames = hostnames.filter(function(hostname) {
				var groups = server_groups.filter( function(group) {
					return hostname.match( group.regexp );
				} );

				// we just need one group to match, then the user has permission to target the server
				for (var idx = 0, len = groups.length; idx < len; idx++) {
					priv_id = 'grp_' + groups[idx].id;
					result = app.hasPrivilege(priv_id);
					if (result) return true;
				}
				return false;
			});
		} // grp_limit

		var short_hostnames = [];
		for (var idx = 0, len = hostnames.length; idx < len; idx++) {
			short_hostnames.push([hostnames[idx], hostnames[idx].replace(/\.[\w\-]+\.\w+$/, '')]);
		}

		html += '<optgroup label="Servers:">' + render_menu_options(short_hostnames, value, false) + '</optgroup>';
		return html;
	}

});
