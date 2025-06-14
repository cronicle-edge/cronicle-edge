// Cronicle JobDetails Page


Class.subclass(Page.Base, "Page.JobDetails", {

	pie_colors: {
		cool: 'green',
		warm: 'rgb(240,240,0)',
		hot: '#F7464A',
		progress: '#3f7ed5',
		empty: 'rgba(0, 0, 0, 0.05)'
	},

	onInit: function () {
		// called once at page load
		// var html = '';
		// this.div.html( html );
		this.charts = {};
	},

	live_log_is_up: false,

	onActivate: function (args) {
		// page activation
		if (!this.requireLogin(args)) return true;

		if (!args) args = {};
		this.args = args;

		if (!args.id) {
			app.doError("The Job Details page requires a Job ID.");
			return true;
		}

		app.setWindowTitle("Job Details: #" + args.id);
		app.showTabBar(true);

		this.tab.show();
		this.tab[0]._page_id = Nav.currentAnchor();

		this.retry_count = 3;
		this.go_when_ready();

		return true;
	},

	go_when_ready: function () {
		// make sure we're not in the limbo state between starting a manual job,
		// and waiting for activeJobs to be updated
		var self = this;
		var args = this.args;

		if (this.find_job(args.id)) {
			// job is currently active -- jump to real-time view
			args.sub = 'live';
			this.gosub_live(args);
		}
		else {
			// job must be completed -- jump to archive view
			args.sub = 'archive';
			this.gosub_archive(args);
		}
	},

	gosub_archive: function (args) {
		// show job archive
		var self = this;
		Debug.trace("Showing archived job: " + args.id);
		this.div.addClass('loading');

		app.api.post('app/get_job_details', { id: args.id }, this.receive_details.bind(this), function (resp) {
			// error capture
			if (self.retry_count >= 0) {
				Debug.trace("Failed to get_job_details, trying again in 1s...");
				self.retry_count--;
				setTimeout(function () { self.go_when_ready(); }, 1000);
			}
			else {
				// show error
				app.doError("Error: " + resp.description);
				self.div.removeClass('loading');
			}
		});
	},

	get_job_result_banner: function (job) {
		// render banner based on job result
		var icon = '';
		var type = '';
		if (job.abort_reason || job.unknown || job.code == 255) {
			type = 'warning';
			icon = 'exclamation-circle';
		}
		else if (job.code) {
			type = 'error';
			icon = 'exclamation-triangle';
		}
		else {
			type = 'success';
			icon = 'check-circle';
		}

		if (!job.description && job.code) {
			job.description = "Job failed with code: " + job.code;
		}
		if (!job.code && (!job.description || job.description.replace(/\W+/, '').match(/^success(ful)?$/i))) {
			job.description = "Job completed successfully at " + get_nice_date_time(job.time_end, false, true);

			// add timezone abbreviation
			job.description += " " + moment.tz(job.time_end * 1000, app.tz).format('z');
		}
		if (job.code && !job.description.match(/^\s*error/i)) {
			var desc = job.description;
			job.description = "Error";
			if (job.code != 1) job.description += " " + job.code;
			if (job.code == 255) { job.description = "Warning" };
			job.description += ": " + desc;
		}

		var job_desc_html = trim(job.description.replace(/\r\n/g, "\n"));
		var multiline = !!job.description.match(/\n/);
		job_desc_html = encode_entities(job_desc_html).replace(/\n/g, "<br/>\n");

		var html = '';
		html += '<div class="message inline ' + type + '"><div class="message_inner">';

		if (multiline) {
			html += job_desc_html;
		}
		else {
			html += '<i class="fa fa-' + icon + ' fa-lg" style="transform-origin:50% 50%; transform:scale(1.25); -webkit-transform:scale(1.25);">&nbsp;&nbsp;&nbsp;</i>' + job_desc_html;
		}
		html += '</div></div>';
		return html;
	},

	delete_job: function () {
		// delete job, after confirmation
		var self = this;
		var job = this.job;

		app.confirm('<span style="color:red">Delete Job</span>', "Are you sure you want to delete the current job log and history?", "Delete", function (result) {
			if (result) {
				app.showProgress(1.0, "Deleting job...");
				app.api.post('app/delete_job', job, function (resp) {
					app.hideProgress();
					app.showMessage('success', "Job ID '" + job.id + "' was deleted successfully.");
					$('#tab_History').trigger('click');
					self.tab.hide();
				});
			}
		});
	},

	run_again: function () {
		// run job again
		var self = this;
		var event = find_object(app.schedule, { id: this.job.event }) || null;
		if (!event) return app.doError("Could not locate event in schedule: " + this.job.event_title + " (" + this.job.event + ")");

		var job = deep_copy_object(event);
		job.now = this.job.now;
		job.params = this.job.params;

		app.showProgress(1.0, "Starting job...");

		app.api.post('app/run_event', job, function (resp) {
			// app.showMessage('success', "Event '"+event.title+"' has been started.");
			self.jump_live_job_id = resp.ids[0];
			self.jump_live_time_start = hires_time_now();
			self.jump_to_live_when_ready();
		});
	},

	jump_to_live_when_ready: function () {
		// make sure live view is ready (job may still be starting)
		var self = this;
		if (!this.active) return; // user navigated away from page

		if (app.activeJobs[this.jump_live_job_id] || ((hires_time_now() - this.jump_live_time_start) >= 3.0)) {
			app.hideProgress();
			Nav.go('JobDetails?id=' + this.jump_live_job_id);
			delete this.jump_live_job_id;
			delete this.jump_live_time_start;
		}
		else {
			setTimeout(self.jump_to_live_when_ready.bind(self), 250);
		}
	},

	receive_details: function (resp) {
		// receive job details from server, render them
		var html = '';
		var job = this.job = resp.job;
		this.div.removeClass('loading');

		var size = get_inner_window_size();
		var col_width = Math.floor(((size.width * 0.9) - 300) / 4);

		// locate objects
		var event = find_object(app.schedule, { id: job.event }) || {};
		var cat = job.category ? find_object(app.categories, { id: job.category }) : null;
		var group = event.target ? find_object(app.server_groups, { id: event.target }) : null;
		var plugin = job.plugin ? find_object(app.plugins, { id: job.plugin }) : null;

		if (group && event.multiplex) {
			group = copy_object(group);
			group.multiplex = 1;
		}

		html += '<div class="subtitle" style="margin-top:7px; margin-bottom:13px;">';
		html += 'Completed Job';

		if (event.id && !event.multiplex) html += '<div class="subtitle_widget" style="margin-left:2px;"><span class="link" onMouseUp="$P().run_again()"><i class="fa fa-repeat">&nbsp;</i><b>Run Again</b></span></div>';
		let jumpToHist = `<div><a href="#History?sub=event_history&id=${event.id}"><i class="fa fa-arrow-circle-right">&nbsp;</i><b>Jump to History</b></a></div>`;
		//adding edit button on job detail page
		if (event.id) html += '<div class="subtitle_widget" style="margin-left:2px;"><a href="#Schedule?sub=edit_event&id=' + event.id + '" target="_self"><span class="link"><i class="fa fa-edit">&nbsp;</i><b>Edit</b></span></a></div>';
		if (app.isAdmin()) html += '<div class="subtitle_widget"><span class="link abort" onMouseUp="$P().delete_job()"><i class="fa fa-trash-o">&nbsp;</i><b>Delete Job</b></span></div>';
		
		html += '<div class="clear"></div>';
		html += '</div>';

		// result banner
		// (adding replace to remove ansi color characters)
		html += this.get_job_result_banner(job).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

		// fieldset header
		html += '<fieldset style="display:none;margin-top:8px; margin-right:0px; padding-top:10px; position:relative;"><legend>Job Details</legend>';

		let eventTitle = '(None)'
		if (event.id) eventTitle = '<a href="#Schedule?sub=edit_event&id=' + job.event + '">' + this.getNiceEvent(job.event_title, col_width) + '</a>';
		else if (job.event_title) eventTitle = this.getNiceEvent(job.event_title, col_width);

        let jobCategory = '(None)'
		if (cat) jobCategory = this.getNiceCategory(cat, col_width);
		else if (job.category_title) jobCategory= this.getNiceCategory({ title: job.category_title }, col_width);

        let jobPlugin = '(None)'
		if (plugin) jobPlugin = this.getNicePlugin(plugin, col_width);
		else if (job.plugin_title) jobPlugin = this.getNicePlugin({ title: job.plugin_title }, col_width);

		let jobTarget = '(None)'
		if (group || event.target) jobTarget = this.getNiceGroup(group, event.target, col_width);
		else if (job.nice_target) jobTarget = '<div class="ellip" style="max-width:' + col_width + 'px;">' + job.nice_target + '</div>';

		let jobStarted = get_nice_date_time(job.time_start, true, true);
		if ((job.time_start - job.now >= 60) && !event.multiplex && !job.source) {
			jobStarted = `<span style="color:red" title="Scheduled Time: ${get_nice_date_time(job.now, true, true)}">${get_nice_date_time(job.time_start, true, true)}</span>`
		}

		html += '</fieldset>';

		let timing = summarize_event_timing(event.timing, event.timezone)

		html += `
		  <div class="job-details grid-container" style="font-size:1.1em">
		    
		    <div class="job-details  grid-item"><div class="info_label">JOB ID:</div><div class="info_value">${job.id}</div></div>
			<div class="job-details  grid-item"><div class="info_label">PID:</div><div class="info_value">${(job.detached_pid || job.pid || '(Unknown)')}</div></div>
		    <div class="job-details  grid-item"><div class="info_label">CAT:</div><div class="info_value">${jobCategory}</div></div>
		    <div class="job-details  grid-item"><div class="info_label">SOURCE:</div><div title="${timing}" class="info_value">${job.source || 'Scheduler'}</div></div>
			<div class="job-details  grid-item"><div class="info_label">TARGET:</div><div class="info_value">${jobTarget}</div></div>
		    <div class="job-details  grid-item"><div class="info_label">START:</div><div class="info_value">${jobStarted}</div></div>
			<div class="job-details  grid-item"><div class="info_label">ELAPSED:</div><div class="info_value">${get_text_from_seconds(job.elapsed, false, false)}</div></div>		    
		    
			<div class="job-details  grid-item"><div class="info_value">${eventTitle}</div></div>
			<div class="job-details  grid-item"><div class="info_label">ARG:</div><div class="info_value">${encode_entities(job.arg || '(None)')}</div></div>
			<div class="job-details  grid-item"><div class="info_label">PLUGIN:</div><div class="info_value">${jobPlugin}</div></div>
			<div class="job-details  grid-item"><div class="info_label">MEMO:</div><div class="info_value">${job.memo || '(None)'}</div></div>
		    <div class="job-details  grid-item"><div class="info_label">HOST:</div><div class="info_value">${this.getNiceGroup(null, job.hostname, col_width)}</div></div>
		    <div class="job-details  grid-item"><div class="info_label">END:</div><div class="info_value">${get_nice_date_time(job.time_end, true, true)}</div></div>   				    			
			<div class="job-details  grid-item"><div class="info_value">${jumpToHist }</div></div>
			
		  </div>
		  <div class="clear"></div>
		`

		// <div class="job-details  grid-item"><div class="info_value ellip" title="${timing}"style="max-width:300px"><i class="fa fa-clock-o" aria-hidden="true"></i> ${timing}</div></div>

		// pies
		html += '<div style="position:relative; margin-top:25px;">';

		html += '<div class="pie-column column-left">';
		html += '<div class="pie-title">Performance Metrics</div>';
		html += '<div id="d_graph_arch_perf" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_arch_perf" class="pie"></canvas></div>';
		// html += '<canvas id="c_arch_perf" width="250" height="250" class="pie"></canvas>';
		html += '<div id="d_arch_perf_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '<div class="pie-column column-right">';
		html += '<div id="d_arch_mem_overlay" class="pie-overlay"></div>';
		html += '<div class="pie-title">Memory Usage</div>';
		html += '<div id="d_graph_arch_mem" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_arch_mem" class="pie"></canvas></div>';
		// html += '<canvas id="c_arch_mem" width="250" height="250" class="pie"></canvas>';
		html += '<div id="d_arch_mem_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '<div class="pie-column column-center">';
		html += '<div id="d_arch_cpu_overlay" class="pie-overlay"></div>';
		html += '<div class="pie-title">CPU Usage</div>';
		html += '<div id="d_graph_arch_cpu" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_arch_cpu" class="pie"></canvas></div>';
		// html += '<canvas id="c_arch_cpu" width="250" height="250" class="pie"></canvas>';
		html += '<div id="d_arch_cpu_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '</div>';

		// custom data table
		if (job.table && job.table.rows && job.table.rows.length) {
			var table = job.table;
			html += '<div class="subtitle" style="margin-top:15px;">' + (table.title || 'Job Stats') + '</div>';
			html += '<table class="data_table" style="width:100%">';

			if (table.header && table.header.length) {
				html += '<tr>';
				for (var idx = 0, len = table.header.length; idx < len; idx++) {
					html += '<th>' + table.header[idx] + '</th>';
				}
				html += '</tr>';
			}

			var filters = table.filters || [];

			for (var idx = 0, len = table.rows.length; idx < len; idx++) {
				var row = table.rows[idx];
				if (row && row.length) {
					html += '<tr>';

					for (var idy = 0, ley = row.length; idy < ley; idy++) {
						var col = row[idy];
						html += '<td>';
						if (typeof (col) != 'undefined') {
							if (filters[idy] && window[filters[idy]]) html += window[filters[idy]](col);
							else if ((typeof (col) == 'string') && col.match(/^filter\:(\w+)\((.+)\)$/)) {
								var filter = RegExp.$1;
								var value = RegExp.$2;
								if (window[filter]) html += window[filter](value);
								else html += value;
							}
							else html += col;
						}
						html += '</td>';
					} // foreach col

					html += '</tr>';
				} // good row
			} // foreach row

			html += '</table>';
			if (table.caption) html += '<div class="caption" style="margin-top:4px; text-align:center;">' + table.caption + '</div>';
		} // custom data table

		// custom html table (and also error output on job detail page)
		//adding replace to remove ansi color characters
		if (job.html) {
			html += '<div class="subtitle" style="margin-top:15px;">' + (job.html.title || 'Job Report') + '</div>';
			html += '<div>' + job.html.content.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") + '</div>';
			if (job.html.caption) html += '<div class="caption" style="margin-top:4px; text-align:center;">' + job.html.caption + '</div>';
		}

		// log grid

		html += `<div id="log_grid" class="wflog grid-container"></div>`

		// job log (IFRAME)
		html += '<div class="subtitle" style="margin-top:15px;">';
		html += 'Console Output';
		var logSize = ""
		if (job.log_file_size) logSize += ' (' + get_text_from_bytes(job.log_file_size, 1) + ')';
		html += `<div class="subtitle_widget" style="margin-left:2px;"><a href="./console?id=${job.id}" target="_blank"><i class="fa fa-external-link">&nbsp;</i><b>View Full Log</b></a></div>`;
		html += '<div class="subtitle_widget"><a style="cursor:pointer" onMouseUp="$P().do_download_log()"><i class="fa fa-download">&nbsp;</i><b>Download Log ' + logSize + '</b></a></div>';
		html += '<div class="clear"></div>';
		html += '</div>';

		var max_log_file_size = config.max_log_file_size || 10485760;
		if (job.log_file_size && (job.log_file_size >= max_log_file_size)) {
			// too big to show?  ask user
			html += '<div id="d_job_log_warning">';
			html += '<table class="data_table" width="100%"><tr><td style="padding-top:50px; padding-bottom:50px; text-align:center">';
			html += '<div style="margin-bottom:15px;"><b>Warning: Job event log file is ' + get_text_from_bytes(job.log_file_size, 1) + '.  Please consider downloading instead of viewing in browser.</b></div>';
			html += '<div style="width:50%; float:left;"><div class="button right" style="width:110px; margin-right:20px;" onMouseUp="$P().do_download_log()">Download Log</div></div>';
			html += '<div style="width:50%; float:left;"><div class="button left" style="width:110px; margin-left:20px;" onMouseUp="$P().do_view_inline_log()">View Log</div></div>';
			html += '<div class="clear"></div>';
			html += '</td></tr></table>';
			html += '</div>';
		}
		else {
			var size = get_inner_window_size();
			var iheight = size.height - 100;
			//html += '<iframe id="i_arch_job_log" style="width:100%; height:'+iheight+'px; border:none;" frameborder="0" src="'+app.base_api_url+'/app/get_job_log?id='+job.id+'"></iframe>';

			// replace iframe with ajax output. This will make log output look like terminal, and also fixes ansi colors
			html += '<div style="background-color:black;color:#f2f2f2;background-image: radial-gradient(rgba(48, 48, 48, 1), black 300%);font: 1rem Inconsolata, monospace;"><pre id="console_output"></pre></div>'
			var ansi_up = new AnsiUp;

			$.get(`./api/app/get_job_log?id=${job.id}&session_id=${localStorage.session_id}`, function (data) {
				data = data.split("\n").slice(4, -4).join("\n").replace(/\u001B=/g, '');  // removeing Esc= sequence generated by powershell pipe
				$("#console_output").html(ansi_up.ansi_to_html(data));
			});
		}

		this.div.html(html);

		// arch perf chart
		var suffix = ' sec';
		var pscale = 1;
		if (!job.perf) job.perf = { total: job.elapsed };
		if (!isa_hash(job.perf)) job.perf = parse_query_string(job.perf.replace(/\;/g, '&'));

		if (job.perf.scale) {
			pscale = job.perf.scale;
			delete job.perf.scale;
		}

		var perf = job.perf.perf ? job.perf.perf : job.perf;

		// remove counters from pie
		for (var key in perf) {
			if (key.match(/^c_/)) delete perf[key];
		}

		// clean up total, add other
		if (perf.t) { perf.total = perf.t; delete perf.t; }
		if ((num_keys(perf) > 1) && perf.total) {
			if (!perf.other) {
				var totes = 0;
				for (var key in perf) {
					if (key != 'total') totes += perf[key];
				}
				if (totes < perf.total) {
					perf.other = perf.total - totes;
				}
			}
			delete perf.total; // only show total if by itself
		}

		// remove outer 'umbrella' perf keys if inner ones are more specific
		// (i.e. remove "db" if we have "db_query" and/or "db_connect")
		for (var key in perf) {
			for (var subkey in perf) {
				if ((subkey.indexOf(key + '_') == 0) && (subkey.length > key.length + 1)) {
					delete perf[key];
					break;
				}
			}
		}

		// divide everything by scale, so we get seconds
		for (var key in perf) {
			perf[key] /= pscale;
		}

		var colors = this.graph_colors;
		var color_idx = 0;

		var p_data = [];
		var p_colors = [];
		var p_labels = [];

		var perf_keys = hash_keys_to_array(perf).sort();

		for (var idx = 0, len = perf_keys.length; idx < len; idx++) {
			var key = perf_keys[idx];
			var value = perf[key];

			p_data.push(short_float(value));
			p_colors.push('rgb(' + colors[color_idx] + ')');
			p_labels.push(key);

			color_idx = (color_idx + 1) % colors.length;
		}

		var ctx = $("#c_arch_perf").get(0).getContext("2d");

		var perf_chart = new Chart(ctx, {
			type: 'pie',
			data: {
				datasets: [{
					data: p_data,
					backgroundColor: p_colors,
					label: ''
				}],
				labels: p_labels
			},
			options: {
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		var legend_html = '';
		legend_html += '<div class="pie-legend-container">';
		for (var idx = 0, len = perf_keys.length; idx < len; idx++) {
			legend_html += '<div class="pie-legend-item" style="background-color:' + p_colors[idx] + '">' + filterXSS(p_labels[idx]) + '</div>';
		}
		legend_html += '</div>';

		var perf_legend = $('#d_arch_perf_legend');
		perf_legend.html(legend_html);


		this.charts.perf = perf_chart;

		// arch cpu pie
		var cpu_avg = 0;
		if (!job.cpu) job.cpu = {};
		if (job.cpu.total && job.cpu.count) {
			cpu_avg = short_float(job.cpu.total / job.cpu.count);
		}

		var jcm = 100;
		var ctx = $("#c_arch_cpu").get(0).getContext("2d");

		var cpu_chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				datasets: [{
					data: [
						Math.min(cpu_avg, jcm),
						jcm - Math.min(cpu_avg, jcm),
					],
					backgroundColor: [
						(cpu_avg < jcm * 0.5) ? this.pie_colors.cool :
							((cpu_avg < jcm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot),
						this.pie_colors.empty
					],
					label: ''
				}],
				labels: []
			},
			options: {
				events: [],
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		// arch cpu overlay
		var html = '';
		html += '<div class="pie-overlay-title">' + cpu_avg + '%</div>';
		html += '<div class="pie-overlay-subtitle">Average</div>';
		$('#d_arch_cpu_overlay').html(html);

		// arch cpu legend
		var html = '';

		html += '<div class="info_label">MIN</div>';
		html += '<div class="info_value">' + short_float(job.cpu.min || 0) + '%</div>';

		html += '<div class="info_label">PEAK</div>';
		html += '<div class="info_value">' + short_float(job.cpu.max || 0) + '%</div>';

		$('#d_arch_cpu_legend').html(html);

		this.charts.cpu = cpu_chart;

		// arch mem pie
		var mem_avg = 0;
		if (!job.mem) job.mem = {};
		if (job.mem.total && job.mem.count) {
			mem_avg = Math.floor(job.mem.total / job.mem.count);
		}

		var jmm = config.job_memory_max || 1073741824;
		var ctx = $("#c_arch_mem").get(0).getContext("2d");

		var mem_chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				datasets: [{
					data: [
						Math.min(mem_avg, jmm),
						jmm - Math.min(mem_avg, jmm),
					],
					backgroundColor: [
						(mem_avg < jmm * 0.5) ? this.pie_colors.cool :
							((mem_avg < jmm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot),
						this.pie_colors.empty
					],
					label: ''
				}],
				labels: []
			},
			options: {
				events: [],
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		// arch mem overlay
		var html = '';
		html += '<div class="pie-overlay-title">' + get_text_from_bytes(mem_avg, 10) + '</div>';
		html += '<div class="pie-overlay-subtitle">Average</div>';
		$('#d_arch_mem_overlay').html(html);

		// arch mem legend
		var html = '';

		html += '<div class="info_label">MIN</div>';
		html += '<div class="info_value">' + get_text_from_bytes(job.mem.min || 0, 1) + '</div>';

		html += '<div class="info_label">PEAK</div>';
		html += '<div class="info_value">' + get_text_from_bytes(job.mem.max || 0, 1) + '</div>';

		$('#d_arch_mem_legend').html(html);

		this.charts.mem = mem_chart;
	},

	do_download_log: function () {
		// download job log file
		var job = this.job;
		window.location =  './api/app/get_job_log?id=' + job.id + '&download=1' + '&session_id=' + localStorage.session_id;
	},

	unsetLogIcon(id) {
		let el = document.getElementById('view_' + id)
		if(el) el.className = 'fa fa-eye'
	},

	get_log_to_grid: function(title, id) {
		if(!title) return
		if(!id) id = title 
		let curr = document.getElementById('log_' + id)
		if(curr) { curr.remove(); return }

		$.get(`./api/app/get_job_log?id=${id}&session_id=${localStorage.session_id}`, (resp)=>{
			let size = this.args.tail || 25
			data = new AnsiUp().ansi_to_html(resp.split("\n").slice(-1*size - 4, -4).join("\n"))
			const newItem = document.createElement('div');
			newItem.setAttribute('id', 'log_' + id)
            newItem.className = 'wflog grid-item'; // Apply any necessary classes
            newItem.innerHTML = `<div class="wflog grid-title">${title}<i class="fa fa-window-close" style="float:right; cursor: pointer" onclick="$P().unsetLogIcon('${id}');this.parentNode.parentNode.remove()"></i></div> <pre>${data}</pre>`;
            const gridContainer = document.getElementById('log_grid');
            gridContainer.appendChild(newItem);
			
		})
	},

	do_view_inline_log: function () {
		// swap out job log size warning with IFRAME containing inline log
		var job = this.job;
		var html = '';

		var size = get_inner_window_size();
		var iheight = size.height - 100;
		html += '<iframe id="i_arch_job_log" style="width:100%; height:' + iheight + `px; border:none;" frameborder="0" src="./api/app/get_job_log?id=` + job.id + '"></iframe>';

		$('#d_job_log_warning').html(html);
	},

	abort_job: function () {
		// abort job, after confirmation
		var job = this.find_job(this.args.id);

		app.confirm('<span style="color:red">Abort Job</span>', "Are you sure you want to abort the current job?", "Abort", function (result) {
			if (result) {
				app.showProgress(1.0, "Aborting job...");
				app.api.post('app/abort_job', job, function (resp) {
					app.hideProgress();
					app.showMessage('success', "Job '" + job.event_title + "' was aborted successfully.");
				});
			}
		});
	},

	check_watch_enabled: function (job) {
		// check if watch is enabled on current live job
		var watch_enabled = 0;
		var email = app.user.email.toLowerCase();
		if (email && job.notify_success && (job.notify_success.toLowerCase().indexOf(email) > -1)) watch_enabled++;
		if (email && job.notify_fail && (job.notify_fail.toLowerCase().indexOf(email) > -1)) watch_enabled++;
		return (watch_enabled == 2);
	},

	watch_add_me: function (job, key) {
		// add current user's e-mail to job property
		if (!job[key]) job[key] = '';
		var value = trim(job[key].replace(/\,\s*\,/g, ',').replace(/^\s*\,\s*/, '').replace(/\s*\,\s*$/, ''));
		var email = app.user.email.toLowerCase();
		var regexp = new RegExp("\\b" + escape_regexp(email) + "\\b", "i");

		if (!value.match(regexp)) {
			if (value) value += ', ';
			job[key] = value + app.user.email;
		}
	},

	watch_remove_me: function (job, key) {
		// remove current user's email from job property
		if (!job[key]) job[key] = '';
		var value = trim(job[key].replace(/\,\s*\,/g, ',').replace(/^\s*\,\s*/, '').replace(/\s*\,\s*$/, ''));
		var email = app.user.email.toLowerCase();
		var regexp = new RegExp("\\b" + escape_regexp(email) + "\\b", "i");

		value = value.replace(regexp, '').replace(/\,\s*\,/g, ',').replace(/^\s*\,\s*/, '').replace(/\s*\,\s*$/, '');
		job[key] = trim(value);
	},

	toggle_watch: function () {
		// toggle watch on/off on current live job
		var job = this.find_job(this.args.id);
		var watch_enabled = this.check_watch_enabled(job);

		if (!watch_enabled) {
			this.watch_add_me(job, 'notify_success');
			this.watch_add_me(job, 'notify_fail');
		}
		else {
			this.watch_remove_me(job, 'notify_success');
			this.watch_remove_me(job, 'notify_fail');
		}

		// update on server
		$('#s_watch_job > i').removeClass().addClass('fa fa-spin fa-spinner');

		app.api.post('app/update_job', { id: job.id, notify_success: job.notify_success, notify_fail: job.notify_fail }, function (resp) {
			watch_enabled = !watch_enabled;
			if (watch_enabled) {
				app.showMessage('success', "You will now be notified via e-mail when the job completes (success or fail).");
				$('#s_watch_job').css('color', '#3f7ed5');
				$('#s_watch_job > i').removeClass().addClass('fa fa-check-square-o');
			}
			else {
				app.showMessage('success', "You will no longer be notified about this job.");
				$('#s_watch_job').css('color', '#777');
				$('#s_watch_job > i').removeClass().addClass('fa fa-square-o');
			}
		});
	},

	// toggle_autoscroll: function (element) {

	// 	if(app.getPref('autoscroll') === 'N') {
	// 		app.setPref('autoscroll', 'Y')
	// 		element.innerHTML = '<b>autoscroll: on</b>'
	// 	}
	// 	else {
	// 		app.setPref('autoscroll', 'N')
	// 		element.innerHTML = '<b>autoscroll: off</b>'
	// 	}

    //  	console.log('autoscropp is set to', app.getPref('autoscroll'))
	// },

	gosub_live: function (args) {
		// show live job status
		Debug.trace("Showing live job: " + args.id);
		var job = this.find_job(args.id);
		var html = '';
		this.div.removeClass('loading');

		var size = get_inner_window_size();
		var col_width = Math.floor(((size.width * 0.9) - 300) / 4);

		// locate objects
		var event = find_object(app.schedule, { id: job.event }) || {};
		var cat = job.category ? find_object(app.categories, { id: job.category }) : { title: 'n/a' };
		var group = event.target ? find_object(app.server_groups, { id: event.target }) : null;
		var plugin = job.plugin ? find_object(app.plugins, { id: job.plugin }) : { title: 'n/a' };

		if (group && event.multiplex) {
			group = copy_object(group);
			group.multiplex = 1;
		}

		// new header with watch & abort
		var watch_enabled = this.check_watch_enabled(job);

		html += '<div class="subtitle" style="margin-top:7px; margin-bottom:13px;">';
		html += 'Live Job Progress';
		html += '<div class="subtitle_widget" style="margin-left:2px;"><span class="link abort" onMouseUp="$P().abort_job()"><i class="fa fa-ban">&nbsp;</i><b>Abort Job</b></span></div>';
		html += '<div class="subtitle_widget"><span id="s_watch_job" class="link" onMouseUp="$P().toggle_watch()" style="' + (watch_enabled ? 'color:#3f7ed5;' : 'color:#777;') + '"><i class="fa ' + (watch_enabled ? 'fa-check-square-o' : 'fa-square-o') + '">&nbsp;</i><b>Watch Job</b></span></div>';
		html += '<div class="clear"></div>';
		html += '</div>';

		let eventTitle = `<a href="#Schedule?sub=edit_event&id=${job.event}">${this.getNiceEvent(job.event_title, col_width)}</a>`
		let elapsed = Math.floor(Math.max(0, app.epoch - job.time_start));
		let job_progress = job.progress || 0;
		let nice_remain = 'n/a';
		if (job.pending && job.when) {
			nice_remain = 'Retry in ' + get_text_from_seconds(Math.max(0, job.when - app.epoch), true, true) + '';
		}
		else if ((elapsed >= 10) && (job_progress > 0) && (job_progress < 1.0)) {
			var sec_remain = Math.floor(((1.0 - job_progress) * elapsed) / job_progress);
			nice_remain = get_text_from_seconds(sec_remain, false, true);
		}

		html += `
		<div class="job-details grid-container running">
		  <div class="job-details  grid-item"><div class="info_label">JOB ID:</div><div class="info_value">${job.id}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">PID:</div><div id="d_live_pid" class="info_value">${(job.detached_pid || job.pid || '(Unknown)')}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">CAT:</div><div class="info_value">${this.getNiceCategory(cat, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">TARGET:</div><div class="info_value">${this.getNiceGroup(group, event.target, col_width) }</div></div> 
		  <div class="job-details  grid-item"><div class="info_label">SOURCE:</div><div class="info_value">${job.source || 'Scheduler'}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">START:</div><div class="info_value">${get_nice_date_time(job.time_start, true, true) }</div></div>

		  <div class="job-details  grid-item"><div class="info_label">EVENT:</div><div class="info_value">${eventTitle}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">ARG:</div><div class="info_value">${encode_entities(job.arg || '(None)')}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">PLUGIN:</div><div class="info_value">${this.getNicePlugin(plugin, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">HOST:</div><div class="info_value">${this.getNiceGroup(null, job.hostname, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">ELAPSED TIME:</div><div id="d_live_elapsed" class="info_value">${get_text_from_seconds(elapsed, false, false)}</div></div>   				    			
		  <div class="job-details  grid-item"><div class="info_label">REMAINING TIME:</div><div id="d_live_remain" class="info_value"> ${nice_remain}</div></div>
		</div>
		<div class="clear"></div>
	  `

		// pies
		html += '<div style="position:relative; margin-top:15px;">';

		html += '<div class="pie-column column-left">';
		html += '<div id="d_live_progress_overlay" class="pie-overlay"></div>';
		html += '<div class="pie-title">Job Progress</div>';
		html += '<div id="d_graph_live_progress" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_live_progress" class="pie"></canvas></div>';
		// html += '<canvas id="c_live_progress" width="250" height="250" class="pie"></canvas>';
		// html += '<div id="d_live_progress_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '<div class="pie-column column-right">';
		html += '<div id="d_live_mem_overlay" class="pie-overlay"></div>';
		html += '<div class="pie-title">Memory Usage</div>';
		html += '<div id="d_graph_live_mem" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_live_mem" class="pie"></canvas></div>';
		// html += '<canvas id="c_live_mem" width="250" height="250" class="pie"></canvas>';
		html += '<div id="d_live_mem_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '<div class="pie-column column-center">';
		html += '<div id="d_live_cpu_overlay" class="pie-overlay"></div>';
		html += '<div class="pie-title">CPU Usage</div>';
		html += '<div id="d_graph_live_cpu" style="position:relative; display:inline-block; width:250px; height:250px; overflow:hidden;"><canvas id="c_live_cpu" class="pie"></canvas></div>';
		// html += '<canvas id="c_live_cpu" width="250" height="250" class="pie"></canvas>';
		html += '<div id="d_live_cpu_legend" class="pie-legend-column"></div>';
		html += '</div>';

		html += '</div>';

		// live job log tail
		var remote_api_url = app.proto + job.hostname + ':' + app.port + config.base_api_uri;
		if (config.custom_live_log_socket_url) {
			// custom websocket URL. Can use object (map) for multi-node setup
			remote_api_url = config.custom_live_log_socket_url[job.hostname]
			// if string (typically single master)
			if( typeof config.custom_live_log_socket_url === "string" ) remote_api_url = config.custom_live_log_socket_url ;
			// if object (for multi-node)
			if(config.custom_live_log_socket_url[job.hostname]) remote_api_url = config.custom_live_log_socket_url[job.hostname];
		}
		else if (!config.web_socket_use_hostnames && app.servers && app.servers[job.hostname] && app.servers[job.hostname].ip) {
			// use ip if available, may work better in some setups
			remote_api_url = app.proto + app.servers[job.hostname].ip + ':' + app.port + config.base_api_uri;
		}

		html += '<div class="subtitle" style="margin-top:15px;">';
		html += `Live Job Event Log `;
		//html += '<div class="subtitle_widget" style="margin-left:2px;"><a href="' + remote_api_url + '/app/get_live_job_log?id=' + job.id + '" target="_blank"><i class="fa fa-external-link">&nbsp;</i><b>View Full Log</b></a></div>';
		html += `<div class="subtitle_widget"><a target="_blank" href="./console?id=${job.id}&download=1"><i class="fa fa-download">&nbsp;</i><b>View Full Log</b></a></div>`;
		// let autoScroll = app.getPref('autoscroll') === 'N' ? 'autoscroll: off' :  'autoscroll: on'
		// html += `<div class="subtitle_widget"><a id="autoscroll_url" style="cursor:pointer" onMouseUp="$P().toggle_autoscroll(this)"><b>${autoScroll}</b></a></div>`;
		html += '<div class="clear"></div>';
		html += '</div>';

		var size = get_inner_window_size();
		// var iheight = size.height - 10;
		// html += '<div id="d_live_job_log" style="width:100%; height:' + iheight + 'px; overflow-y:scroll; position:relative;"></div>';
		html += `<div id="d_live_job_log" style="width:100%; height:100%; position:relative;"></div>`;

		this.div.html(html);

		// open websocket for log tail stream
		this.start_live_log_watcher(job);

		// live progress pie
		if (!job.progress) job.progress = 0;
		var progress = Math.min(1, Math.max(0, job.progress));
		var prog_pct = short_float(progress * 100);

		var ctx = $("#c_live_progress").get(0).getContext("2d");
		var progress_chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				datasets: [{
					data: [
						prog_pct,
						100 - prog_pct
					],
					backgroundColor: [
						this.pie_colors.progress,
						this.pie_colors.empty
					],
					label: ''
				}],
				labels: []
			},
			options: {
				events: [],
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		this.charts.progress = progress_chart;

		// live cpu pie
		if (!job.cpu) job.cpu = {};
		if (!job.cpu.current) job.cpu.current = 0;
		var cpu_cur = job.cpu.current;
		var cpu_avg = 0;
		if (job.cpu.total && job.cpu.count) {
			cpu_avg = short_float(job.cpu.total / job.cpu.count);
		}
		var jcm = 100;
		var ctx = $("#c_live_cpu").get(0).getContext("2d");
		var cpu_chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				datasets: [{
					data: [
						Math.min(cpu_cur, jcm),
						jcm - Math.min(cpu_cur, jcm),
					],
					backgroundColor: [
						(cpu_cur < jcm * 0.5) ? this.pie_colors.cool :
							((cpu_cur < jcm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot),
						this.pie_colors.empty
					],
					label: ''
				}],
				labels: []
			},
			options: {
				events: [],
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		this.charts.cpu = cpu_chart;

		// live mem pie
		if (!job.mem) job.mem = {};
		if (!job.mem.current) job.mem.current = 0;
		var mem_cur = job.mem.current;
		var mem_avg = 0;
		if (job.mem.total && job.mem.count) {
			mem_avg = short_float(job.mem.total / job.mem.count);
		}
		var jmm = config.job_memory_max || 1073741824;
		var ctx = $("#c_live_mem").get(0).getContext("2d");
		var mem_chart = new Chart(ctx, {
			type: 'doughnut',
			data: {
				datasets: [{
					data: [
						Math.min(mem_cur, jmm),
						jmm - Math.min(mem_cur, jmm),
					],
					backgroundColor: [
						(mem_cur < jmm * 0.5) ? this.pie_colors.cool :
							((mem_cur < jmm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot),
						this.pie_colors.empty
					],
					label: ''
				}],
				labels: []
			},
			options: {
				events: [],
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: false,
					position: 'right',
				},
				title: {
					display: false,
					text: ''
				},
				animation: {
					animateScale: true,
					animateRotate: true
				}
			}
		});

		this.charts.mem = mem_chart;

		// update dynamic data
		this.update_live_progress(job);
	},

	// scrollToBottom: function () {
	// 	if (app.getPref('autoscroll') === 'N') return
	// 	let container = document.getElementById('d_live_job_log');
	// 	if (container) container.scrollTop = container.scrollHeight;
	// },

	start_live_log_watcher: function(job) {

		if(config.ui.live_log_ws) { 
			this.start_live_log_watcher_ws(job) // use classic websocket live log
		}
		else {
			this.start_live_log_watcher_chunk(job)
		}

	},

	start_live_log_watcher_chunk: function (job) { // better version of start_live_log_watcher_poll
		let self = this;
		self.curr_live_log_job = job.id;

		let offset = 0
		let maxBytes = config.live_log_page_size || 8192

		let lag = 800
		const minLag = 800
		const maxLag = 2000

		let liveLogDiv = document.getElementById('d_live_job_log')

		const term = new Terminal({
            disableStdin: true, // Disable user input
            cursorStyle: false,
            cursorBlink: false,
			cols: Math.round(liveLogDiv.clientWidth / 10),
			rows: 40, 
			convertEol: true
        });

		self.term = term;

		term.open(liveLogDiv);

		liveLogDiv.scrollIntoView();

		self.live_log_is_up = true

		function refresh() {
			if(self.curr_live_log_job != job.id) return; // prevent double logging
			if(!self.live_log_is_up) return // stop polling when tab is deactivated

			app.api.post('app/get_live_console', { id: job.id, offset: offset, max_bytes: maxBytes }
				, (data) => {  // success callback                  

					if(data.error) {						
						console.error('Live log poll error: ', data.error)
						return
					}					 

					// update offset. Log file might be truncated for repeat jobs, in this case reduce offset to new file size
					if(data.fileSize < data.next) { 
						term.clear()
						term.writeln('# log file got truncated, reloading ...')
						offset = 0
					}
					else {
						offset = data.next || offset 
					}
					
					// write new data chunk into terminal, if no new data then increase lag
					if(data.data) {
						term.write(data.data)						
					}
					else { 
						if(lag > maxLag) lag = minLag
						lag = lag*1.2
					}

					// Debug.trace
					// console.log(`live log = next: ${data.next} | offset: ${offset} | lag: ${lag} | size: ${data.fileSize} `)

					setTimeout(refresh,  lag);
				}
				// stop polling on error, report unexpected errors
				, (e) => {			
					if(e.code != 'job') console.error('Live log poll error: ', e)
					return
				}
			)
		}

		refresh();

	},

	start_live_log_watcher_ws: function (job) {
		// open special websocket to target server for live log feed
		var self = this;
		var $cont = null;
		var chunk_count = 0;
		var error_shown = false;

		var url = app.proto + job.hostname + ':' + app.port;
		if (config.custom_live_log_socket_url) {
			// custom websocket URL
			
			// if string (single node)
			if( typeof config.custom_live_log_socket_url === "string" ) url = config.custom_live_log_socket_url ;
			// if object (multi-node)
			url = config.custom_live_log_socket_url[job.hostname] || url 

		}
		else if (!config.web_socket_use_hostnames && app.servers && app.servers[job.hostname] && app.servers[job.hostname].ip) {
			// use ip if available, may work better in some setups
			url = app.proto + app.servers[job.hostname].ip + ':' + app.port;
		}

		$('#d_live_job_log').append(
			'<pre class="log_chunk" style="color:#888">Log Watcher: Connecting to server: ' + url + '...</pre>'
		);

		this.socket = io(url, {
			forceNew: true,
			transports: config.socket_io_transports || ['websocket'],
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			reconnectionAttempts: 9999,
			timeout: 5000
		});

		this.socket.on('connect', function () {
			Debug.trace("JobDetails socket.io connected successfully: " + url);

			// cache this for later
			$cont = $('#d_live_job_log');

			$cont.append(
				'<pre class="log_chunk" style="color:#888; margin-bottom:14px;">Log Watcher: Connected successfully!</pre>'
			);

			// get auth token from manager server (uses session)
			app.api.post('app/get_log_watch_auth', { id: job.id }, function (resp) {
				// now request log watch stream on target server
				self.socket.emit('watch_job_log', {
					token: resp.token,
					id: job.id
				});
			}); // api.post

		});
		this.socket.on('connect_error', function (err) {
			Debug.trace("JobDetails socket.io connect error: " + err);
			$('#d_live_job_log').append(
				'<pre class="log_chunk">Log Watcher: Server Connect Error: ' + err + ' (' + url + ')</pre>'
			);
			error_shown = true;
		});
		this.socket.on('connect_timeout', function (err) {
			Debug.trace("JobDetails socket.io connect timeout");
			if (!error_shown) $('#d_live_job_log').append(
				'<pre class="log_chunk">Log Watcher: Server Connect Timeout: ' + err + ' (' + url + ')</pre>'
			);
		});
		this.socket.on('reconnect', function () {
			Debug.trace("JobDetails socket.io reconnected successfully");
		});

		this.socket.on('log_data', function (lines) {
			// received log data, as array of lines
			var scroll_y = $cont.scrollTop();
			var scroll_max = Math.max(0, $cont.prop('scrollHeight') - $cont.height());
			var need_scroll = ((scroll_max - scroll_y) <= 10);

			let chunk_data = lines.map(l => l.replace(/</g, '&lt;').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")).join("\n");
			$cont.append(
				'<pre class="log_chunk">' + chunk_data + '</pre>'
			);

			// only show newest 1K chunks
			chunk_count++;
			if (chunk_count >= 1000) {
				$cont.children().first().remove();
				chunk_count--;
			}

			if (need_scroll) $cont.scrollTop($cont.prop('scrollHeight'));
		});
	},

	update_live_progress: function (job) {
		// update job progress, elapsed time, time remaining, cpu pie, mem pie
		if (job.complete && !app.progress) app.showProgress(1.0, "Job is finishing...");

		// pid may have changed (retry)
		$('#d_live_pid').html(job.pid || 'n/a');

		// elapsed time
		var elapsed = Math.floor(Math.max(0, app.epoch - job.time_start));
		$('#d_live_elapsed').html(get_text_from_seconds(elapsed, false, false));

		// remaining time
		var progress = job.progress || 0;
		var nice_remain = 'n/a';
		if (job.pending && job.when) {
			nice_remain = 'Retry in ' + get_text_from_seconds(Math.max(0, job.when - app.epoch), true, true) + '';
		}
		else if ((elapsed >= 10) && (progress > 0) && (progress < 1.0)) {
			var sec_remain = Math.floor(((1.0 - progress) * elapsed) / progress);
			nice_remain = get_text_from_seconds(sec_remain, false, true);
		}
		$('#d_live_remain').html(nice_remain);

		// progress pie
		if (!job.progress) job.progress = 0;
		var progress = Math.min(1, Math.max(0, job.progress));
		var prog_pct = short_float(progress * 100);

		if (prog_pct != this.charts.progress.__cronicle_prog_pct) {
			this.charts.progress.__cronicle_prog_pct = prog_pct;
			this.charts.progress.config.data.datasets[0].data[0] = prog_pct;
			this.charts.progress.config.data.datasets[0].data[1] = 100 - prog_pct;
			this.charts.progress.update();
		}

		// progress overlay
		var html = '';
		html += '<div class="pie-overlay-title">' + Math.floor(prog_pct) + '%</div>';
		html += '<div class="pie-overlay-subtitle">Current</div>';
		$('#d_live_progress_overlay').html(html);

		// cpu pie
		if (!job.cpu) job.cpu = {};
		if (!job.cpu.current) job.cpu.current = 0;
		var cpu_cur = job.cpu.current;
		var cpu_avg = 0;
		if (job.cpu.total && job.cpu.count) {
			cpu_avg = short_float(job.cpu.total / job.cpu.count);
		}

		var jcm = 100;
		if (cpu_cur != this.charts.cpu.__cronicle_cpu_cur) {
			this.charts.cpu.__cronicle_cpu_cur = cpu_cur;

			this.charts.cpu.config.data.datasets[0].data[0] = Math.min(cpu_cur, jcm);
			this.charts.cpu.config.data.datasets[0].data[1] = jcm - Math.min(cpu_cur, jcm);

			this.charts.cpu.config.data.datasets[0].backgroundColor[0] = (cpu_cur < jcm * 0.5) ? this.pie_colors.cool : ((cpu_cur < jcm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot);

			this.charts.cpu.update();
		}

		// live cpu overlay
		var html = '';
		html += '<div class="pie-overlay-title">' + short_float(cpu_cur) + '%</div>';
		html += '<div class="pie-overlay-subtitle">Current</div>';
		$('#d_live_cpu_overlay').html(html);

		// live cpu legend
		var html = '';

		html += '<div class="info_label">MIN</div>';
		html += '<div class="info_value">' + short_float(job.cpu.min || 0) + '%</div>';

		html += '<div class="info_label">AVERAGE</div>';
		html += '<div class="info_value">' + (cpu_avg || 0) + '%</div>';

		html += '<div class="info_label">PEAK</div>';
		html += '<div class="info_value">' + short_float(job.cpu.max || 0) + '%</div>';

		$('#d_live_cpu_legend').html(html);

		// mem pie
		if (!job.mem) job.mem = {};
		if (!job.mem.current) job.mem.current = 0;
		var mem_cur = job.mem.current;
		var mem_avg = 0;
		if (job.mem.total && job.mem.count) {
			mem_avg = short_float(job.mem.total / job.mem.count);
		}

		var jmm = config.job_memory_max || 1073741824;
		if (mem_cur != this.charts.mem.__cronicle_mem_cur) {
			this.charts.mem.__cronicle_mem_cur = mem_cur;

			this.charts.mem.config.data.datasets[0].data[0] = Math.min(mem_cur, jmm);
			this.charts.mem.config.data.datasets[0].data[1] = jmm - Math.min(mem_cur, jmm);

			this.charts.mem.config.data.datasets[0].backgroundColor[0] = (mem_cur < jmm * 0.5) ? this.pie_colors.cool : ((mem_cur < jmm * 0.75) ? this.pie_colors.warm : this.pie_colors.hot);

			this.charts.mem.update();
		}

		// live mem overlay
		var html = '';
		html += '<div class="pie-overlay-title">' + get_text_from_bytes(mem_cur, 10) + '</div>';
		html += '<div class="pie-overlay-subtitle">Current</div>';
		$('#d_live_mem_overlay').html(html);

		// live mem legend
		var html = '';

		html += '<div class="info_label">MIN</div>';
		html += '<div class="info_value">' + get_text_from_bytes(job.mem.min || 0, 1) + '</div>';

		html += '<div class="info_label">AVERAGE</div>';
		html += '<div class="info_value">' + get_text_from_bytes(mem_avg || 0, 1) + '</div>';

		html += '<div class="info_label">PEAK</div>';
		html += '<div class="info_value">' + get_text_from_bytes(job.mem.max || 0, 1) + '</div>';

		$('#d_live_mem_legend').html(html);
	},

	jump_to_archive_when_ready: function () {
		// make sure archive view is ready (job log may still be uploading)
		var self = this;
		if (!this.active) return; // user navigated away from page

		app.api.post('app/get_job_details', { id: this.args.id, need_log: 1 },
			function (resp) {
				// got it, ready to switch
				app.hideProgress();
				Nav.refresh();
			},
			function (err) {
				// job not complete yet
				if (!app.progress) app.showProgress(1.0, "Job is finishing...");
				// self.jump_timer = setTimeout( self.jump_to_archive_when_ready.bind(self), 1000 );
			}
		);
	},

	find_job: function (id) {
		// locate active or pending (retry delay) job
		if (!id) id = this.args.id;
		var job = app.activeJobs[id];

		if (!job) {
			for (var key in app.activeJobs) {
				var temp_job = app.activeJobs[key];
				if (temp_job.pending && (temp_job.id == id)) {
					job = temp_job;
					break;
				}
			}
		}

		return job;
	},

	onStatusUpdate: function (data) {
		// received status update (websocket), update sub-page if needed
		if (this.args && (this.args.sub == 'live')) {
			if (!app.activeJobs[this.args.id]) {
				// check for pending job (retry delay)
				var pending_job = null;
				for (var key in app.activeJobs) {
					var job = app.activeJobs[key];
					if (job.pending && (job.id == this.args.id)) {
						pending_job = job;
						break;
					}
				}

				if (pending_job) {
					// job switched to pending (retry delay)
					if (app.progress) app.hideProgress();
					this.update_live_progress(pending_job);
				}
				else {
					// the live job we were watching just completed, jump to archive view
					this.jump_to_archive_when_ready();
				}
			}
			else {
				// job is still active
				this.update_live_progress(app.activeJobs[this.args.id]);
			}
		}
	},

	onResize: function (size) {
		// window was resized
		var iheight = size.height - 110;
		if (this.args.sub == 'live') {
			$('#d_live_job_log').css('height', '' + iheight + 'px');
		}
		else {
			$('#i_arch_job_log').css('height', '' + iheight + 'px');
		}
		if(this.term) {
			// let liveLogDiv = document.getElementById('d_live_job_log')
			// let col = Math.round(liveLogDiv.clientWidth / 10)
			// let row = Math.round(liveLogDiv.clientHeight / 10) - 5
			// this.term.resize(col, row)
		}
	},

	onResizeDelay: function (size) {
		// called 250ms after latest window resize
		// so we can run more expensive redraw operations
	},

	onDeactivate: function () {
		// called when page is deactivated
		for (var key in this.charts) {
			this.charts[key].destroy();
		}
		if (this.jump_timer) {
			clearTimeout(this.jump_timer);
			delete this.jump_timer;
		}
		if (this.socket) {
			this.socket.disconnect();
			delete this.socket;
		}

		if (this.term) {
			if(this.term.dispose) this.term.dispose()
			delete this.term
		}

		this.live_log_is_up = false

		this.charts = {};
		this.div.html('');
		// this.tab.hide();
		return true;
	}

});
