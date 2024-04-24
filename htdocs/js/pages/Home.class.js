Class.subclass( Page.Base, "Page.Home", {	
	
	bar_width: 100,
	
	onInit: function() {
		// called once at page load
		this.worker = new Worker('js/home-worker.js');
		this.worker.onmessage = this.render_upcoming_events.bind(this);
		
		this.div.html(`
		
		<div style="padding:10px 20px 20px 20px">
    
        <!-- Header stats -->

        <div id="d_home_header_stats"></div>
        <div style="height:12px;"></div>     
		
		<!-- Event Flow -->

		<div class="subtitle">
		  Event Flow
		  <div class="subtitle_widget"><i class="fa fa-refresh" onClick="$P().refresh_completed_job_chart();$P().refresh_header_stats();$P().refresh_upcoming_events()">&nbsp;</i></div>
		  <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i>
			<select id="fe_cmp_job_chart_scale" class="subtitle_menu" onChange="$P().refresh_completed_job_chart();app.setPref('job_chart_scale', this.value)">
			<option value="linear">linear</option><option value="logarithmic">logarithmic</option></select>
		  </div>
		  <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i>
			  <select id="fe_cmp_job_chart_limit" class="subtitle_menu" style="width:75px;" onChange="$P().refresh_completed_job_chart();app.setPref('job_chart_limit', this.value)">
			  <option value="1">hide</option> 
			  <option value="50">Last 50</option>
			  <option value="10">Last 10</option>
			  <option value="25">Last 25</option>
			  <option value="35">Last 35</option>
			  <option value="100">Last 100</option>
			  <option value="120">Last 120</option>
			  <option value="150">Last 150</option>
			  <option value="250">Last 250</option>
			  <option value="500">Last 500</option>
			  </select>	  
		  </div>
		  <div class="subtitle_widget"><span id="chart_times" ></span></div>
		  <div class="clear"></div>
		</div>

		<canvas id="d_home_completed_jobs" height="35px"></canvas>
		<div style="height:10px;"></div>

		<!-- Active jobs -->

        <div class="subtitle">
            Active Jobs
            <div class="clear"></div>
        </div>
        <div id="d_home_active_jobs"></div>
        <div style="height:20px;"></div>
        </div>

		<!-- Queued jobs -->
		<div id="d_home_queue_container" style="display:none">
        <div class="subtitle">
            Event Queues
            <div class="clear"></div>
        </div>
        <div id="d_home_queued_jobs"></div>
        <div style="height:20px;"></div>
        </div>

		<!-- Upcoming events-->
        <div id="d_home_upcoming_header" class="subtitle">
        </div>
        <div id="d_home_upcoming_events" class="loading"></div>
        </div> 
		<div id="upcoming_grid" class="upcoming grid-container"></div>
		`)
	},

	onActivate: function(args) {
		// page activation
		if (!this.requireLogin(args)) return true;
		
		if (!args) args = {};
		this.args = args;

        // initial event flow rendering
		let ui = app.config.ui || {}
		let lmt = Number(app.getPref('job_chart_limit') || ui.job_chart_limit || 50)
		let scale = app.getPref('job_chart_scale') || ui.job_chart_scale || 'linear'
		let lmtActual = [1, 10, 25, 35, 50, 100, 120, 150, 250, 500].includes(lmt) ? lmt : 50
		document.getElementById('fe_cmp_job_chart_scale').value = scale;
		document.getElementById('fe_cmp_job_chart_limit').value = lmtActual;

		
		app.setWindowTitle('Home');
		app.showTabBar(true);
		
		this.upcoming_offset = 0;
		
		// presort some stuff for the filter menus
		app.categories.sort( function(a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare( b.title.toLowerCase() );
		} );
		app.plugins.sort( function(a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare( b.title.toLowerCase() );
		} );
		
		// render upcoming event filters
		var html = '';
		html += 'Upcoming Events';
		
		html += '<div class="subtitle_widget"><i class="fa fa-search">&nbsp;</i><input type="text" id="fe_home_keywords" size="10" placeholder="Find events..." style="border:0px;border-radius:5px" value="' + escape_text_field_value( args.keywords ) + '"/></div>';
		
		let ue_options = [
			{title: "Grid View", id: "grid"},
			{title: "Compact View", id: "compact"},
			{title: "Show All", id: "all"}
		]
		let up_event_select = render_menu_options( ue_options , app.getPref('fe_up_eventlimit') || 'grid', false ) + '</select>'

		html += `<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_up_eventlimit" class="subtitle_menu" onChange="$P().nav_upcoming($P().upcoming_offset);">${up_event_select}</div>`;
		html += '<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_home_target" class="subtitle_menu" style="width:75px;" onChange="$P().set_search_filters()"><option value="">All Servers</option>' + this.render_target_menu_options( args.target ) + '</select></div>';
		html += '<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_home_plugin" class="subtitle_menu" style="width:75px;" onChange="$P().set_search_filters()"><option value="">All Plugins</option>' + render_menu_options( app.plugins, args.plugin, false ) + '</select></div>';
		html += '<div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_home_cat" class="subtitle_menu" style="width:95px;" onChange="$P().set_search_filters()"><option value="">All Categories</option>' + render_menu_options( app.categories, args.category, false ) + '</select></div>';
		
		html += '<div class="clear"></div>';
		
		// $('#d_home_upcoming_header').html( html );
		document.getElementById('d_home_upcoming_header').innerHTML = html
		
		setTimeout( function() {
			document.getElementById('fe_home_keywords').addEventListener('keypress', function(event) {
				if (event.key === 'Enter') { // Enter key
					event.preventDefault();
					$P().set_search_filters();
				}
			});
		}, 1 );
		
		// refresh datas
		// $('#d_home_active_jobs').html( this.get_active_jobs_html() );
		document.getElementById('d_home_active_jobs').innerHTML = this.get_active_jobs_html()
		this.refresh_upcoming_events();
		this.refresh_header_stats();
		this.refresh_completed_job_chart();
		this.refresh_event_queues();

		const self = this;
		self.observer = new MutationObserver((mutationList, observer)=> {
			self.refresh_completed_job_chart(); 
		});
		self.observer.observe(document.querySelector('body'), {attributes: true})
		
		return true;
	},
	
	refresh_header_stats: function () {
		// refresh daemons stats in header fieldset
		var html = '';
		var stats = app.state ? (app.state.stats || {}) : {};
		var servers = app.servers || {};
		var ui = app.config.ui || {};
		var active_events = find_objects( app.schedule, { enabled: 1 } );
		var mserver = servers[ app.managerHostname ] || {};

		var total_cpu = 0;
		var total_mem = 0;
		for (var hostname in servers) {
			// daemon process cpu, all servers
			var server = servers[hostname];
			if (server.data && !server.disabled) {
				total_cpu += (server.data.cpu || 0);
				total_mem += (server.data.mem || 0);
			}
		}
		for (var id in app.activeJobs) {
			// active job process cpu, all jobs
			var job = app.activeJobs[id];
			if (job.cpu) total_cpu += (job.cpu.current || 0);
			if (job.mem) total_mem += (job.mem.current || 0);
		}

		let errBg = stats.jobs_completed > 0 && (stats.jobs_failed || 0)/stats.jobs_completed > (parseFloat(ui.err_rate) || 0.03) ? 'red2' : 'gray'
		let errTitle = Object.entries(stats.errorLog || {}).slice(0,20).sort((a,b)=> a[1] < b[1] ? 1 : -1).map(e=>`${e[0]}:\t<b>${e[1]}</b>`).join("\n")
    // xhtml

	let failed_badge = `<span style="cursor:pointer;" onclick='Nav.go("History?sub=error_history&error=1&max=${stats.jobs_failed || 0}")' title="${errTitle}" class="color_label ${errBg}">${stats.jobs_failed || 0}</span>&nbsp;`
	
	status_bar = [
		{name: "EVENTS", value:  active_events.length},
		{name: "CATS", value:  app.categories.length},
		// {name: "PLUGINS", value:  app.plugins.length},
		{name: "JOBS", value:  stats.jobs_completed || 0},
		{name: "FAILED", value: failed_badge},
		{name: "SUCCESS", value:  pct( (stats.jobs_completed || 0) - (stats.jobs_failed || 0), stats.jobs_completed || 1 )},
		{name: "LOG SIZE", value: get_text_from_bytes((stats.jobs_log_size || 0) / (stats.jobs_completed || 1))},
		{name: "UPTIME", value:  get_text_from_seconds( mserver.uptime || 0, false, true )},
		{name: "CPU", value:  `${short_float(total_cpu)}%`},
		{name: "MEMORY", value:  get_text_from_bytes(total_mem)},
		{name: "SERVERS", value:  num_keys(servers)}
	]

	html = '<div class="stats grid-container">'
	status_bar.forEach(e=>{
		html += `<div class="stats grid-item"><div class="flex-container-stats">
		     <div style="padding:2px;font-size:100%"><b>${e.name}:&nbsp;</b></div>
			 <div style="padding:2px;font-size:100%"><b>&nbsp;${e.value}&nbsp;</b></div>
		</div></div>
	`
	})

	html += "</div>"

	document.getElementById('d_home_header_stats').innerHTML = html;
	},
	
	refresh_upcoming_events: function() {
		// send message to worker to refresh upcoming
		this.worker_start_time = hires_time_now();
		this.worker.postMessage({
			default_tz: app.tz,
			schedule: app.schedule,
			state: app.state,
			categories: app.categories,
			plugins: app.plugins
		});
	},
	
	nav_upcoming: function(offset) {
		// refresh upcoming events with new offset
		app.setPref('fe_up_eventlimit', document.getElementById('fe_up_eventlimit').value)
		this.upcoming_offset = offset;
		this.render_upcoming_events({
			data: this.upcoming_events
		});
	},
	
	set_search_filters: function() {
		// grab values from search filters, and refresh
		var args = this.args;		

		args.plugin = document.getElementById('fe_home_plugin').value;
		if (!args.plugin) delete args.plugin;

		args.target = document.getElementById('fe_home_target').value;
		if (!args.target) delete args.target;

		args.category = document.getElementById('fe_home_cat').value;
		if (!args.category) delete args.category;

		args.keywords = document.getElementById('fe_home_keywords').value;
		if (!args.keywords) delete args.keywords;
		
		this.nav_upcoming(0);
	},
	
	render_upcoming_events: function(e) {
		// receive data from worker, render table now
		const self = this;
		var html = '';
		var now = app.epoch || hires_time_now();
		var args = this.args;
		this.upcoming_events = e.data;
		
		var viewType = document.getElementById('fe_up_eventlimit').value;
		let isGrid = viewType === 'grid'

		// apply filters
		var events = [];
		var stubCounter = {}
		var stubTitle = {}
		var maxSchedRows = 25;
		
		for (var idx = 0, len = e.data.length; idx < len; idx++) {
			var stub = e.data[idx];
			var item = find_object( app.schedule, { id: stub.id } ) || {};
			
			if (viewType == "compact" || isGrid) { // one row per event, use badge for job count
				
			    var currSched = moment.tz(stub.epoch * 1000, item.timezone || app.tz).format("h:mm A z");
			    var currCD = get_text_from_seconds_round(Math.max(60, stub.epoch - now), false);

				if (!stubCounter[stub.id]) {
					stubCounter[stub.id] = 1;
					stubTitle[stub.id] = `<table><tr><th>No.</th><th>Schedule</th><th>Countdown</th><tr><td>1</td><td>| ${currSched}&nbsp;&nbsp;</td><td> | ${currCD} </td></tr>`
				}
				else {
					stubCounter[stub.id] += 1;
					if (stubCounter[stub.id] <= maxSchedRows) stubTitle[stub.id] += `<tr><td>${stubCounter[stub.id]} </td><td>| ${currSched}&nbsp;&nbsp;</td><td>| ${currCD} </td></tr>`
					continue
				}
			}

			
			// category filter
			if (args.category && (item.category != args.category)) continue;

			// plugin filter
			if (args.plugin && (item.plugin != args.plugin)) continue;
			
			// server group filter
			if (args.target && (item.target != args.target)) continue;
			
			// keyword filter
			var words = [item.title, item.username, item.notes, item.target].join(' ').toLowerCase();
			if (args.keywords && words.indexOf(args.keywords.toLowerCase()) == -1) continue;
			
			events.push( stub );
		} // foreach item in schedule

		let xhtml = ''
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) + 50) / 7 );
		
		var cols = ['Event Name', 'Category', 'Plugin', 'Target', 'Scheduled Time', 'Countdown', 'Actions'];
		var limit = Math.round((window.innerWidth)/350)*(window.innerHeight < 800 ? 3 : 4) // upcoming 3 or 4 rows
		
		html += this.getPaginatedTable({
			resp: {
				rows: events.slice(this.upcoming_offset, this.upcoming_offset + limit),
				list: {
					length: events.length
				}
			},
			cols: isGrid ? [] : cols,
			data_type: 'pending event',
			limit: limit,
			offset: this.upcoming_offset,
			pagination_link: '$P().nav_upcoming',
			
			callback: function(stub, idx) {
				var item = find_object( app.schedule, { id: stub.id } ) || {};
				// var dargs = get_date_args( stub.epoch );
				var margs = moment.tz(stub.epoch * 1000, item.timezone || app.tz);
				
				var actions = [
					'<a href="#Schedule?sub=edit_event&id='+item.id+'"><b>Edit Event</b></a>'
				];
				
				var cat = item.category ? find_object( app.categories, { id: item.category } ) : null;
				var group = item.target ? find_object( app.server_groups, { id: item.target } ) : null;
				var plugin = item.plugin ? find_object( app.plugins, { id: item.plugin } ) : null;
				
				var nice_countdown = 'Now';
				if (stub.epoch > now) {
					nice_countdown = get_text_from_seconds_round( Math.max(60, stub.epoch - now), false );
					nice_countdown_short = get_text_from_seconds_round( Math.max(60, stub.epoch - now), true ).replace(' hr', 'h');
				}
				
				if (group && item.multiplex) {
					group = copy_object(group);
					group.multiplex = 1;
				}

				let badge = '';
				if(viewType == "compact" || isGrid) {
				  var overLimitRows = stubCounter[stub.id] > maxSchedRows ? ` + ${stubCounter[stub.id] - maxSchedRows} more` : '';
				  var scheduleList = stubTitle[stub.id] + `</table><span><b>${overLimitRows}</span></b>`
				  var jobCount = stubCounter[stub.id]
				  if(jobCount < 10 ) jobCount = `&nbsp;${jobCount}&nbsp;`;
				  badge = `<span title="${scheduleList}" class="color_label gray">${jobCount}</span>`;
				}

				let extraSpace = isGrid ? '<span>&nbsp;</span>' : '<span>&nbsp;&nbsp;</span>'
				let eventName = self.getNiceEvent('<b>' + item.title + '</b>', col_width, 'float:left', extraSpace)

				if(isGrid) {
					
					badge = stubCounter[stub.id] > 1 ? `+${stubCounter[stub.id]-1}` : ''

					// turn minute/hour to min/h if event name is too long
					if(Math.max(60, stub.epoch - now) <= 60*5) { // for minute/soon (larger font)
						nice_countdown = `<div title="${scheduleList}">${item.title.length > 18 ? nice_countdown_short : nice_countdown}</div>`
					}
					else { // regular
					   nice_countdown = `<div title="${scheduleList}">${item.title.length > 26 ? nice_countdown_short : nice_countdown}</div>`
					}					
				}
				
				var tds = [
					`<a style="float:left" href="#Schedule?sub=edit_event&id=${item.id}"> ${eventName}</a>${badge}`,
					self.getNiceCategory( cat, col_width ),
					self.getNicePlugin( plugin, col_width ),
					self.getNiceGroup( group, item.target, col_width ),
					// dargs.hour12 + ':' + dargs.mi + ' ' + dargs.ampm.toUpperCase(),
					margs.format("h:mm A z"),
					nice_countdown,
					actions.join(' | ')
				];
				
				if (cat && cat.color) {
					if (tds.className) tds.className += ' '; else tds.className = '';
					tds.className += cat.color;
				}

				if(!app.state.enabled) tds.className += ' disabled'

				if (isGrid) {
					let proximity = ''
					if (stub.epoch - now <= 60*5) proximity = 'soon'
					if (stub.epoch - now <= 60) proximity = 'minute'

					xhtml += `
				<div id="${stub.id}" class="upcoming ${proximity} grid-item ${tds.className || ''}">
				 <div class="flex-container">
				  <div style="text-overflow:ellipsis;overflow:hidden;white-space: nowrap;">${tds[0]}</div>
				 <div style="font-size:14px"><b>${nice_countdown}</b></div>
				</div>				
				</div>	
			   `
					//    <div> <i style="width:20px;cursor:pointer;padding: 2px" class="fa fa fa-plus-circle" title="Add Event" onmouseup="$P().edit_event(-1)"></i></div>

				}
				else {  // compact table 
					return tds
				}



			} // row callback
		}); // table

		$('#upcoming_grid').html(xhtml)
				
		// $('#d_home_upcoming_events').removeClass('loading').html( html );
		let upcoming = document.getElementById('d_home_upcoming_events');
		upcoming.classList.remove('loading');
		upcoming.innerHTML = html;
	},

	refresh_completed_job_chart: async function () {
	
		if (document.getElementById('fe_cmp_job_chart_limit').value < 2) {
			
			if(app.jobHistoryChart) {
				app.jobHistoryChart.destroy()
				location.reload(true) // no easy way to kill graph, just reload the page
			}			
			return 
		}

		let jobLimit = document.getElementById('fe_cmp_job_chart_limit').value || 50;

		let body = { offset: 0, limit: jobLimit, session_id: localStorage['session_id']}

		fetch('api/app/get_history', {method: 'POST', body: JSON.stringify(body)})
		.then(response => {
			if(!response.ok) throw new Error('Failed to fetch job history')
			return response.json()
		})
		.then(data => { 
			
			if(!data.rows) throw new Error('Job history: Response has no rows')

			let jobs = data.rows.reverse().filter(e=>e.event_title);

			if(jobs.length > 1) {
				let jFrom =  moment.unix(jobs[0].time_start).format('MMM DD, HH:mm:ss');
				let jTo =  moment.unix(jobs[jobs.length-1].time_start + (jobs[jobs.length-1].elapsed || 0)).format('MMM DD, HH:mm:ss');
				document.getElementById('chart_times').textContent  = ` from ${jFrom} | to ${jTo}`
			}

			let isDark = app.getPref('theme') === 'dark'
			let green = isDark ? '#44bb44DD' : '#90EE90AA' // success
			let orange = isDark ? '#bbbb44DD' : '#FFA500AA'  // warning
			let red = isDark ? '#bb4444DD' : '#F88379AA'  // error
			let statusMap = { 0: green, 255: orange }

			let labels = jobs.map(e => '')
			if(jobLimit <= 100) labels = jobs.map((j, i) => i == 0 ? j.event_title.substring(0, 4) : j.event_title);

			let ctx = document.getElementById('d_home_completed_jobs');
			// var gradient = ctx.createLinearGradient(0, 0, 0, 400);
			// gradient.addColorStop(0, 'rgba(250,174,50,1)');   
			// gradient.addColorStop(1, 'rgba(250,174,50,0)');


			let datasets = [{
				label: 'Completed Jobs',
				// data: jobs.map(j => Math.ceil(j.elapsed/60)),
				data: jobs.map(j => Math.ceil(j.elapsed) + 1),
				backgroundColor: jobs.map(j => statusMap[j.code] || red),
				jobs: jobs,

				// borderWidth: 0.3
			}];
			let scaleType =  document.getElementById('fe_cmp_job_chart_scale').value || 'logarithmic';

			// if chart is already generated only update data
			if(app.jobHistoryChart) {
				app.jobHistoryChart.data.datasets = datasets;
				app.jobHistoryChart.data.labels = labels;
				app.jobHistoryChart.options.scales.yAxes[0].type = scaleType;
				app.jobHistoryChart.options.scales.yAxes[0]
				app.jobHistoryChart.options.layout.padding.bottom = jobLimit > 50 ? 50 : 20  
				app.jobHistoryChart.update()
				return
			} 

		
			app.jobHistoryChart = new Chart(ctx, {
				type: 'bar',
				data: {
					//labels: jobs.map(j => moment.unix(j.epoch).format('MM/D, H:mm:ss')),
					labels: labels,
					datasets: datasets
				},
				options: {

					legend: { display: false },
					animation: {duration: 0},
					layout: { padding: { bottom: jobLimit > 50 ? 50 : 20 } },
					tooltips: {

						yAlign: 'top',
						titleFontSize: 14,
						titleFontColor: 'orange',
						displayColors: false,
						callbacks: {
							title: function (ti, dt) { return dt.datasets[0].jobs[ti[0].index].event_title + (dt.datasets[0].jobs[ti[0].index].arg ? ('@' + filterXSS(dt.datasets[0].jobs[ti[0].index].arg)) : '') },
							label: function (ti, dt) {
								//var job = jobs[ti.index]
								let job = dt.datasets[0].jobs[ti.index] ;
								return [
									"Started on " + job.hostname + ' @ ' + moment.unix(job.time_start).format('HH:mm:ss, MMM D'),
									"plugin: " + job.plugin_title,
									"elapsed in " + get_text_from_seconds_round_custom(job.elapsed),
									(job.description || ''),


								]
							}
						}
					}
					, scales: {
						xAxes: [{
							gridLines: { color: 'rgb(170, 170, 170)', lineWidth: 0.3 },
						}],
						yAxes: [{
							type: scaleType,
							gridLines: { color: 'rgb(170, 170, 170)', lineWidth: 0.3  },
							ticks: {
								display: false,
								beginAtZero: true,
								//stepSize: 1,
								//suggestedMax: 10
							}
						}]
					}
				}
			});

			ctx.ondblclick = function(evt){
				let activePoints = app.jobHistoryChart.getElementsAtEvent(evt);
				let firstPoint = activePoints[0];
				let job = app.jobHistoryChart.data.datasets[firstPoint._datasetIndex].jobs[firstPoint._index]
				window.open("#JobDetails?id=" + job.id, "_blank");
			};
		}) // end respose data processing
		.catch(e => console.error(e.message));
			

	},
	
	get_active_jobs_html: function() {
		// get html for active jobs table
		var html = '';
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) + 50) / 8 );
		
		// copy jobs to array
		var jobs = [];
		for (var id in app.activeJobs) {
			jobs.push( app.activeJobs[id] );
		}

		if(jobs.length === 0) return '<div style="display:flex;justify-content: center;font-weight:bold;">No active jobs found<div>'
		
		// sort events by time_start descending
		this.jobs = jobs.sort( function(a, b) {
			if(a.plugin === 'workflow') return  -1
			if(b.plugin === 'workflow') return 1
			return (a.time_start - b.time_start)
			// return (a.time_start > b.time_start) ? 1 : -1;
		} );
		
		var cols = this.jobs.length > 0 ? ['Job ID', 'Event Name', 'Argument', 'Category', 'Hostname', 'Elapsed', 'Progress', 'Remaining', 'Performance', 'Memo', 'Actions'] : [];
		
		// render table
		var self = this;

		html += this.getBasicTable( this.jobs, cols, 'active job', function(job, idx) {
			var actions = [
				// '<span class="link" onMouseUp="$P().go_job_details('+idx+')"><b>Details</b></span>',
				'<span class="link" onMouseUp="$P().abort_job('+idx+')"><b>Abort Job</b></span>'
			];
			
			var cat = job.category ? find_object( app.categories || [], { id: job.category } ) : { title: 'n/a' };
			// var group = item.target ? find_object( app.server_groups || [], { id: item.target } ) : null;
			var plugin = job.plugin ? find_object( app.plugins || [], { id: job.plugin } ) : { title: 'n/a' };
			var tds = null;

			let nice_event = self.getNiceEvent( job.event_title, col_width )
			let nice_arg = self.getNiceArgument(job.arg, 30)

			if (job.pending && job.log_file) {
				// job in retry delay
				tds = [
					'<div class="td_big"><span class="link" onMouseUp="$P().go_job_details('+idx+')">' + self.getNiceJob(job.id) + '</span></div>',
					nice_event,
					nice_arg,
					self.getNiceCategory( cat, col_width ),
					// self.getNicePlugin( plugin ),
					self.getNiceGroup( null, job.hostname, col_width ),
					'<div id="d_home_jt_elapsed_'+job.id+'">' + self.getNiceJobElapsedTime(job) + '</div>',
					'<div id="d_home_jt_progress_'+job.id+'">' + self.getNiceJobPendingText(job) + '</div>',
					'n/a',
					'', // perf
					'', //memo
					actions.join(' | ')
				];
			}
			else if (job.pending) {
				// multiplex stagger delay
				tds = [
					'<div class="td_big">' + self.getNiceJob(job.id ) + '</div>',
					nice_event,
					nice_arg,
					self.getNiceCategory( cat, col_width ),
					// self.getNicePlugin( plugin ),
					self.getNiceGroup( null, job.hostname, col_width ),
					'n/a',
					'<div id="d_home_jt_progress_'+job.id+'">' + self.getNiceJobPendingText(job) + '</div>',
					'n/a',
					'', // perf
					'', // memo
					actions.join(' | ')
				];
			} // pending job
			else {
				// active job
				tds = [
					'<div class="td_big"><span class="link" onMouseUp="$P().go_job_details('+idx+')">' + self.getNiceJob(job.id) + '</span></div>',
					nice_event,
					nice_arg,
					self.getNiceCategory( cat, col_width ),
					// self.getNicePlugin( plugin ),
					self.getNiceGroup( null, job.hostname, col_width ),
					'<div id="d_home_jt_elapsed_'+job.id+'">' + self.getNiceJobElapsedTime(job) + '</div>',
					'<div id="d_home_jt_progress_'+job.id+'">' + self.getNiceJobProgressBar(job) + '</div>',
					'<div id="d_home_jt_remaining_'+job.id+'">' + self.getNiceJobRemainingTime(job) + '</div>',
					`<div style="width:180px;max-width:180px;" id="d_home_jt_perf_${job.id}"> ${job.cpu ? short_float(job.cpu.current) + '% | ' + get_text_from_bytes(job.mem.current) + ' | ' + get_text_from_bytes(job.log_file_size) : ''} </div>`,
					'<div style="width:180px;max-width:180px;" id="d_home_jt_memo_'+job.id+'">' + '</div>',
					actions.join(' | ')
				];
			} // active job
			
			if (cat && cat.color) {
				if (tds.className) tds.className += ' '; else tds.className = '';
				tds.className += cat.color;
			}
			
			return tds;
		} );
		
		return html;
	},
	
	refresh_event_queues: function() {
		// update display of event queues, if any
		var self = this;
		var total_count = 0;
		for (var key in app.eventQueue) {
			total_count += app.eventQueue[key] || 0;
		}
		
		if (!total_count) {
			$('#d_home_queue_container').hide();
			return;
		}
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) + 50) / 6 );
		var cols = ['Event Name', 'Category', 'Plugin', 'Target', 'Queued Jobs', 'Actions'];
		
		var stubs = [];
		var sorted_ids = hash_keys_to_array(app.eventQueue).sort( function(a, b) {
			return (app.eventQueue[a] < app.eventQueue[b]) ? 1 : -1;
		} );
		sorted_ids.forEach( function(id) {
			if (app.eventQueue[id]) stubs.push({ id: id });
		} );
		
		this.queue_stubs = stubs;
		
		// render table
		var html = '';
		html += this.getBasicTable( stubs, cols, 'event', function(stub, idx) {
			var queue_count = app.eventQueue[ stub.id ] || 0;
			var item = find_object( app.schedule, { id: stub.id } ) || {};
			
			// for flush dialog
			stub.title = item.title;
			
			var cat = item.category ? find_object( app.categories, { id: item.category } ) : null;
			var group = item.target ? find_object( app.server_groups, { id: item.target } ) : null;
			var plugin = item.plugin ? find_object( app.plugins, { id: item.plugin } ) : null;
			
			var actions = [
				'<span class="link" onMouseUp="$P().flush_event_queue('+idx+')"><b>Flush Queue</b></span>'
			];
			
			var tds = [
				'<div class="td_big" style="white-space:nowrap;"><a href="#Schedule?sub=edit_event&id='+item.id+'">' + self.getNiceEvent('<b>' + item.title + '</b>', col_width) + '</a></div>',
				self.getNiceCategory( cat, col_width ),
				self.getNicePlugin( plugin, col_width ),
				self.getNiceGroup( group, item.target, col_width ),
				commify( queue_count ),
				actions.join(' | ')
			];
			
			if (cat && cat.color) {
				if (tds.className) tds.className += ' '; else tds.className = '';
				tds.className += cat.color;
			}
			
			return tds;
			
		} ); // getBasicTable
		
		// $('#d_home_queued_jobs').html( html );
		document.getElementById('d_home_queued_jobs').innerHTML = html
		$('#d_home_queue_container').show();
	},
	
	go_job_details: function(idx) {
		// jump to job details page
		var job = this.jobs[idx];
		Nav.go( '#JobDetails?id=' + job.id );
	},
	
	abort_job: function(idx) {
		// abort job, after confirmation
		var job = this.jobs[idx];
		
		app.confirm( '<span style="color:red">Abort Job</span>', "Are you sure you want to abort the job &ldquo;<b>"+job.id+"</b>&rdquo;?</br>(Event: "+job.event_title+")", "Abort", function(result) {
			if (result) {
				app.showProgress( 1.0, "Aborting job..." );
				app.api.post( 'app/abort_job', job, function(resp) {
					app.hideProgress();
					app.showMessage('success', "Job '"+job.event_title+"' was aborted successfully.");
				} );
			}
		} );
	},
	
	flush_event_queue: function(idx) {
		// abort job, after confirmation
		var stub = this.queue_stubs[idx];
		
		app.confirm( '<span style="color:red">Flush Event Queue</span>', "Are you sure you want to flush the queue for event &ldquo;<b>"+stub.title+"</b>&rdquo;?", "Flush", function(result) {
			if (result) {
				app.showProgress( 1.0, "Flushing event queue..." );
				app.api.post( 'app/flush_event_queue', stub, function(resp) {
					app.hideProgress();
					app.showMessage('success', "Event queue for '"+stub.title+"' was flushed successfully.");
				} );
			}
		} );
	},
	
	getNiceJobElapsedTime: function(job) {
		// render nice elapsed time display
		var elapsed = Math.floor( Math.max( 0, app.epoch - job.time_start ) );
		return get_text_from_seconds( elapsed, true, false );
	},
	
	getNiceJobProgressBar: function(job) {
		// render nice progress bar for job
		var html = '';
		var counter = Math.min(1, Math.max(0, job.progress || 1));
		var cx = Math.floor( counter * this.bar_width );
		var extra_classes = '';
		var extra_attribs = '';
		if (counter == 1.0) extra_classes = 'indeterminate';
		else extra_attribs = 'title="'+Math.floor( (counter / 1.0) * 100 )+'%"';
		
		html += '<div class="progress_bar_container '+extra_classes+'" style="width:'+this.bar_width+'px; margin:0;" '+extra_attribs+'>';
			html += `<div class="progress_bar_inner" style="${job.plugin == 'workflow' ? 'background-color:green':''};width:${cx}px;"></div>`;
		html += '</div>';
		
		return html;
	},
	
	getNiceJobRemainingTime: function(job) {
		// get nice job remaining time, using elapsed and progress
		var elapsed = Math.floor( Math.max( 0, app.epoch - job.time_start ) );
		var progress = job.progress || 0;
		if ((elapsed >= 10) && (progress > 0) && (progress < 1.0)) {
			var sec_remain = Math.floor(((1.0 - progress) * elapsed) / progress);
			return get_text_from_seconds( sec_remain, true, true );
		}
		else return 'n/a';
	},
	
	getNiceJobPendingText: function(job) {
		// get nice display for pending job status
		var html = '';
		
		// if job has a log_file, it's in a retry delay, otherwise it's pending (multiplex stagger)
		html += (job.log_file ? 'Retry' : 'Pending');
		
		// countdown to actual launch
		var nice_countdown = get_text_from_seconds( Math.max(0, job.when - app.epoch), true, true );
		html += ' (' + nice_countdown + ')';
		
		return html;
	},
	
	onStatusUpdate: function(data) {
		// received status update (websocket), update page if needed
		if (data.jobs_changed) {
			// refresh tables
			// $('#d_home_active_jobs').html( this.get_active_jobs_html() );
			document.getElementById('d_home_active_jobs').innerHTML = this.get_active_jobs_html() 
		}
		else {
			// update progress, time remaining, no refresh
			for (var id in app.activeJobs) {
				var job = app.activeJobs[id];
				
				if (job.pending) {
					// update countdown
					// $('#d_home_jt_progress_' + job.id).html( this.getNiceJobPendingText(job) );
					document.getElementById('d_home_jt_progress_' + job.id).innerHTML = this.getNiceJobPendingText(job);
					
					if (job.log_file) {
						// retry delay
						// $('#d_home_jt_elapsed_' + job.id).html( this.getNiceJobElapsedTime(job) );
						document.getElementById('d_home_jt_elapsed_' + job.id).innerHTML = this.getNiceJobElapsedTime(job);
					}
				} // pending job
				else {
					// $('#d_home_jt_elapsed_' + job.id).html( this.getNiceJobElapsedTime(job) );
					// $('#d_home_jt_remaining_' + job.id).html( this.getNiceJobRemainingTime(job) );
					document.getElementById('d_home_jt_elapsed_' + job.id).innerHTML = this.getNiceJobElapsedTime(job);
					document.getElementById('d_home_jt_remaining_' + job.id).innerHTML = this.getNiceJobRemainingTime(job);
					
					if(job.memo) {
						let memoClass = String(job.memo).startsWith('OK:') ? 'color_label green' : ''
						if(String(job.memo).startsWith('WARN:')) memoClass = 'color_label yellow'
						if(String(job.memo).startsWith('ERR:')) memoClass = 'color_label red'
						// $('#d_home_jt_memo_' + job.id).html(`<span class="${memoClass}">${encode_entities(job.memo)}</span>`);
						document.getElementById('d_home_jt_memo_' + job.id).innerHTML = `<span class="${memoClass}">${encode_entities(job.memo)}</span>`
					}

					if(job.cpu) {
						// $('#d_home_jt_perf_' + job.id).text(short_float(job.cpu.current) + '% | ' + get_text_from_bytes(job.mem.current) + ' | ' + get_text_from_bytes(job.log_file_size))
						document.getElementById('d_home_jt_perf_' + job.id).textContent = short_float(job.cpu.current) + '% | ' + get_text_from_bytes(job.mem.current) + ' | ' + get_text_from_bytes(job.log_file_size)
					}
					
					// update progress bar without redrawing it (so animation doesn't jitter)
					var counter = job.progress || 1;
					var cx = Math.floor( counter * this.bar_width );
					var prog_cont = $('#d_home_jt_progress_' + job.id + ' > div.progress_bar_container');
					
					if ((counter == 1.0) && !prog_cont.hasClass('indeterminate')) {
						prog_cont.addClass('indeterminate').attr('title', "");
					}
					else if ((counter < 1.0) && prog_cont.hasClass('indeterminate')) {
						prog_cont.removeClass('indeterminate');
					}
					
					if (counter < 1.0) prog_cont.attr('title', '' + Math.floor( (counter / 1.0) * 100 ) + '%');
					
					prog_cont.find('> div.progress_bar_inner').css( 'width', '' + cx + 'px' );
				} // active job
			} // foreach job
		} // quick update
	},
	
	onDataUpdate: function(key, value) {
		// recieved data update (websocket)
		switch (key) {
			case 'state':
				// update chart only on job completion
				if(this.curr_compl_job_count != value.stats.jobs_completed) {
					this.refresh_completed_job_chart()				 
				}
				this.curr_compl_job_count = value.stats.jobs_completed;
				this.refresh_upcoming_events();
				this.refresh_header_stats();
				
				break;
			case 'schedule':
				// state update (new cursors)
				// $('#d_home_upcoming_events').html( this.get_upcoming_events_html() );
				this.refresh_upcoming_events();
				this.refresh_header_stats();
			break;
			
			case 'eventQueue':
				this.refresh_event_queues();
			break;
		}
	},
	
	onResizeDelay: function(size) {
		// called 250ms after latest window resize
		// so we can run more expensive redraw operations
		$('#d_home_active_jobs').html( this.get_active_jobs_html() );
		this.refresh_completed_job_chart()
		this.refresh_header_stats();
		this.refresh_event_queues();
		
		if (this.upcoming_events) {
			this.render_upcoming_events({
				data: this.upcoming_events
			});
		}
	},
	
	onDeactivate: function() {
		// called when page is deactivated
		// this.div.html( '' );
		if(this.observer) this.observer.disconnect() 
		return true;
	}
	
} );
