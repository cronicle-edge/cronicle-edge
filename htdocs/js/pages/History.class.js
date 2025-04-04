// Cronicle History Page

Class.subclass( Page.Base, "Page.History", {	
	
	default_sub: 'history',
	
	onInit: function() {
		// called once at page load
		// var html = '';
		// this.div.html( html );
		this.charts = {};
	},
	
	onActivate: function(args) {
		// page activation
		if (!this.requireLogin(args)) return true;
		
		if (!args) args = {};
		if (!args.sub) args.sub = this.default_sub;
		this.args = args;
		
		app.showTabBar(true);
		this.tab[0]._page_id = Nav.currentAnchor();
		
		this.div.addClass('loading');
		this['gosub_'+args.sub](args);
		
		return true;
	},
	
	gosub_history: function(args) {
		// show history
		app.setWindowTitle( "History" );
		
		var html = '';
		// html += '<div style="padding:5px 15px 15px 15px;">';
		html += '<div style="padding:20px 20px 30px 20px">';
		
		html += '<div class="subtitle">';
			html += 'All Completed Jobs';
			// html += '<div class="subtitle_widget"><span class="link" onMouseUp="$P().refresh_user_list()"><b>Refresh</b></span></div>';
			// html += '<div class="subtitle_widget"><i class="fa fa-search">&nbsp;</i><input type="text" id="fe_ul_search" size="15" placeholder="Find username..." style="border:0px;"/></div>';
			var sorted_events = app.schedule.sort( function(a, b) {
				return a.title.toLowerCase().localeCompare( b.title.toLowerCase() );
			} );
			html += `<div class="subtitle_widget"><a href="./db" ><b>Event Dashboard</b></a></div>`
			html += `<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_hist_eventlimit" class="subtitle_menu" onChange="$('#d_history_table').empty();$P().get_history()"  title="Show only last N occurences per event"><option value="">Last occurences (all)</option><option>1</option><option>2</option><option>3</option><option>5</option><option>10</option></select></div>`;
			html += `<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_hist_event" class="subtitle_menu" onChange="$P().jump_to_event_history()"><option value="">Filter by Event</option>${render_menu_options(sorted_events, "", false)}</select></div>`
			html += '<div class="clear"></div>';
		html += '</div>';
		
		html += '<div id="d_history_table"></div>';
		html += '</div>'; // padding
		this.div.html( html );
		
		this.get_history();
	},
	
	get_history: function() {
		var args = this.args;
		var evtLimit = parseInt($("#fe_hist_eventlimit").val())
		if (!args.offset) args.offset = 0;
		if (!evtLimit) args.limit = 25;
		if(evtLimit)  args.limit = parseInt(evtLimit*100);
		app.api.post( 'app/get_history', copy_object(args), this.receive_history.bind(this) );
	},
	
	receive_history: function(resp) {
		// receive page of history from server, render it
		this.lastHistoryResp = resp;
		
		var html = '';
		this.div.removeClass('loading');
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) - 50) / 8 );
		
		this.events = [];
		if (resp.rows) this.events = resp.rows;

		// show only last N occurences of each job if set by fe_hist_eventlimit
		var rowLimitDict = {};
		var rowLimit = $("#fe_hist_eventlimit").val();
		if (rowLimit > 0) {
			var newRows = []
			for (var idx = 0, len = resp.rows.length; idx < len; idx++) {
				var row = resp.rows[idx];
				rowLimitDict[row.event] = rowLimitDict[row.event] ? rowLimitDict[row.event] + 1 : 1;
				if (rowLimitDict[row.event] > rowLimit) {continue;}
				newRows.push(row)
			}
			resp.rows = newRows
		} //
		
		var cols = ['Job ID', 'Event Name', 'Argument', 'Category', 'Plugin', 'Hostname',  'Result', 'Start Date/Time', 'Elapsed Time'];
		
		var self = this;
		var num_visible_items = 0;
		
		html += this.getPaginatedTable( resp, cols, 'event', function(job, idx) {
			/*var actions = [
				'<a href="#JobDetails?id='+job.id+'"><b>Job&nbsp;Details</b></a>',
				'<a href="#History?sub=event_history&id='+job.event+'"><b>Event&nbsp;History</b></a>'
			];*/
			
			// suppress row view if job was deleted
			if (job.action != 'job_complete') return null;
			num_visible_items++;
			
			var event = find_object( app.schedule, { id: job.event } );
			var event_link = '(None)';
			if (event && job.id) {
				event_link = '<div class="td_big"><a href="#History?sub=event_history&id='+job.event+'">' + self.getNiceEvent((event.title || job.event), col_width + 40) + '</a></div>';
			}
			else if (job.event_title) {
				event_link = self.getNiceEvent(job.event_title, col_width + 40);
			}
			
			var cat = job.category ? find_object( app.categories, { id: job.category } ) : null;
			if (!cat && job.category_title) cat = { id: job.category, title: job.category_title };
			
			var plugin = job.plugin ? find_object( app.plugins, { id: job.plugin } ) : null;
			if (!plugin && job.plugin_title) plugin = { id: job.plugin, title: job.plugin_title };
			
			let job_expired = time_now() > job.expires_at
			let href = job_expired ? '' : '<a href="#JobDetails?id='+job.id+'">'

			var job_link = '<div class="td_big">--</div>';
			if (job.id) job_link = `<div class="td_big">${href}` + self.getNiceJob('<b>' + job.id + '</b>') + '</a></div>';
			
			var errorTitle = typeof job.description === 'string' ? job.description.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").replace(/"/g, "&quot;") : " " 
			var jobStatus = (job.code == 0) ? '<span class="color_label green"><i class="fa fa-check">&nbsp;</i>Success</span>' : `<span class="color_label red" title="${errorTitle}"><i class="fa fa-warning">&nbsp;</i>Error</span>`
			if(job.code == 255) {jobStatus = `<span class="color_label yellow" title="${errorTitle}"><i class="fa fa-warning">&nbsp;</i>Warning</span>`}
			
			var tds = [
				job_link,				
				event_link ,
				self.getNiceArgument(job.arg, 40, self.args),				
				self.getNiceCategory( cat, col_width ),
				self.getNicePlugin( plugin, col_width ),
				self.getNiceGroup( null, job.hostname, col_width ),				
				jobStatus,
				// job.arg ? `<div class="ellip" style="max-width:40">${String(job.arg).substring(0,40)}</div>`  : '', // argument
				get_nice_date_time( job.time_start, false, true ),
				get_text_from_seconds( job.elapsed, true, false )
				// actions.join(' | ')
			];
			
			if (!job.id || job_expired) tds.className = 'disabled';
			
			if (cat && cat.color) {
				if (tds.className) tds.className += ' '; else tds.className = '';
				tds.className += cat.color;
			}
			
			return tds;
		} );
		
		if (resp.rows && resp.rows.length && !num_visible_items) {
			html += '<tr><td colspan="'+cols.length+'" align="center" style="padding-top:10px; padding-bottom:10px; font-weight:bold;">';
			html += 'All items were deleted on this page.';
			html += '</td></tr>';
		}
		
		this.div.find('#d_history_table').html( html );
	},
	
	gosub_error_history: function(args) {
		// show history
		app.setWindowTitle( "Query History" );
		
		var html = '';
		// html += '<div style="padding:5px 15px 15px 15px;">';
		html += '<div style="padding:20px 20px 30px 20px">';
		
		html += '<div class="subtitle">';
			html += 'Query History';

			html += '<div class="clear"></div>';
		html += '</div>';
		
		html += '<div id="d_error_history_table"></div>';
		html += '</div>'; // padding
		this.div.html( html );

		var args = this.args;
		// var evtLimit = parseInt($("#fe_hist_eventlimit").val())
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 25;
		// if(evtLimit)  args.limit = parseInt(evtLimit*100);
		app.api.post( 'app/get_errors', copy_object(args), this.receive_error_history.bind(this) );
		
	},

	receive_error_history: function(resp) {
		// receive page of history from server, render it
		this.lastErrorHistoryResp = resp;
		
		var html = '';
		this.div.removeClass('loading');

		html += this.getSidebarTabs( 'error_history',
		[
			['history', "All Completed"],
			// ['event_history', "Event History"],
			// ['event_stats', "Event Stats"],
			['error_history', "Query History"],
		]
	    );
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) - 50) / 8 );
		
		this.events = [];
		if (resp.rows) this.events = resp.rows;

		var cols = ['Job ID', 'Event Name', 'Argument', 'Category', 'Plugin', 'Hostname', 'Code', 'Description', 'Start Date/Time', 'Elapsed Time'];
		
		var self = this;
		var num_visible_items = 0;
		
		html += this.getPaginatedTable( resp, cols, 'event', function(job, idx) {
			/*var actions = [
				'<a href="#JobDetails?id='+job.id+'"><b>Job&nbsp;Details</b></a>',
				'<a href="#History?sub=event_history&id='+job.event+'"><b>Event&nbsp;History</b></a>'
			];*/
			
			// suppress row view if job was deleted
			if (job.action != 'job_complete') return null;
			num_visible_items++;
			
			var event = find_object( app.schedule, { id: job.event } );
			var event_link = '(None)';

			if (event && job.id) {
				let niceEvent = self.getNiceEvent((event.title || job.event), col_width + 40) 
				if(self.args.id) event_link = `<div class="td_big"> ${niceEvent}</div>` // no hyperlink if already filtered by id
				else { event_link = `<div class="td_big"><a href="#History?sub=error_history&error=1&id=${job.event}">${niceEvent}</a></div>` }
			}
			else if (job.event_title) {
				event_link = self.getNiceEvent(job.event_title, col_width + 40);
			}
			
			var cat = job.category ? find_object( app.categories, { id: job.category } ) : null;
			if (!cat && job.category_title) cat = { id: job.category, title: job.category_title };
			
			var plugin = job.plugin ? find_object( app.plugins, { id: job.plugin } ) : null;
			if (!plugin && job.plugin_title) plugin = { id: job.plugin, title: job.plugin_title };
			
			let job_expired = time_now() > job.expires_at
			let href = job_expired ? '' : '<a href="#JobDetails?id='+job.id+'">'

			var job_link = '<div class="td_big">--</div>';
			if (job.id) job_link = `<div class="td_big">${href}` + self.getNiceJob('<b>' + job.id + '</b>') + '</a></div>';
		

			var tds = [
				job_link,				
				event_link ,
				self.getNiceArgument(job.arg, 40, self.args),				
				self.getNiceCategory( cat, col_width ),
				self.getNicePlugin( plugin, col_width ),
				self.getNiceGroup( null, job.hostname, col_width ),				
				job.code,
				encode_entities(job.description || job.memo),
				// job.arg ? `<div class="ellip" style="max-width:40">${String(job.arg).substring(0,40)}</div>`  : '', // argument
				get_nice_date_time( job.time_start, false, true ),
				get_text_from_seconds( job.elapsed, true, false )
				// actions.join(' | ')
			];
			
			if (!job.id || job_expired) tds.className = 'disabled';
			
			if (cat && cat.color) {
				if (tds.className) tds.className += ' '; else tds.className = '';
				tds.className += cat.color;
			}
			
			return tds;
		} );
		
		if (resp.rows && resp.rows.length && !num_visible_items) {
			html += '<tr><td colspan="'+cols.length+'" align="center" style="padding-top:10px; padding-bottom:10px; font-weight:bold;">';
			html += 'All items were deleted on this page.';
			html += '</td></tr>';
		}
		
		this.div.find('#d_error_history_table').html( html );
	},

	jump_to_event_history: function() {
		// make a selection from the event filter menu
		var id = $('#fe_hist_event').val();
		if (id) Nav.go( '#History?sub=event_history&id=' + id );
	},
	
	gosub_event_stats: function(args) {
		// request event stats
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 50;
		app.api.post( 'app/get_event_history', copy_object(args), this.receive_event_stats.bind(this) );
	},

	togglePerfLegend: function() {
		let chart = this.charts.perf
		if(!chart) return;
		chart.options.legend.display = !chart.options.legend.display
		chart.update()
	},
	
	receive_event_stats: function(resp) {
		// render event stats page
		this.lastEventStatsResp = resp;
		
		var html = '';
		var args = this.args;
		var rows = this.rows = resp.rows;
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) - 300) / 4 );
		
		var event = find_object( app.schedule, { id: args.id } ) || null;
		if (!event) return app.doError("Could not locate event in schedule: " + args.id);
		
		var cat = event.category ? find_object( app.categories, { id: event.category } ) : null;
		var group = event.target ? find_object( app.server_groups, { id: event.target } ) : null;
		var plugin = event.plugin ? find_object( app.plugins, { id: event.plugin } ) : null;
		
		if (group && event.multiplex) {
			group = copy_object(group);
			group.multiplex = 1;
		}
		
		app.setWindowTitle( "Event Stats: " + event.title );
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'event_stats',
			[
				['history', "All Completed"],				
				['event_history&id=' + args.id, "Event History"],
				['event_stats', "Event Stats"],
				['error_history', "Query History"],
			]
		);
		// html += '<div style="padding:20px 20px 30px 20px">';

		let eventTitle = `<a href="#Schedule?sub=edit_event&id=${event.id}">${this.getNiceEvent(event.title, col_width)}</a>`
		
	
			var total_elapsed = 0;
			var total_cpu = 0;
			var total_mem = 0;
			var total_success = 0;
			var total_log_size = 0;
			var count = 0;
			
			for (var idx = 0, len = rows.length; idx < len; idx++) {
				var job = rows[idx];
				if (job.action != 'job_complete') continue;
				
				count++;
				total_elapsed += (job.elapsed || 0);
				if (job.cpu && job.cpu.total) total_cpu += (job.cpu.total / (job.cpu.count || 1));
				if (job.mem && job.mem.total) total_mem += (job.mem.total / (job.mem.count || 1));
				if (job.code == 0) total_success++;
				total_log_size += (job.log_file_size || 0);
			}
			if (!count) count = 1;
			
			var nice_last_result = 'n/a';
			if (rows.length > 0) {
				var job = find_object( rows, { action: 'job_complete' } );
				//if (job) nice_last_result = (job.code == 0) ? '<span class="color_label green"><i class="fa fa-check">&nbsp;</i>Success</span>' : '<span class="color_label red"><i class="fa fa-warning">&nbsp;</i>Error</span>';
				if (job) {
					nice_last_result = (job.code == 0) ? '<span class="color_label green"><i class="fa fa-check">&nbsp;</i>Success</span>' : '<span class="color_label red"><i class="fa fa-warning">&nbsp;</i>Error</span>'
					if(job.code == 255) {nice_last_result = '<span class="color_label yellow"><i class="fa fa-warning">&nbsp;</i>Warning</span>'}
				} 
			}
			
		html += `
		<div class="job-details grid-container running" style="margin:8px">
		  <div class="job-details  grid-item"><div class="info_label">EVENT NAME:</div><div class="info_value">${eventTitle}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">CATEGORY:</div><div class="info_value">${this.getNiceCategory(cat, col_width) }</div></div>
		  <div class="job-details  grid-item"><div class="info_label">PLUGIN:</div><div class="info_value">${this.getNicePlugin(plugin, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">EVENT TARGET:</div><div class="info_value">${this.getNiceGroup(group, event.target, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">USERNAME:</div><div id="d_live_pid" class="info_value">${this.getNiceUsername(event, false, col_width)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">EVENT TIMING:</div><div class="info_value">${event.enabled ? summarize_event_timing(event.timing, event.timezone) : '(Disabled)'}</div></div>
 	  
		  <div class="job-details  grid-item"><div class="info_label">AVG CPU:</div><div class="info_value">${short_float(total_cpu / count)}%</div></div>		  
		  <div class="job-details  grid-item"><div class="info_label">AVG MEMORY:</div><div id="d_live_elapsed" class="info_value">${get_text_from_bytes( total_mem / count )}</div></div>   				    			
		  <div class="job-details  grid-item"><div class="info_label">AVG LOG SIZE:</div><div id="d_live_remain" class="info_value"> ${get_text_from_bytes( total_log_size / count )}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">AVG ELAPSED:</div><div class="info_value">${get_text_from_seconds(total_elapsed / count, true, false)}</div></div>
		  <div class="job-details  grid-item"><div class="info_label">SUCCESS RATE:</div><div class="info_value">${pct(total_success, count)}</div></div> 
		  <div class="job-details  grid-item"><div class="info_label">LAST RESULT:</div><div class="info_value">${nice_last_result}</div></div>
		</div>
		<div class="clear"></div>
	  `
		
		// graph containers
		html += '<div style="margin-top:15px;">';
			html += '<div class="graph-title" onclick="$P().togglePerfLegend()"><span title="click to toggle legend on History">Performance History<span></div>';
			html += `<div id="d_graph_hist_perf" style="position:relative; width:100%; height:100%; overflow:hidden;"><canvas height=${Math.round(window.innerHeight/3)} id="c_graph_hist_perf" ></canvas></div>`; // $P().togglePerfLegend()`
		html += '</div>';
		
		html += '<div style="margin-top:10px; margin-bottom:20px; height:1px; background:#ddd;"></div>';
		
		// cpu / mem graphs
		html += '<div style="margin-top:0px;">';
			html += '<div style="float:left; width:50%;">';
				html += '<div class="graph-title">CPU Usage History</div>';
				html += '<div id="d_graph_hist_cpu" style="position:relative; width:100%; margin-right:5px; height:225px; overflow:hidden;"><canvas id="c_graph_hist_cpu"></canvas></div>';
			html += '</div>';
			html += '<div style="float:left; width:50%;">';
				html += '<div class="graph-title">Memory Usage History</div>';
				html += '<div id="d_graph_hist_mem" style="position:relative; width:100%; margin-left:5px; height:225px; overflow:hidden;"><canvas id="c_graph_hist_mem"></canvas></div>';
			html += '</div>';
			html += '<div class="clear"></div>';
		html += '</div>';
		
		html += '</div>'; // padding
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		// graphs
		this.render_perf_line_chart();
		this.render_cpu_line_chart();
		this.render_mem_line_chart();
	},
	
	render_perf_line_chart: function() {
		// event perf over time
		var rows = this.rows;
		
		var perf_keys = {};
		var perf_data = [];
		var perf_times = [];
		
		// build perf data for chart
		// read backwards as server data is unshifted (descending by date, newest first)
		for (var idx = rows.length - 1; idx >= 0; idx--) {
			var job = rows[idx];
			if (job.action != 'job_complete') continue;
			
			if (!job.perf) job.perf = { total: job.elapsed };
			if (!isa_hash(job.perf)) job.perf = parse_query_string( job.perf.replace(/\;/g, '&') );
			
			var pscale = 1;
			if (job.perf.scale) {
				pscale = job.perf.scale;
			}
			
			var perf = deep_copy_object( job.perf.perf ? job.perf.perf : job.perf );
			delete perf.scale;
			
			// remove counters from pie
			for (var key in perf) {
				if (key.match(/^c_/)) delete perf[key];
			}
			
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
			}
			
			// divide everything by scale, so we get seconds
			for (var key in perf) {
				perf[key] /= pscale;
			}
			
			perf_data.push( perf );
			for (var key in perf) {
				perf_keys[key] = 1;
			}
			
			// track times as well
			perf_times.push( job.time_end || (job.time_start + job.elapsed) );
		} // foreach row
		
		// build up timestamp data
		var tstamp_col = [];
		for (var idy = 0, ley = perf_times.length; idy < ley; idy++) {
			tstamp_col.push( perf_times[idy] * 1000 );
		} // foreach row
		
		var sorted_keys = hash_keys_to_array(perf_keys).sort();
		var datasets = [];
		
		for (var idx = 0, len = sorted_keys.length; idx < len; idx++) {
			var perf_key = sorted_keys[idx];
			var clr = 'rgb(' + this.graph_colors[ idx % this.graph_colors.length ] + ')';
			var dataset = {
				label: perf_key,
				backgroundColor: clr,
				borderColor: clr,
				fill: false,
				data: []
			};
			
			for (var idy = 0, ley = perf_data.length; idy < ley; idy++) {
				var perf = perf_data[idy];
				var value = Math.max( 0, perf[perf_key] || 0 );
				dataset.data.push({ x: tstamp_col[idy], y: short_float(value) });
			} // foreach row
			
			datasets.push( dataset );
		} // foreach key
		
		this.charts.perf = new Chart( $('#c_graph_hist_perf').get(0).getContext('2d'), {
			type: 'line',
			data: { datasets: datasets },
			options: {
				animation: {
					duration: 0
				},
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: true,
					position: 'bottom',
					labels: {
						fontStyle: 'bold',
						padding: 15
					},

				},


				title:{
					display: false,
					text: "toggle legend"
				},
				scales: {
					xAxes: [{
						type: "time",
						display: true,
						time: {
							parser: 'MM/DD/YYYY HH:mm',
							round: 'minute',
							tooltipFormat: 'll hh:mm a'
						},
						scaleLabel: {
							display: false,
							labelString: 'Date'
						}
					}, ],
					yAxes: [{
						ticks: {
							beginAtZero: true,
							callback: function(value, index, values) {
								if (value < 0) return '';
								return '' + get_text_from_seconds_round_custom(value, true);
							},
							onClick: function(e,i) {$P().togglePerfLegend()}
						},
						scaleLabel: {
							display: true,
							onClick: $P().togglePerfLegend
							// labelString: 'value'
						}
					}],

				},
				tooltips: {
					mode: 'nearest',
					intersect: false,
					callbacks: {
						label: function(tooltip, data) {
							var value = short_float(tooltip.yLabel);
							if (value >= 60) value = get_text_from_seconds( Math.floor(value), 1, 0 ).replace(/&nbsp\;/ig, ' ');
							else value = '' + value + " sec";
							return " " + datasets[tooltip.datasetIndex].label + ": " + value;
						}
					}
				}
			}
		});
	},
	
	render_cpu_line_chart: function() {
		// event cpu usage over time
		var rows = this.rows;
		var color = Chart.helpers.color;
		
		var col_avg = [];
		var col_max = [];
		
		// build data for chart
		// read backwards as server data is unshifted (descending by date, newest first)
		for (var idx = rows.length - 1; idx >= 0; idx--) {
			var job = rows[idx];
			if (job.action != 'job_complete') continue;
			
			if (!job.cpu) job.cpu = {};
			var x = (job.time_end || (job.time_start + job.elapsed)) * 1000;
			
			col_avg.push({
				x: x,
				y: short_float( (job.cpu.total || 0) / (job.cpu.count || 1) )
			});
			
			col_max.push({
				x: x,
				y: short_float( job.cpu.max || 0 )
			});
		} // foreach row
		
		var datasets = [
			{
				label: "CPU Peak",
				borderColor: '#888888',
				fill: false,
				data: col_max
			},
			{
				label: "CPU Avg",
				borderColor: '#3f7ed5',
				backgroundColor: color('#3f7ed5').alpha(0.5).rgbString(),
				data: col_avg
			}
		];
		
		this.charts.cpu = new Chart( $('#c_graph_hist_cpu').get(0).getContext('2d'), {
			type: 'line',
			data: { datasets: datasets },
			options: {
				animation: {
					duration: 0
				},
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: true,
					position: 'bottom',
					labels: {
						fontStyle: 'bold',
						padding: 15
					}
				},
				title:{
					display: false,
					text: ""
				},
				scales: {
					xAxes: [{
						type: "time",
						display: true,
						time: {
							parser: 'MM/DD/YYYY HH:mm',
							round: 'minute',
							tooltipFormat: 'll hh:mm a'
						},
						scaleLabel: {
							display: false,
							labelString: 'Date'
						}
					}, ],
					yAxes: [{
						ticks: {
							beginAtZero: true,
							callback: function(value, index, values) {
								return '' + Math.round(value) + '%';
							}
						},
						scaleLabel: {
							display: true,
							// labelString: 'value'
						}
					}]
				},
				tooltips: {
					mode: 'index',
					intersect: false,
					callbacks: {
						label: function(tooltip, data) {
							return " " + datasets[tooltip.datasetIndex].label + ": " + short_float(tooltip.yLabel) + '%';
						}
					}
				}
			}
		});
	},
	
	render_mem_line_chart: function() {
		// event mem usage over time
		var rows = this.rows;
		var color = Chart.helpers.color;
		
		var col_avg = [];
		var col_max = [];
		
		// build data for chart
		// read backwards as server data is unshifted (descending by date, newest first)
		for (var idx = rows.length - 1; idx >= 0; idx--) {
			var job = rows[idx];
			if (job.action != 'job_complete') continue;
			
			if (!job.mem) job.mem = {};
			var x = (job.time_end || (job.time_start + job.elapsed)) * 1000;
			
			col_avg.push({
				x: x,
				y: short_float( (job.mem.total || 0) / (job.mem.count || 1) )
			});
			
			col_max.push({
				x: x,
				y: short_float( job.mem.max || 0 )
			});
		} // foreach row
		
		var datasets = [
			{
				label: "Mem Peak",
				borderColor: '#888888',
				fill: false,
				data: col_max
			},
			{
				label: "Mem Avg",
				borderColor: '#279321',
				backgroundColor: color('#279321').alpha(0.5).rgbString(),
				data: col_avg
			}
		];
		
		this.charts.mem = new Chart( $('#c_graph_hist_mem').get(0).getContext('2d'), {
			type: 'line',
			data: { datasets: datasets },
			options: {
				animation: {
					duration: 0
				},
				responsive: true,
				responsiveAnimationDuration: 0,
				maintainAspectRatio: false,
				legend: {
					display: true,
					position: 'bottom',
					labels: {
						fontStyle: 'bold',
						padding: 15
					}
				},
				title:{
					display: false,
					text: ""
				},
				scales: {
					xAxes: [{
						type: "time",
						display: true,
						time: {
							parser: 'MM/DD/YYYY HH:mm',
							round: 'minute',
							tooltipFormat: 'll hh:mm a'
						},
						scaleLabel: {
							display: false,
							labelString: 'Date'
						}
					}, ],
					yAxes: [{
						ticks: {
							beginAtZero: true,
							callback: function(value, index, values) {
								return '' + get_text_from_bytes(value, 1);
							}
						},
						scaleLabel: {
							display: true,
							// labelString: 'value'
						}
					}]
				},
				tooltips: {
					mode: 'index',
					intersect: false,
					callbacks: {
						label: function(tooltip, data) {
							return " " + datasets[tooltip.datasetIndex].label + ": " + get_text_from_bytes(tooltip.yLabel);
						}
					}
				}
			}
		});
	},
	
	gosub_event_history: function(args) {
		// show table of all history for a single event
		if (!args.offset) args.offset = 0;
		if (!args.limit) args.limit = 40;
		app.api.post( 'app/get_event_history', copy_object(args), this.receive_event_history.bind(this) );
	},
	
	receive_event_history: function(resp) {
		// render event history
		this.lastEventHistoryResp = resp;
		
		var html = '';
		var args = this.args;
		var rows = this.rows = resp.rows;
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) - 300) / 7 );
		
		var event = find_object( app.schedule, { id: args.id } ) || null;
		if (!event) return app.doError("Could not locate event in schedule: " + args.id);
		
		app.setWindowTitle( "Event History: " + event.title );
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'event_history',
			[
				['history', "All Completed"],
				['event_history', "Event History"],
				['event_stats&id=' + args.id, "Event Stats"],
				['error_history', "Query History"],
			]
		);
		html += '<div style="padding:20px 20px 30px 20px">';
		
		var cols = ['Job ID', 'Argument', 'Hostname', 'Result', 'Memo', 'Start Date/Time', 'Elapsed Time', 'Avg CPU', 'Avg Mem'];
		
		html += '<div class="subtitle">';
			html += 'Event History: ' + event.title;
			html += '<div class="clear"></div>';
		html += '</div>';
		
		var self = this;
		var num_visible_items = 0;
		
		html += this.getPaginatedTable( resp, cols, 'event', function(job, idx) {
			if (job.action != 'job_complete') return null;
			num_visible_items++;
			
			var cpu_avg = 0;
			var mem_avg = 0;
			if (job.cpu) cpu_avg = short_float( (job.cpu.total || 0) / (job.cpu.count || 1) );
			if (job.mem) mem_avg = short_float( (job.mem.total || 0) / (job.mem.count || 1) );
			
			var errorTitle = job.description ? job.description.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "") : " " 
			var jobStatusHist = (job.code == 0) ? '<span class="color_label green"><i class="fa fa-check">&nbsp;</i>Success</span>' : `<span title="${errorTitle}" class="color_label red"><i class="fa fa-warning">&nbsp;</i>Error</span>`
			if(job.code == 255) {jobStatusHist = `<span title="${errorTitle}" class="color_label yellow"><i class="fa fa-warning">&nbsp;</i>Warning</span>`}

			let job_expired = time_now() > job.expires_at
			let href = job_expired ? '' : '<a href="#JobDetails?id='+job.id+'">'

			var tds = [
				`<div class="td_big" style="white-space:nowrap;">${href}<i class="fa fa-pie-chart">&nbsp;</i><b>${job.id.substring(0, 11)}</b></span></div>`,
				self.getNiceArgument(job.arg, 40, self.args),
				self.getNiceGroup( null, job.hostname, col_width ),
				jobStatusHist,
				encode_entities(job.memo),
				get_nice_date_time( job.time_start, false, true ),
				get_text_from_seconds( job.elapsed, true, false ),
				'' + cpu_avg + '%',
				get_text_from_bytes(mem_avg)
				// actions.join(' | ')
			];

			if(job_expired) tds.className = 'disabled';
			
			return tds;
		} );
		
		if (resp.rows && resp.rows.length && !num_visible_items) {
			html += '<tr><td colspan="'+cols.length+'" align="center" style="padding-top:10px; padding-bottom:10px; font-weight:bold;">';
			html += 'All items were deleted on this page.';
			html += '</td></tr>';
		}
		
		html += '</div>'; // padding
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
	},
	
	onStatusUpdate: function(data) {
		// received status update (websocket), update sub-page if needed
		if (data.jobs_changed && (this.args.sub == 'history')) this.get_history();
	},
	
	onResizeDelay: function(size) {
		// called 250ms after latest window resize
		// so we can run more expensive redraw operations
		switch (this.args.sub) {
			case 'history':
				if (this.lastHistoryResp) {
					this.receive_history( this.lastHistoryResp );
				}
			break;

			case 'error_history':
				if (this.lastErrorHistoryResp) {
					this.receive_history( this.lastErrorHistoryResp );
				}
			break;
			
			case 'event_stats':
				if (this.lastEventStatsResp) {
					this.receive_event_stats( this.lastEventStatsResp );
				}
			break;
			
			case 'event_history':
				if (this.lastEventHistoryResp) {
					this.receive_event_history( this.lastEventHistoryResp );
				}
			break;
		}
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		for (var key in this.charts) {
			this.charts[key].destroy();
		}
		this.charts = {};
		
		delete this.rows;
		if (this.args && (this.args.sub == 'event_stats')) this.div.html( '' );
		return true;
	}
	
});
