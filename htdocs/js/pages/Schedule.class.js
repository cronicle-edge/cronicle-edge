Class.subclass(Page.Base, "Page.Schedule", {

	default_sub: 'events',

	onInit: function () {
		// called once at page load
		var html = '';
		this.div.html(html);
	},

	onActivate: function (args) {
		// page activation
		if (!this.requireLogin(args)) return true;

		if (!args) args = {};
		if (!args.sub) args.sub = this.default_sub;
		this.args = args;

		args.eventCount = app.schedule.length;

		app.showTabBar(true);
		// this.tab[0]._page_id = Nav.currentAnchor();

		this.div.addClass('loading');
		this['gosub_' + args.sub](args);
		return true;
	},

	export_schedule: function (args) {
		app.api.post('app/export', this, function (resp) {
			//app.hideProgress();
			app.show_info(`
			   <span > Back Up Scheduler<br><br></span><textarea id="conf_export" rows="22" cols="80">${resp.data}</textarea><br>
			   <div class="caption"> Use this output to restore scheduler data later using Import API or storage-cli.js import command</div>
			   `, '', function (result) {

			});
			//app.showMessage('success', resp.data);
			// self.gosub_servers(self.args);
		});
		//app.api.get('app/export?session_id=' + localStorage.session_id )
	},

	show_graph: function (args) {
		// app.api.post('app/export', this, function (resp) {
		// 	//app.hideProgress();
		const self = this
		setTimeout(() => { self.render_schedule_graph(self.events) }, 100)
		app.show_info(`			  
			  <div style="width: 90vw; height: 82vh" id="schedule_graph2"></div>		  
			  `, '', function (result) { });
	},

	import_schedule: function (args) {

		app.confirm(`<span> Restore Scheduler<br><br>
		<textarea  id="conf_import" rows="22" cols="80"># Paste back up data here</textarea>
		<div class="caption"> Restore scheduler data. Use output of Export API or storage-cli.js export command. To avoid side effects server and plugin data will not be imported.</div>
		`, '', "Import", function (result) {
			if (result) {
				var importData = document.getElementById('conf_import').value;
				app.showProgress(1.0, "Importing...");
				app.api.post('app/import', { txt: importData }, function (resp) {
					app.hideProgress();
					var resultList = resp.result || []
					var report = ''
					var codes = { 0: '✔️', 1: '❌', 2: '⚠️' }
					if (resultList.length > 0) {
						resultList.forEach(val => {
							report += `<tr>
							<td >${codes[val.code]}</td>
							<td style="text-align:left">${val.key}</td>
							<td>${val.desc}</td>
							<td>${val.count || ''}</td>
							</tr>`
						});
					}

					report = report || ' Nothing to Report'

					setTimeout(function () {
						Nav.go('Schedule', 'force'); // refresh categories
						app.show_info(`<div ><table class="data_table">${report}</table></div>`, '');

					}, 50);

				});
			}
		});
	},

	render_time_options: function () {
		let theme = app.getPref('theme')
		let event = this.event
		$('#event_starttime').datetimepicker({ value: event.start_time ? new Date(event.start_time) : null, format: 'Y-m-d H:i', theme: theme });
		$('#event_endtime').datetimepicker({ value: event.end_time ? new Date(event.end_time) : null, format: 'Y-m-d H:i', theme: theme });

	},

	update_graph_icon_label: function () {
		let code = parseInt($('#fe_ee_graph_icon').val(), 16) || 61713
		$("#fe_ee_graph_icon_label").text(' ' + String.fromCodePoint(code))
	},

	///  filelist

	extension_map: {
		java: "text/x-java",
		scala: "text/x-scala",
		cs: "text/x-csharp",
		sql: "text/x-sql",
		dockerfile: "text/x-dockerfile",
		toml: "text/x-toml",
		yaml: "text/x-yaml",
		json: "application/json",
		conf: "text/x-properties",
		sh: "shell",
		groovy: "groovy",
		ps1: "powershell",
		js: "javascript",
		pl: "perl",
		py: "python"
	},

	setFileEditor: function (fileName) {
		const self = this
		let editor = CodeMirror.fromTextArea(document.getElementById("fe_ee_pp_file_content"), {
			mode: self.extension_map[fileName.split('.').pop()] || 'text',
			styleActiveLine: true,
			lineWrapping: false,
			scrollbarStyle: "overlay",
			lineNumbers: true,
			theme: app.getPref('theme') == 'dark' ? 'gruvbox-dark' : 'default',
			matchBrackets: true,
			gutters: [''],
			lint: true
		})

		editor.on('change', function (cm) {
			document.getElementById("fe_ee_pp_file_content").value = cm.getValue();
		});

		editor.setSize('52vw', '52vh')

	},

	render_file_list: function () {
		let cols = ['File Name', ' '];
		let files = this.event.files || []

		if (files.length === 0) {
			document.getElementById('fe_ee_pp_file_list').innerHTML = ''
			return
		}

		let table = '<table id="wf_event_list_table" class="data_table"><tr><th>' + cols.join('</th><th>').replace(/\s+/g, '&nbsp;') + '</th></tr>';

		for (var idx = 0, len = files.length; idx < len; idx++) {
			let actions = ` 
			   <span class="link" onMouseUp = "$P().file_edit(${idx})" > <b>Edit</b></span> | 
			   <span class="link" onMouseUp = "$P().file_delete(${idx})" > <b>Delete</b></span>
			   `
			table += `<tr><td id><b>${encode_entities(files[idx].name)}</b></td><td>${actions}</td> </tr>`

		}

		table += `</table>`

		document.getElementById('fe_ee_pp_file_list').innerHTML = table
	},

	file_add: function () {

		let self = this;
		if (!self.event.files) self.event.files = []
		let files = self.event.files

		// FILE EDITOR ON SHELLPLUG'
		let html = '<table>' +
			get_form_table_row('Name', `<input type="text" id="fe_ee_pp_file_name" size="40" value="" spellcheck="false"/>`) +
			get_form_table_spacer() +
			get_form_table_row('Content', `<textarea style="padding-right:20px"  id="fe_ee_pp_file_content" rows="36" cols="110"></textarea>`)
		html += `</table>`

		setTimeout(() => self.setFileEditor('.text'), 30) // editor needs to wait for a bit for modal window to render

		app.confirm(html, '', "Save", function (result) {

			app.clearError();

			if (result) {

				let name = $("#fe_ee_pp_file_name").val()

				if (!name || files.map(e => e.name).indexOf(name) > -1) {
					app.showMessage('error', "Invalid Name")
				}
				else {
					let content = $("#fe_ee_pp_file_content").val()
					files.push({ name: name, content: content })
				}


				Dialog.hide();

				// update startFrom menu
				//$('#wf_start_from_step').html(render_menu_options(self.wf.map((e, i) => i + 1), self.opts.wf_start_from_step || 1))
				self.render_file_list() // refresh file list



			} // user clicked add
		}); // app.confirm
	},

	file_edit: function (/** @type  {number} */ i) {

		let self = this
		if (!Array.isArray(self.event.files)) return // sanity check
		let file = self.event.files[i]
		if (!file) return // sanity check

		let html = '<table>' +
			get_form_table_row('Name', `<input type="text" id="fe_ee_pp_file_name" size="40" value="${file.name}" spellcheck="false">`) +
			get_form_table_spacer() +
			get_form_table_row('Content', `<textarea style="padding-right:20px"  id="fe_ee_pp_file_content" rows="36" cols="110">${file.content}</textarea>`)
		html += '</table>'

		setTimeout(() => self.setFileEditor(file.name), 30) // editor needs to wait for a bit for modal window to render

		app.confirm(html, '', "Save", function (result) {
			app.clearError();

			if (result) {

				let name = $("#fe_ee_pp_file_name").val()

				if (!name.trim()) {
					app.showMessage('error', "Invalid Name")
				}
				else {
					file.name = name
					file.content = $("#fe_ee_pp_file_content").val()
				}

				Dialog.hide();
				self.render_file_list() // refresh file list

			} // user clicked add
		}); // app.confirm
	},

	file_delete: function ( /** @type {number} */ i) {
		let self = this
		let arr = self.event.files  // this.event.params['wf_events'] || [] 
		if (!Array.isArray(arr)) return
		arr.splice(i, 1)
		self.render_file_list()
	},

	//// workflow 

	/**
	 * @typedef {Object} WFEvent
	 * @property {string} id
	 * @property {string} title
	 * @property {string} arg
	 * @property {boolean} wait
	 * @property {boolean} disabled
	 */

	render_wf_event_list: function () {
		let cols = ['#', "Run", '@', 'Id', 'Title', 'Argument', ' '];
		let wf_events = this.event.workflow || []

		let table = '<table id="wf_event_list_table" class="data_table"><tr><th>' + cols.join('</th><th>').replace(/\s+/g, '&nbsp;') + '</th></tr>';

		if (wf_events.length === 0) {
			table += '<tr><td></td><td></td><td></td><td></td><td><b>No event found</b></td><td></td></tr>'
		}
		// '<input type="checkbox" style="cursor:pointer" onChange="$P().change_event_enabled(' + idx + ')" ' + (item.enabled ? 'checked="checked"' : '') + '/>',
		let schedTitles = {};
		(app.schedule || []).forEach(e => {
			schedTitles[e.id] = e.title
		});

		let startFrom = parseInt($("#wf_start_from_step :selected").val());

		for (var idx = 0, len = wf_events.length; idx < len; idx++) {
			let actions = `<span class="link" onMouseUp="$P().wf_event_edit(${idx})"><b>Edit</b></span> |
	       <span class="link" onMouseUp="$P().wf_event_up(${idx})"><b>Up</b></span> | 
		   <span class="link" onMouseUp = "$P().wf_event_down(${idx})" > <b>Down</b></span> | 
		   <span class="link" onMouseUp = "$P().wf_event_delete(${idx})" > <b>Delete</b></span>
		   `

			let wfe = wf_events[idx]
			let eventId = `<span class="link" style="font-weight:bold; white-space:nowrap;"><a href="#Schedule?sub=edit_event&id=${wfe.id}" target="_blank">${wfe.id}</a></span>`
			let title = `${schedTitles[wfe.id] || '<span style="color:red">[Unknown]</span>'}`.substring(0, 40)
			let arg = wfe.arg || ''
			if (arg.length > 40) arg = arg.substring(0, 37) + '...'
			let argInfo = wfe.arg ? `<span title="refer to JOB_ARG env variable"><u>${encode_entities(arg)}<u></span>` : '-'

			table += `<tr class="${wfe.disabled ? 'disabled' : ''}">
	     <td>${idx + 1}</td>
	     <td><input type="checkbox" onChange="$P().wf_toggle_event_state(${idx})" ${wfe.disabled ? '' : 'checked="checked"'} /></td>
	     <td>${(idx + 1 == startFrom || startFrom > len && idx == 0) ? '<span style="color:green">▶</span>' : ''}</td>
	     <td> ${eventId}</td><td>${title}</td><td style="text-align:center" >${argInfo}</td><td>${actions}</td>
	     </tr>`
		}
		table += `</table>`

		document.getElementById('fe_ee_pp_evt_list').innerHTML = table
	},

	// xxxxxx
	// '<input type="checkbox" style="cursor:pointer" onChange="$P().change_event_enabled(' + idx + ')" ' + (item.enabled ? 'checked="checked"' : '') + '/>',

	wf_event_down: function (/** @type {number} */ i) {
		let arr = this.event.workflow // ;  this.event.params['wf_events']
		if (!Array.isArray(arr) || typeof i !== 'number' || i >= arr.length - 1) return
		[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
		this.render_wf_event_list()
	},

	wf_event_up: function ( /** @type {number} */ i) {
		let self = this
		let workflow = self.event.workflow || []
		let arr = self.event.workflow // this.event.params['wf_events'] || []
		if (!Array.isArray(workflow) || typeof i !== 'number' || i === 0 || i >= arr.length) return
		[workflow[i], workflow[i - 1]] = [workflow[i - 1], workflow[i]];
		this.render_wf_event_list()
	},

	wf_event_delete: function ( /** @type {number} */ i) {
		let self = this
		let workflow = self.event.workflow || []
		let opts = self.event.options || {}
		workflow.splice(i, 1)
		// let arr = self.event.workflow  // this.event.params['wf_events'] || [] 
		//    if (!Array.isArray(workflow)) return
		//    arr.splice(i, 1)
		self.render_wf_event_list()
		$('#wf_start_from_step').html(render_menu_options(workflow.map((e, i) => i + 1), opts.wf_start_from_step || 1))
	},

	wf_toggle_event_state: function (idx) {
		let self = this
		let workflow = self.event.workflow || []
		let evt = workflow[idx]
		evt.disabled = !evt.disabled
		this.render_wf_event_list()
	},

	wf_update_start: function () {
		if (!this.event.options) this.event.options = {}
		this.event.options.wf_start_from_step = parseInt($("#wf_start_from_step :selected").text()) || 1
		this.render_wf_event_list()
	},

	wf_event_add_cat: function () {
		let self = this;
		// let workflow = self.event.workflow || []
		let cat = self.event.category || $('#fe_ee_cat').val() || '';
		let opts = self.event.options || {}
		self.event.workflow = (app.schedule || [])
			.filter(e => e.id != self.event.id && e.category === cat && e.plugin != 'workflow')
			.map(e => { return { id: e.id, title: e.title, arg: "", wait: false } })

		// update startFrom menu
		$('#wf_start_from_step').html(render_menu_options(self.event.workflow.map((e, i) => i + 1), opts.wf_start_from_step || 1))
		self.render_wf_event_list() // refresh event list

	},

	wf_event_add: function () {

		let self = this;
		let catMap = app.categories.reduce((map, obj) => { map[obj.id] = obj.title; return map }, {})

		let sortEvents = (a, b) => {
			if (a.catid == self.event.category) return -1
			if (b.catid == self.event.category) return 1
			return a.cat.localeCompare(b.cat)
		}
		let all_events = (self.events || app.schedule)
			.map(e => { return { id: e.id, title: `${catMap[e.category] || '(N/A)'}: ${e.title}`, arg: "", wait: false, cat: catMap[e.category] || '(N/A)', catid: e.category } })
			.filter(e => e.id != self.event.id)
			.sort(sortEvents)

		if (!self.event.workflow) self.event.workflow = []
		let wf = self.event.workflow
		let opts = self.event.options || {}
		let event_menu = render_menu_options(all_events, wf.length > 0 ? wf[wf.length - 1].id : all_events[0].id)

		let el_style = 'width: 240px; font-size:16px;'
		let html = '<table>' +  //<option value="">(Select Event)</option>
			get_form_table_row('Event', `<select id="fe_ee_pp_wf_select_event" style="${el_style}">${event_menu}</select>`) +
			get_form_table_spacer() +
			get_form_table_row('Job Argument', `<input type="text" id="fe_ee_pp_wf_evt_arg" size="30" value="" spellcheck="false"/>`) +
			get_form_table_spacer() +
			get_form_table_row('Skip', `<input type="checkbox" style="cursor:pointer" id="fe_ee_pp_wf_evt_skip" />`) +
			'</table>'

		app.confirm('<i class="fa fa-clock-o">&nbsp;&nbsp;</i> Add Event', html, "Add", function (result) {
			app.clearError();

			if (result) {

				let evt = find_object(all_events, { id: $('#fe_ee_pp_wf_select_event').find(":selected").val() })
				if (!evt) { app.showMessage('error', "Please select valid event") }
				else {
					evt.arg = $('#fe_ee_pp_wf_evt_arg').val()
					self.event.workflow.push(evt)
				}
				Dialog.hide();

				// update startFrom menu
				$('#wf_start_from_step').html(render_menu_options(wf.map((e, i) => i + 1), opts.wf_start_from_step || 1))
				self.render_wf_event_list() // refresh event list



			} // user clicked add
		}); // app.confirm
	},

	wf_event_edit: function (idx) {
		// show dialog to edit or add wf event
		let self = this;
		let evt = self.event.workflow[idx] //self.wf.event_list[idx]
		let event_list = render_menu_options([evt], evt.id)
		let el_style = 'width: 240px;  font-size:16px;'
		let html = '<table>' +
			get_form_table_row('Event', `<select id="fe_ee_pp_wf_select_event" style="${el_style}" disabled>${event_list}</select>`) +
			get_form_table_spacer() +
			get_form_table_row('Job Argument', `<input type="text" id="fe_ee_pp_wf_evt_arg" size="30" value="${evt.arg}" spellcheck="false"/>`) +
			'</table>'

		app.confirm('<i class="fa fa-clock-o">&nbsp;&nbsp;</i>Edit Event Options', html, "OK", function (result) {
			app.clearError();

			if (result) {
				let evt = self.event.workflow[idx]
				evt.arg = $('#fe_ee_pp_wf_evt_arg').val()

				Dialog.hide();
				self.render_wf_event_list() // refresh event list

			} // user clicked add
		}); // app.confirm

	},

	toggle_token: function () {
		if ($('#fe_ee_token').is(':checked')) {
			$('#fe_ee_token_label').text("")
			if (!this.event.salt) this.event.salt = hex_md5(get_unique_id()).substring(0, 8)
			let base_path = (/^\/\w+$/i).test(config.base_path) ? config.base_path : ''
			let apiUrl = window.location.origin + base_path + '/api/app/run_event?id=' + (this.event.id || 'eventId') + '&post_data=1'
			app.api.post('app/get_event_token', this.event, resp => {
				$('#fe_ee_token_val').text(resp.token ? ` ${apiUrl}&token=${resp.token}` : "(error)");
			});
		}
		else {
			this.event.salt = ""
			$('#fe_ee_token_label').text("Generate Webhook Url");
			$('#fe_ee_token_val').text("");
			this.event.salt = "";
		}
	},

	toggle_hightlight: function (element) {

		let high = app.getPref('shedule_highlight')
		element.classList.toggle('mdi-lightbulb');
		element.classList.toggle('mdi-lightbulb-outline');
		if (high === 'disable') { // turn on
			app.setPref('shedule_highlight', 'default')
			this.update_job_last_runs()
		}
		else { // turn off
			app.setPref('shedule_highlight', 'disable')
			this.gosub_events(this.args);
		}
	},

	getBasicTable2: function (rows, cols, data_type, callback) {
		// get html for sorted table (fake pagination, for looks only)
		var html = '';

		// pagination
		html += '<div class="pagination">';
		html += '<table cellspacing="0" cellpadding="0" border="0" width="100%" style="table-layout:fixed;"><tr>';

		html += '<td align="left" width="33%">';
		if (cols.headerLeft) html += cols.headerLeft;
		else html += commify(rows.length) + ' ' + pluralize(data_type, rows.length) + '';
		html += '</td>';

		html += '<td align="center" width="34%">';
		html += cols.headerCenter || '&nbsp;';
		html += '</td>';

		html += '<td align="right" width="33%">';
		html += cols.headerRight || 'Page 1 of 1';
		html += '</td>';

		html += '</tr></table>';
		html += '</div>';

		html += '<div style="margin-top:5px;">';
		html += '<table class="data_table" width="100%">';
		html += '<tr><th style="white-space:nowrap;">' + cols.join('</th><th style="white-space:nowrap;">') + '</th></tr>';

		for (var idx = 0, len = rows.length; idx < len; idx++) {
			var row = rows[idx];
			var tds = callback(row, idx);
			if (tds.insertAbove) html += tds.insertAbove;
			//if(tds.hide) continue;
			//continue
			html += `<tr ${tds.id ? 'id=' + tds.id : ''} ${tds.className ? ' class="' + tds.className + '"' : ''} ${tds.hide ? 'style="display:none"' : ""} >`;
			html += '<td>' + tds.join('</td><td>') + '</td>';
			html += '</tr>';
		} // foreach row

		if (!rows.length) {
			html += '<tr class="nohighlight"><td colspan="' + cols.length + '" align="center" style="padding-top:10px; padding-bottom:10px; font-weight:bold;">';
			html += 'No ' + pluralize(data_type) + ' found.';
			html += '</td></tr>';
		}

		html += '</table>';
		html += '</div>';

		return html;
	},

	render_schedule_graph: function (events) {

		var sNodes = []
		var sEdges = []
		var catMap = Object.fromEntries(app.categories.map(i => [i.id, i]))

		if (!events) events = app.schedule || []
		let currEvent = this.event || {} // will exist for "edit event" mode
		const args = this.args || {};


		events.forEach((job, index) => {
			let jobGroup = job.enabled ? job.category : 'disabled';
			let jobCat = catMap[job.category] || {};

			// if in event edit mode - use current icon for preview
			let iconCd = args.sub == 'edit_event' && job.id === currEvent.id ? $("#fe_ee_graph_icon").val() : job.graph_icon
			let code = parseInt(iconCd, 16) || 61713
			if (Array.isArray(job.workflow)) code = 61563
			let jobIcon = String.fromCodePoint(code);

			let jobColor = job.enabled ? (jobCat.gcolor || "#3498DB") : "lightgray" // #3f7ed5
			sNodes.push({
				id: job.id,
				label: ` ${job.title} \n ${jobCat.title}`,
				font: `12px lato ${job.enabled ? '#777' : 'lightgray'}`,
				group: jobGroup,
				shape: 'icon',
				icon: { face: "'FontAwesome'", code: jobIcon, color: jobColor }
			})

			if (job.chain) sEdges.push({ from: job.id, to: job.chain, arrows: "to", color: "green", length: 160 })
			if (job.chain_error) sEdges.push({ from: job.id, to: job.chain_error, arrows: "to", color: "red", length: 160 })

			// workflow plugin edges
			if (Array.isArray(job.workflow)) {
				let startFrom = (job.options || {}).wf_start_from_step || 1

				let edgeWidth = {};
				for (e of job.workflow) {
					edgeWidth[e.id] = (edgeWidth[e.id] || 0) + 1
				}

				let wfMap = {}

				for (let i = 0; i < job.workflow.length; i++) {
					let e = job.workflow[i]

					if (wfMap[e.id]) continue
					wfMap[e.id] = true

					sEdges.push({
						from: job.id,
						to: e.id,
						arrows: "to",
						color: e.disabled || startFrom > i + 1 ? "gray" : "orange",
						length: 200,
						label: edgeWidth[e.id] > 1 ? `X${edgeWidth[e.id]}` : `${i + 1}`,
						width: edgeWidth[e.id] > 4 ? 4 : edgeWidth[e.id]
					})
				}

			}
		});

		let sGraph = { nodes: new vis.DataSet(sNodes), edges: new vis.DataSet(sEdges) }

		let options = {
			nodes: { shape: 'box' },
			groups: { disabled: { color: 'lightgray', font: { color: 'gray' } } },
		}

		let net = new vis.Network(document.getElementById("schedule_graph2"), sGraph, options)
		if (currEvent.id) {
			net.selectNodes([currEvent.id])
		}

		// allow delete event by pressing del key

		// $(document).keyup(function (e) {
		// 	if (e.keyCode == 46) { // delete button pressed
		// 		var eventId = net.getSelectedNodes()[0]
		// 		if (!eventId) return;
		// 		var idx = $P().events.findIndex(i => i.id === eventId)
		// 		if (eventId) $P().delete_event(idx)
		// 	}
		// })


		// open event edit page on double click
		net.on("doubleClick", function (params) {
			if (params.nodes.length === 1) {
				var node = params.nodes[0]
				window.open('#Schedule?sub=edit_event&id=' + node, '_self');
			}
		});

		net.fit()

	},

	show_event_stats: function (id) {
		// let evt = find_object(app.schedule, {id: id})
		// document.getElementById('fe_event_info').innerHTML = `${evt.title}: category: ${evt.category} , plugin: ${evt.plugin}`
		// $('#ex_' + id).toggle()
	},

	gosub_events: function (args) {
		// render table of events with filters and search
		this.div.removeClass('loading');
		app.setWindowTitle("Scheduled Events");
		const self = this

		var size = get_inner_window_size();
		var col_width = Math.floor(((size.width * 0.9) + 200) / 8);
		var group_by = app.getPref('schedule_group_by');
		var html = '';

		// presort some stuff for the filter menus
		app.categories.sort(function (a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		});
		app.plugins.sort(function (a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		});

		// render table
		var cols = [
			'<i class="fa fa-check-square-o"></i>',
			'Event Name',
			'Category',
			'Plugin',
			'Target',
			'Timing',
			'Status',
			'Modified',
			'Actions'
		];

		// apply filters
		this.events = [];

		// list of events that chain or is chained by other job
		let chained = new Map()
		app.schedule.forEach((e) => {
			if (e.chain) { chained[e.chain] = true; chained[e.id] = true }
			if (e.chain_error) { chained[e.chain_error] = true; chained[e.id] = true }
		})

		app.chained_jobs = {};
		app.event_map = {};
		var g = new graphlib.Graph();

		for (var idx = 0, len = app.schedule.length; idx < len; idx++) {
			var item = app.schedule[idx];

			// set up graph to detect cycles
			g.setNode(item.id);
			if (item.chain) g.setEdge(item.id, item.chain)
			if (item.chain_error) g.setEdge(item.id, item.chain_error)

			app.event_map[item.id] = item.title; // map for: id -> title

			// check if job is chained by other jobs to display it on tooltip
			var niceSchedule = summarize_event_timing(item.timing, item.timezone)
			// on succuss or both
			if (item.chain) {
				var chainData = `<b>${item.title}:</b> ${niceSchedule} ${item.chain == item.chain_error ? '(any)' : '(success)'}<br>`
				if (app.chained_jobs[item.chain]) app.chained_jobs[item.chain] += chainData
				else app.chained_jobs[item.chain] = '<u>Chained by:</u><br>' + chainData
			}
			// on error
			if (item.chain_error) {
				if (item.chain_error != item.chain) {
					var chainData = `<b>${item.title}:</b> ${niceSchedule} (error) <br>`
					if (app.chained_jobs[item.chain_error]) app.chained_jobs[item.chain_error] += chainData
					else app.chained_jobs[item.chain_error] = '<u>Chained by:</u><br>' + chainData
				}
			}

			let filter = app.filter.schedule || {} // persist schedule page filtering

			// category filter
			args.category = args.category || filter['category']
			if (args.category && (item.category != args.category)) continue;

			// plugin filter
			args.plugin = args.plugin || filter['plugin']
			if (args.plugin && (item.plugin != args.plugin)) continue;

			// server group filter
			args.target = args.target || filter['target']
			if (args.target && (item.target != args.target)) continue;

			// keyword filter
			args.keywords = args.keywords || filter['keywords']
			var words = [item.title, item.username, item.notes, item.target].join(' ').toLowerCase();
			if (args.keywords && words.indexOf(args.keywords.toString().toLowerCase()) == -1) continue;
			//if (('keywords' in args) && words.indexOf(args.keywords.toString().toLowerCase()) == -1) continue;

			// enabled filter
			args.enabled = args.enabled || filter['enabled']
			if ((args.enabled == 1) && !item.enabled) continue;
			else if ((args.enabled == -1) && item.enabled) continue;

			// last success/fail filter
			else if (args.enabled == 'success') {
				if (!app.state.jobCodes || !(item.id in app.state.jobCodes)) continue; // n/a
				if (app.state.jobCodes[item.id]) continue; // error
			}
			else if (args.enabled == 'error') {
				if (!app.state.jobCodes || !(item.id in app.state.jobCodes)) continue; // n/a
				if (!app.state.jobCodes[item.id]) continue; // success
			}
			else if (args.enabled == 'chained') {
				if (!chained[item.id]) continue; // n/a
			}

			this.events.push(copy_object(item));
		} // foreach item in schedule

		// calculate job graph cycles
		var cycleWarning = ''
		var cycles = graphlib.alg.findCycles(g) // return array of arrays (or empty array)
		if (cycles.length) {
			cycleWarningTitle = '<b> ! Schedule contains cycled event chains:</b><br>'
			cycles.forEach(function (item, index) {
				// item.unshift(item[item.length-1]);
				cycleWarningTitle += (item.map((e) => app.event_map[e]).join(" ← ") + '<br>');
			});
			cycleWarning = `<span title="${cycleWarningTitle}"> ⚠️ </span>`
		}

		// Scheduled Event page:
		let miniButtons = ''

		if (app.hasPrivilege('create_events')) {
			miniButtons += '<div class="subtitle_widget"><i style="width:20px;cursor:pointer;" class="fa fa fa-plus-circle" title="Add Event" onMouseUp="$P().edit_event(-1)"></i></div>'
			miniButtons += '<div class="subtitle_widget"><i style="width:20px;cursor:pointer;" class="fa fa-bolt" title="Generate Event" onMouseUp="$P().do_random_event()"></i></div>'
		}

		// if (app.isAdmin()) {}
		// add bulb icon to toggle event status highlighting
		let bulbIcon = app.getPref('shedule_highlight') === 'disable' ? 'mdi-lightbulb-outline' : 'mdi-lightbulb'
		miniButtons += `<div class="subtitle_widget"><i style="width:20px;cursor:pointer;" class="mdi ${bulbIcon} mdi-lg" title="Toggle Event Status Highlighting" onclick="$P().toggle_hightlight(this)"></i></div>`

		miniButtons += '<div class="subtitle_widget"><i style="width:20px;cursor:pointer;" class="fa fa-pie-chart" title="Show Event Graph" onMouseUp="$P().show_graph()"></i></div>'

		let eventView = app.getPref('event_view') || 'details'
		let isGrid = eventView === 'grid' || eventView === 'gridall'

		html += `
		 <div class="subtitle flex-container" style="height:auto;padding:8px">
		 <div style="width: calc(45%)">Scheduled Events ${cycleWarning}</div>
		 <div class="flex-container" style="width:calc(10%)">${miniButtons}</div>
		 <div style="width: calc(45%);padding-right:10px">
		   <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_sch_target" class="subtitle_menu" style="width:70px;" onChange="$P().set_search_filters()"><option value="">All Servers</option>${this.render_target_menu_options(args.target)}</select></div>
		   <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_sch_plugin" class="subtitle_menu" style="width:70px;" onChange="$P().set_search_filters()"><option value="">All Plugins</option>${render_menu_options(app.plugins, args.plugin, false)}</select></div>
		   <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_sch_cat" class="subtitle_menu" style="width:70px;" onChange="$P().set_search_filters()"><option value="">All Cats</option>${render_menu_options(app.categories, args.category, false)}</select></div>
		   <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_sch_enabled" class="subtitle_menu" style="width:70px;" onChange="$P().set_search_filters()"><option value="">All Events</option>${render_menu_options([[1, 'Enabled'], [-1, 'Disabled'], ['success', "Last Run Success"], ['error', "Last Run Error"], ["chained", "Chained"]], args.enabled, false)}</select></div>
		   <div class="subtitle_widget"><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_event_view" class="subtitle_menu" style="width:70px;" onChange="$P().change_event_view(this.value)"><option value="">Details</option>${render_menu_options([['grid', 'Grid'], ['gridall', "Grid-All"]], eventView, false)}</select></div>
		 </div>          
		 
		</div>
		<div class="clear"></div>
		`
		// prep events for sort
		this.events.forEach(function (item) {
			var cat = item.category ? find_object(app.categories, { id: item.category }) : null;
			var group = item.target ? find_object(app.server_groups, { id: item.target }) : null;
			var plugin = item.plugin ? find_object(app.plugins, { id: item.plugin }) : null;

			if (item.enabled && cat.enabled) item.active = true

			item.category_title = cat ? cat.title : 'Uncategorized';
			item.group_title = group ? group.title : item.target;
			item.plugin_title = plugin ? plugin.title : 'No Plugin';
		});

		if (group_by === 'modified') {
			this.events.sort((a, b) => self.alt_sort * (b.modified - a.modified)) // default Z->A. if alt_sort is set then A-Z
		}
		else {
			// sort events by title ascending
			this.events = this.events.sort(function (a, b) {
				var key = group_by ? (group_by + '_title') : 'title';
				if (group_by && (a[key].toLowerCase() == b[key].toLowerCase())) key = 'title';
				return self.alt_sort * a[key].toLowerCase().localeCompare(b[key].toLowerCase());
				// return (b.title < a.title) ? 1 : -1;
			});
		}

		// header center (group by buttons)

		cols.headerRight = `
		<div class="schedule_group_button_container">
		
		<i class="fa fa-sort-alpha-asc ${group_by ? '' : 'selected'}" title="Sort by Title" onMouseUp="$P().change_group_by(\'\')"></i>
		<i class="fa fa-clock-o ${group_by == 'modified' ? 'selected' : ''}" title="Sort by Modified" onMouseUp="$P().change_group_by(\'modified\')"></i>	
		<i class="fa fa-folder-open-o ${group_by == 'category' ? 'selected' : ''}" title="Group by Category" onMouseUp="$P().change_group_by(\'category\')"></i>
		<i class="fa fa-plug ${group_by == 'plugin' ? 'selected' : ''}" title="Group by Plugin" onMouseUp="$P().change_group_by(\'plugin\')"></i>
		<i class="mdi mdi-server-network ${((group_by == 'group') ? 'selected' : '')}" title="Group by Target" onMouseUp="$P().change_group_by(\'group\')"></i>
		<i > </i>
		<i class="${args.collapse ? 'fa fa-arrow-circle-right' : 'fa fa-arrow-circle-up'}" title="${args.collapse ? 'Expand' : 'Collapse'}" onclick="$P().toggle_group_by()"></i>		
		</div>
		`
		// searchBar
		cols.headerCenter = `<div style="padding-bottom:8px;padding-right:12px"><i class="fa fa-search">&nbsp;</i><input type="text" id="fe_sch_keywords" size="25" onfocus="this.placeholder=''" placeholder="Find events..." class="event-search" autocomplete="one-time-code" value="${escape_text_field_value(args.keywords)}"/></div>`

		// render table
		let last_group = '';

		let xhtml = '';

		let events = this.events || [];

		let totalEvents = events.length

		if (eventView === 'grid') {
			totalEvents = `${events.filter(e => e.active).length} active`
		}

		var htmlTab = this.getBasicTable2(events, cols, 'event', function (item, idx) {

			let actions;

			if (isGrid) {
				actions = [
					'<span class="link event-action" onMouseUp="$P().run_event(' + idx + ',event)"><b>run |</b></span>',
					`<span class="link event-action" onMouseUp="Nav.go('#History?sub=event_history&id=${item.id}')"><b>history |</b></span>`,
					'<span class="link event-action" onMouseUp="$P().delete_event(' + idx + ')"><b> delete</b></span>'
				]

			}
			else {
				actions = [
					'<span class="link" onMouseUp="$P().run_event(' + idx + ',event)"><b>Run</b></span>',
					'<span class="link" onMouseUp="$P().edit_event(' + idx + ')"><b>Edit</b></span>',
					'<a href="#History?sub=event_stats&id=' + item.id + '"><b>Stats</b></a>',
					'<a href="#History?sub=event_history&id=' + item.id + '"><b>History</b></a>',
					'<span class="link" onMouseUp="$P().delete_event(' + idx + ')"><b>Delete</b></span>',
					// '<span class="link" onMouseUp="$P().delete_event('+idx+')"><b>Delete</b></span>'
				];
			}

			var cat = item.category ? find_object(app.categories, { id: item.category }) : null;
			var group = item.target ? find_object(app.server_groups, { id: item.target }) : null;
			var plugin = item.plugin ? find_object(app.plugins, { id: item.plugin }) : null;

			// var jobs = find_objects( app.activeJobs, { event: item.id } );
			var status_html = 'n/a';
			if (app.state.jobCodes && (item.id in app.state.jobCodes)) {
				var last_code = app.state.jobCodes[item.id];
				status_html = last_code ? '<span class="color_label red clicky"><i class="fa fa-warning">&nbsp;</i>Error</span>' : '<span class="color_label green clicky"><i class="fa fa-check">&nbsp;</i>Success</span>';
				if (last_code == 255) status_html = '<span class="color_label yellow clicky"><i class="fa fa-warning">&nbsp;</i>Warning</span>'
			}

			if (group && item.multiplex) {
				group = copy_object(group);
				group.multiplex = 1;
			}

			// prepare  chain info tooltip
			// on child
			var chainInfo = app.chained_jobs[item.id] ? ` &nbsp;<i class="fa fa-arrow-left" title="${app.chained_jobs[item.id]}"></i>` : '';
			// on parent
			var chain_tooltip = []; // tooltip for chaining parent 
			if (item.chain) chain_tooltip.push('<b>success</b>: ' + app.event_map[item.chain])
			if (item.chain_error) chain_tooltip.push('<b>error</b>: ' + app.event_map[item.chain_error])

			// warn if chain/chain_error event is removed but still referenced
			var chain_error = '';
			if (item.chain && !app.event_map[item.chain]) chain_error += '<b>' + item.chain + '</b><br>';
			if (item.chain_error && !app.event_map[item.chain_error]) chain_error += '<b>' + item.chain_error + '</b><br>';
			var chain_error_msg = chain_error ? `<i class="fa fa-exclamation-triangle" title="Chain contains unexistent events:<br>${chain_error}">&nbsp;</i>` : '';

			var evt_name = self.getNiceEvent(item, col_width, 'float:left', '<span>&nbsp;&nbsp;</span>', isGrid);

			if (chain_tooltip.length > 0) evt_name += `<i  title="${chain_tooltip.join('<br>')}" class="fa fa-arrow-right">&nbsp;&nbsp;</i>${chain_error_msg}</span>`;

			// check if event is has limited time range
			let inactiveTitle
			let item_start = parseInt(item.start_time) || 0
			let item_end = parseInt(item.end_time) || Infinity
			let next = new Date().valueOf()

			if(item_end < item_start) { // reverse mode: suspend job betwen end and start times
				if( next > item_end && next < item_start ) inactiveTitle = 'Schedule will resume at ' + new Date(item.start_time).toLocaleString()
			}
			else {  // normal mode: run job between start and end
				if (item_start > next + 60000 ) inactiveTitle = 'Schedule will resume at ' + new Date(item.start_time).toLocaleString()
				if (item_end < next) inactiveTitle = 'Schedule expired on ' + new Date(item.end_time).toLocaleString()
			}

			// for timing     
			let niceTiming = summarize_event_timing(item.timing, item.timezone, (inactiveTitle || isGrid) ? null : item.ticks)
			let gridTiming = niceTiming.length > 20 ? summarize_event_timing_short(item.timing) : niceTiming
			let gridTimingTitle = niceTiming;

			if (parseInt(item.interval) > 0) { // for interval
				niceTiming = gridTiming = summarize_event_interval(parseInt(item.interval), isGrid)
				let interval_start = 'epoch'
				if (parseInt(item.interval_start)) {
					if (parseInt(item.interval) % (3600 * 24 * 7) === 0) { // weekly intervals
						let ddd = moment.tz(parseInt(item.interval_start) * 1000, item.tz || app.tz).format(`ddd`)
						niceTiming = `${gridTiming} (on ${ddd})`
					}
					let hhFormat = app.hh24 ? 'yyyy-MM-DD HH:mm' : 'lll'
					interval_start = moment.tz(parseInt(item.interval_start) * 1000, item.tz || app.tz).format(`ddd ${hhFormat} z`);
				}
				gridTimingTitle = niceTiming + `<br>Starting from ${interval_start}`
			}

			if(parseInt(item.repeat) > 0) {
				niceTiming = gridTiming = summarize_repeat_interval(parseInt(item.repeat), isGrid)
				gridTimingTitle = summarize_repeat_interval(parseInt(item.repeat))
			}

			if (inactiveTitle) {
				gridTiming = `<s>${gridTiming}</s>`
				gridTimingTitle = `${inactiveTitle}<br><s>${niceTiming}</s>`
				niceTiming = `<span title="${inactiveTitle}"><s>${niceTiming}</s>`
				if (item.ticks) niceTiming += `<span title="Extra Ticks: ${item.ticks}"> <b>+</b> </>`


			}

			let now = Date.now() / 1000

			tds = [
				'<input type="checkbox" style="cursor:pointer" onChange="$P().change_event_enabled(' + idx + ', this)" ' + (item.enabled ? 'checked="checked"' : '') + '/>',
				`<div class="td_big"><span class="link" onMouseUp="$P().edit_event(` + idx + ')">' + evt_name + '</span></div>',
				self.getNiceCategory(cat, col_width),
				self.getNicePlugin(plugin, col_width),
				self.getNiceGroup(group, item.target, col_width),
				niceTiming + chainInfo,
				'<span id="ss_' + item.id + '" onMouseUp="$P().jump_to_last_job(' + idx + ')">' + status_html + '</span>',
				get_text_from_seconds(now - item.modified, true, true), //modified
				actions.join('&nbsp;|&nbsp;')
			];

			if (item.id) tds.id = item.id

			if (!item.enabled) tds.className = 'disabled';
			if (cat && !cat.enabled) tds.className = 'disabled';
			if (plugin && !plugin.enabled) tds.className = 'disabled';

			if (cat && cat.color) {
				if (tds.className) tds.className += ' '; else tds.className = '';
				tds.className += cat.color;
			}


			// group by
			if (group_by) {

				let cur_group = item[group_by + '_title'];
				tds.className = 'event_group_' + (group_by == 'group' ? item['target'] || 'allgrp' : item[group_by]) + ' ' + (tds.className || '')

				if (cur_group != last_group) {
					last_group = cur_group;
					let group_title;

					if (isGrid) {  // grid view
						switch (group_by) {
							case 'category': group_title = self.getNiceCategory(cat, 500, args.collapse); break;
							case 'plugin': group_title = self.getNicePlugin(plugin, 500, args.collapse); break;
							case 'group': group_title = self.getNiceGroup(group, item.target, 500, args.collapse); break;
						}

						// for regular grid - do not show disabled category
						if (eventView === 'grid' && group_by === 'category' && !cat.enabled) group_title = null;

						if (group_title) xhtml += `<div class="section-divider"><div class="subtitle">${group_title}</div></div>`
						// tds.insertAbove = group_title;
					}
					else {  // table view
						let insert_html = '<tr class="nohighlight"><td colspan="' + cols.length + '"><div class="schedule_group_header">';
						switch (group_by) {
							case 'category': insert_html += self.getNiceCategory(cat, 500, args.collapse); break;
							case 'plugin': insert_html += self.getNicePlugin(plugin, 500, args.collapse); break;
							case 'group': insert_html += self.getNiceGroup(group, item.target, 500, args.collapse); break;
						}
						tds.insertAbove = `${insert_html}</div></td></tr>`;
					}

				} // group changed

				if (args.collapse) tds.hide = true
			} // group_by


			// timing title in grid view

			if (item.ticks) {
				gridTimingTitle += `<br><br>Extra ticks: ${item.ticks}`
				gridTiming += "+"
			}

			if (app.chained_jobs[item.id]) {
				gridTimingTitle += ('<br><br>' + app.chained_jobs[item.id])
				gridTiming += "<";
			}

			let lastStatus = 'event-none'
			let jobCodes = app.state.jobCodes || {}
			let xcode = jobCodes[item.id];
			if (xcode === 0) {
				lastStatus = 'event-success'
			}
			if (xcode > 0) {
				lastStatus = 'event-error'
				bg = 'red'
			}
			if (xcode === 255) {
				lastStatus = 'event-warning'
				bg = 'orange'
			}

			// ${tds[0]}
			//<div ><span style="font-size:0.8em" class="color_label green">✓</span></div>	
			let itemVisibility = eventView === 'grid' && (!item.active || args.collapse) ? 'none' : 'true'
			// link item to it's group, avoid for disabled event on basic grid view
			let itemClass = ((eventView === 'grid' && !item.active) ? '' : (tds.className || ''))

			let statusIcon = `<span id="ss_${item.id}" onMouseUp="$P().jump_to_last_job(${idx})" style="cursor:pointer;font-size:1.1em;"><i class="fa fa-circle ${lastStatus}"></i></span>`

			xhtml += `
			<div id="sg_${item.id}" style="display:${itemVisibility}" class="upcoming schedule grid-item ${itemClass}" onclick="">
			 <div class="flex-container schedule">
			  <div style="text-overflow:ellipsis;overflow:hidden;white-space: nowrap;">${tds[1]}</div>
			
			  <div ><span id="ss_${item.id}" onMouseUp="$P().jump_to_last_job(${idx})" style="cursor:pointer;font-size:1.1em;">${statusIcon}</span></div>			 
			</div>			

			<div class="flex-container">
			  <div style="padding-left:5px">${actions.join(' ')}</div>	
			  <div style="text-overflow:ellipsis;overflow:hidden;white-space: nowrap;">		 
			  <span title="${gridTimingTitle}" style="overflow:hidden;text-overflow: ellipsis;white-space:nowrap">${gridTiming}</span> 
			  </div>		 
		    </div>
			</div>
				
		   `
			return tds;
		});

		if (isGrid) html += `
	   <div class="flex-container widget" style="padding-bottom:6px">
	    <div id="fe_event_info" style="width:100px;margin-left:60px;font-weight:bold" class="subtitle_widget">${totalEvents} events</div>
 	     ${cols.headerCenter}
		 <div style="padding-right:30px" >${cols.headerRight}</div>
	   </div> 
	   <div id="scheduled_grid" class="upcoming schedule grid-container">${xhtml}</div>`
		else html += `<div id="schedule_table"> ${htmlTab} </div>`

		// table and graph (hide latter by default)
		html += ` <center><table><tr><div style="height:30px;"></div>`

		if (app.hasPrivilege('create_events')) {
			html += `<td><div class="button" style="width:130px;" onMouseUp="$P().edit_event(-1)"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Add Event...</div></td>
			<td width="40">&nbsp;</td>
			<td><div class="button" style="width:130px;" onMouseUp="$P().do_random_event()"><i class="fa fa-bolt">&nbsp;&nbsp;</i>Generate</div></td>
			<td width="40">&nbsp;</td>
			`
		}

		// backup/restore buttons - admin only
		if (app.isAdmin()) {
			html += '<td><div class="button" style="width:130px;" onMouseUp="$P().export_schedule()"><i class="fa fa-download">&nbsp;&nbsp;</i>Backup</div></td><td width="40">&nbsp;</td>';

			if (app.schedule.length === 0) {  // only show import button if there are no scheduled jobs yet
				html += '<td><div class="button" style="width:130px;" onMouseUp="$P().import_schedule()"><i class="fa fa-upload">&nbsp;&nbsp;</i>Import</div></td><td width="40">&nbsp;</td>';
			}
		}

		html += '<td><div class="button" style="width:130px;" onMouseUp="$P().show_graph()"><i class="fa fa-pie-chart">&nbsp;&nbsp;</i>Show Graph</div></td><td width="40">&nbsp;</td>';
		this.div.html(html);
		this.update_job_last_runs();

		setTimeout(function () {
			$('#fe_sch_keywords').keypress(function (event) {
				if (event.keyCode == '13') { // enter key
					event.preventDefault();
					$P().set_search_filters();
				}
			});
		}, 1);
	},

	update_job_last_runs: function () {
		// update last run state for all jobs, called when state is updated
		if (!app.state.jobCodes) return;
		if (app.getPref('shedule_highlight') === 'disable') return;

		let isGrid = app.getPref('event_view') === 'grid' || app.getPref('event_view') == 'gridall'

		let event_counts = {};
		for (var job_id in app.activeJobs) {
			let job = app.activeJobs[job_id];
			event_counts[job.event] = (event_counts[job.event] || 0) + 1;
		}

		let allEvents = app.schedule || []

		allEvents.forEach((evt) => {

			let event_id = evt.id
			let last_code = app.state.jobCodes[event_id];
			let isRunning = event_counts[event_id]
			let status_html = '';			
			let bg;
				
			if (isRunning) {
				status_html = isGrid ? `<span class="running-event">Running (${isRunning})</span>` : `<span class="color_label blue clicky">Running (${isRunning})</span>`
				bg = 'blue'
			}
			else if (last_code === 0) {
				status_html = isGrid ? '<i class="fa fa-circle event-success"></i>' : '<span class="color_label green clicky"><i class="fa fa-check">&nbsp;</i>Success</span>'
			}
			else if (last_code == 255) {
				status_html = isGrid ? '<i class="fa fa-circle event-warning"></i>' : '<span class="color_label yellow clicky"><i class="fa fa-warning">&nbsp;</i>Warning</span>'
				bg = 'orange'
			}
			else if (last_code > 0) {
				status_html = isGrid ? '<i class="fa fa-circle event-error"></i>' : '<span class="color_label red clicky"><i class="fa fa-warning">&nbsp;</i>Error</span>'
				bg = 'red'
			}

			let gridItem = isGrid ? document.getElementById('sg_' + event_id) : null

			if (gridItem) {
				gridItem.classList.remove('red', 'orange', 'blue')
				if (bg) gridItem.classList.add(bg)
			}
			let statusIcon = document.getElementById('ss_' + event_id)
			if (statusIcon) statusIcon.innerHTML = status_html
		})
	},

	jump_to_last_job: function (idx) {
		// locate ID of latest completed job for event, and redirect to it
		var event = this.events[idx];

		var event_counts = {};

		for (var job_id in app.activeJobs) {
			var job = app.activeJobs[job_id];
			event_counts[job.event] = (event_counts[job.event] || 0) + 1;
		}

		if (event_counts[event.id] && app.getPref('shedule_highlight') !== 'disable') {
			// if event has active jobs, change behavior of click (but only if schedule realtime status updates enabled)
			// if exactly 1 job, link to it -- if more, do nothing
			if (event_counts[event.id] == 1) {
				var job = find_object(Object.values(app.activeJobs), { event: event.id });
				if (job) Nav.go('JobDetails?id=' + job.id);
				return;
			}
			else return;
		}

		// jump to last completed job
		app.api.post('app/get_event_history', { id: event.id, offset: 0, limit: 1 }, function (resp) {
			if (resp && resp.rows && resp.rows[0]) {
				var job = resp.rows[0];
				Nav.go('JobDetails?id=' + job.id);
			}
		});
	},

	alt_sort: 1,

	change_group_by: function (group_by) {
		// toggle sort order for title and time
		if (group_by === app.getPref('schedule_group_by')) this.alt_sort *= -1
		else this.alt_sort = 1
		// change grop by setting and refresh schedule display
		app.setPref('schedule_group_by', group_by);
		this.gosub_events(this.args);
	},

	change_event_view: function (view_type) {
		//  if( ['Grid', 'Details', 'Grid-All'].indexOf(view_type) < 0 ) view_type = 'Details'
		if (['details', 'grid', 'gridall'].indexOf(view_type) < 0) view_type = 'details'
		app.setPref('event_view', view_type)
		this.gosub_events(this.args);

	},

	toggle_group_by: function () {
		let args = this.args
		args.collapse ^= true
		this.change_group_by(app.getPref('schedule_group_by'))
	},

	change_event_enabled: function (idx, box) {
		// toggle event on / off
		var event = this.events[idx];

	        if (this.isAdmin()) { // for admins - toggle state right away (old way)
			event.enabled = event.enabled ? 0 : 1;
			var stub = {
				id: event.id,
				title: event.title,
				enabled: event.enabled,
				catch_up: event.catch_up || 0
			};

			app.api.post('app/toggle_event', stub, function (resp) {
				$('#' + event.id).toggleClass('disabled')
				app.showMessage('success', "Event '" + event.title + "' has been " + (event.enabled ? 'enabled' : 'disabled') + ".");
			});

		}

		else { // for non-admin ask to confirm first
			let action = event.enabled ? 'Disable' : 'Enable'
			let msg = `Are you sure you want to ${action} <b>${event.title}</b> event?`

			app.confirm(`<span style="color:red">${action} Event</span>`, msg, action, function (result) {
				if (result) {

					event.enabled = event.enabled ? 0 : 1;

					var stub = {
						id: event.id,
						title: event.title,
						enabled: event.enabled,
						catch_up: event.catch_up || 0
					};

					app.showProgress(1.0, "Updating Event...");

					app.api.post('app/toggle_event', stub, function (resp) {
						app.hideProgress();
						app.showMessage('success', "Event '" + event.title + "' has been " + action + "d.");
						$('#' + event.id).toggleClass('disabled');
					});

				}
				else {
					if (box) box.checked = !box.checked
				}

			});

		}

	},

	run_event: function (event_idx, e) {
		// run event ad-hoc style
		var self = this;
		var event = (event_idx == 'edit') ? this.event : this.events[event_idx];

		if (e.shiftKey || e.ctrlKey || e.altKey) {
			// allow use to select the "now" time
			this.choose_date_time({
				when: time_now(),
				title: "Set Current Event Date/Time",
				description: "Configure the internal date/time for the event to run immediately.  This is the timestamp which the Plugin will see as the current time.",
				button: "Run Now",
				timezone: event.timezone || app.tz,

				callback: function (new_epoch) {
					self.run_event_now(event_idx, new_epoch);
				}
			});
		}
		else this.run_event_now(event_idx);
	},

	run_event_now: function (idx, now) {
		// run event ad-hoc style
		var event = (idx == 'edit') ? this.event : this.events[idx];
		if (!now) now = time_now();

		app.api.post('app/run_event', merge_objects(event, { now: now }), function (resp) {
			var msg = '';
			if (resp.ids.length > 1) {
				// multiple jobs (multiplex)
				var num = resp.ids.length;
				msg = 'Event "' + event.title + '" has been started (' + num + ' jobs).  View their progress on the <a href="#Home">Home Tab</a>.';
			}
			else if (resp.ids.length == 1) {
				// single job
				var id = resp.ids[0];
				msg = 'Event "' + event.title + '" has been started.  <a href="#JobDetails?id=' + id + '">Click here</a> to view its progress.';
			}
			else {
				// queued
				msg = 'Event "' + event.title + '" could not run right away, but was queued up.  View the queue progress on the <a href="#Home">Home Tab</a>.';
			}
			app.showMessage('success', msg);
		});
	},

	edit_event: function (idx) {
		// edit or create new event
		if (idx == -1) {
			Nav.go('Schedule?sub=new_event');
			return;
		}

		// edit existing
		var event = this.events[idx];
		Nav.go('Schedule?sub=edit_event&id=' + event.id);
	},

	delete_event: function (idx) {
		// delete selected event
		var self = this;
		var event = (idx == 'edit') ? this.event : this.events[idx];

		// check for active jobs first
		var jobs = find_objects(app.activeJobs, { event: event.id });
		if (jobs.length) return app.doError("Sorry, you cannot delete an event that has active jobs running.");

		var msg = "Are you sure you want to delete the event <b>" + event.title + "</b>?";

		if (event.queue && app.eventQueue[event.id]) {
			msg += "  The event's job queue will also be flushed.";
		}
		else {
			msg += "  There is no way to undo this action.";
		}

		// proceed with delete
		app.confirm('<span style="color:red">Delete Event</span>', msg, "Delete", function (result) {
			if (result) {
				app.showProgress(1.0, "Deleting Event...");
				app.api.post('app/delete_event', event, function (resp) {
					app.hideProgress();
					app.showMessage('success', "Event '" + event.title + "' was deleted successfully.");

					if (idx == 'edit') Nav.go('Schedule?sub=events');
				});
			}
		});
	},

	set_search_filters: function () {
		// grab values from search filters, and refresh
		var args = this.args;

		if (!app.filter.schedule) app.filter.schedule = {}

		args.plugin = app.filter.schedule['plugin'] = $('#fe_sch_plugin').val();
		if (!args.plugin) delete args.plugin;

		args.target = app.filter.schedule['target'] = $('#fe_sch_target').val();
		if (!args.target) delete args.target;

		args.category = app.filter.schedule['category'] = $('#fe_sch_cat').val();
		if (!args.category) delete args.category;

		let self = this;
		args.keywords = app.filter.schedule['keywords'] = $('#fe_sch_keywords').val();
		if (!args.keywords) delete args.keywords;

		args.enabled = app.filter.schedule['enabled'] = $('#fe_sch_enabled').val();
		if (args.enabled === 'chained') setTimeout(function () { self.show_graph() }, 20);
		if (!args.enabled) delete args.enabled;

		Nav.go('Schedule' + compose_query_string(args));

	},

	gosub_new_event: function (args) {
		// create new event
		var html = '';
		app.setWindowTitle("Add New Event");
		this.div.removeClass('loading');

		// this.wf = [] // wf placeholder
		// this.files = [] 
		// this.opts = {}

		html += this.getSidebarTabs('new_event',
			[
				['events', "Schedule"],
				['new_event', "Add New Event"]
			]
		);

		html += '<div style="padding:20px;"><div class="subtitle">Add New Event</div></div><div style="padding:0px 20px 50px 20px"><center><table style="margin:0;">';

		if (this.event_copy) {
			// copied from existing event
			this.event = this.event_copy;
			delete this.event_copy;
		}
		else if (config.new_event_template) {
			// app has a custom event template
			this.event = deep_copy_object(config.new_event_template);
			if (!this.event.timezone) this.event.timezone = app.tz;
		}
		else {
			// default blank event
			this.event = {
				enabled: 1,
				params: {},
				timing: { minutes: [0] },
				max_children: 1,
				timeout: 3600,
				catch_up: 0,
				timezone: app.tz
			};
		}

		html += this.get_event_edit_html();

		// buttons at bottom
		html += `
		<tr><td colspan="2" align="center">
		<div style="height:30px;"></div>
		<table><tr>
		<td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().cancel_event_edit()">Cancel</div></td>
		<td width="50">&nbsp;</td>
		<td><div class="button" style="width:120px;" onMouseUp="$P().do_new_event()"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Create Event</div></td>
		</tr></table>
		</td></tr>
		</table></center>
		</div>
		</div>
		`

		this.div.html(html);
		this.setScriptEditor()

		setTimeout(function () {
			$('#fe_ee_title').focus();
		}, 1);
	},

	cancel_event_edit: function () {
		// cancel edit, nav back to schedule
		Nav.go('Schedule');
	},

	do_random_event: function (force) {
		// create random event
		app.clearError();
		var event = this.get_random_event();
		if (!event) return; // error

		this.event = event;

		app.showProgress(1.0, "Creating event...");
		app.api.post('app/create_event', event, this.new_event_finish.bind(this));
	},

	do_new_event: function (force) {
		// create new event
		app.clearError();
		var event = this.get_event_form_json();
		if (!event) return; // error

		// pro-tip: embed id in title as bracketed prefix
		if (event.title.match(/^\[(\w+)\]\s*(.+)$/)) {
			event.id = RegExp.$1;
			event.title = RegExp.$2;
		}

		this.event = event;

		app.showProgress(1.0, "Creating event...");
		app.api.post('app/create_event', event, this.new_event_finish.bind(this));
	},

	new_event_finish: function (resp) {
		// new event created successfully
		var self = this;
		app.hideProgress();

		Nav.go('Schedule');

		setTimeout(function () {
			app.showMessage('success', "Event '" + self.event.title + "' was created successfully.");
			let el_id = app.getPref('event_view') == 'grid' || app.getPref('event_view') == 'gridall' ? 'sg_' + resp.id : resp.id
			let el = document.getElementById(el_id)
			if (el.scrollIntoViewIfNeeded) {
				el.scrollIntoViewIfNeeded()
			} else {
				el.scrollIntoView({ block: 'center' })
			}

			$('#' + el_id).addClass('focus')

		}, 150);
	},

	gosub_edit_event: function (args) {
		// edit event subpage
		var event = find_object(app.schedule, { id: args.id });
		if (!event) return app.doError("Could not locate Event with ID: " + args.id);

		// this.wf = event.workflow || []
		// this.files = event.files || []
		// this.opts = event.options || {}

		// check for autosave recovery
		// sync to 0.9.47 - disable autosave
		if (0 && app.autosave_event) {
			if (args.id == app.autosave_event.id) {
				Debug.trace("Recovering autosave data for: " + args.id);
				event = app.autosave_event;
			}
			delete app.autosave_event;
		}

		// make local copy so edits don't affect main app list until save
		this.event = deep_copy_object(event);

		var html = '';
		app.setWindowTitle("Editing Event \"" + event.title + "\"");
		this.div.removeClass('loading');

		var side_tabs = [];
		side_tabs.push(['events', "Schedule"]);
		if (app.hasPrivilege('create_events')) side_tabs.push(['new_event', "Add New Event"]);
		side_tabs.push(['edit_event', "Edit Event"]);

		html += this.getSidebarTabs('edit_event', side_tabs);

		html += `
		<div style="padding:20px;">
		<div class="subtitle">
		Editing Event &ldquo;${event.title}&rdquo;
		<div class="subtitle_widget"><a style="cursor:pointer" onclick="$P().do_copy_event()"><i class="fa fa-clone">&nbsp;</i><b>Copy</b></a></div>
		<div class="subtitle_widget" style="margin-left:5px;"><a href="#History?sub=event_history&id=${event.id}"><i class="fa fa-arrow-circle-right">&nbsp;</i><b>Jump to History</b></a></div>
		<div class="subtitle_widget"><a href="#History?sub=event_stats&id=${event.id}"><i class="fa fa-arrow-circle-right">&nbsp;</i><b>Jump to Stats</b></a></div>
		
		<div class="clear"></div>
		</div>
		</div>
		<div style="padding:0px 20px 50px 20px">
		<center>
		<table style="margin:0;">
		
		`

		// Internal ID
		if (this.isAdmin()) {
			html += get_form_table_row('Event ID', '<div style="font-size:14px;">' + event.id + '</div>');
			html += get_form_table_caption("The internal event ID used for API calls.  This cannot be changed.");
			html += '<br>'
			html += get_form_table_spacer();
		}

		html += this.get_event_edit_html();

		html += '<tr><td colspan="2" align="center"><div style="height:30px;"></div><table><tr>';

		// cancel
		html += '<td><div class="button" style="width:110px; font-weight:normal;" onMouseUp="$P().cancel_event_edit()">Cancel</div></td>';

		// delete
		if (app.hasPrivilege('delete_events')) {
			html += '<td width="30">&nbsp;</td><td><div class="button" style="width:110px; font-weight:normal;" onMouseUp="$P().delete_event(\'edit\')">Delete Event...</div></td>';
		}

		// copy
		if (app.hasPrivilege('create_events')) {
			html += '<td width="30">&nbsp;</td><td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().do_copy_event()">Copy Event...</div></td>';
		}

		// run
		if (app.hasPrivilege('run_events')) {
			html += '<td width="30">&nbsp;</td><td><div class="button" style="width:110px; font-weight:normal;" onMouseUp="$P().run_event_from_edit(event)">Run Now</div></td>';
		}

		// save
		html += `
		<td width="30">&nbsp;</td>
		<td><div class="button" style="width:130px;" onMouseUp="$P().do_save_event()"><i class="fa fa-floppy-o">&nbsp;&nbsp;</i>Save Changes</div></td>
		</tr></table>
		</td></tr>
		</table>
		</center>
		</div>
		</div>
		`

		this.div.html(html);
		this.setScriptEditor()
	},

	do_copy_event: function () {
		// make copy of event and jump into new workflow
		app.clearError();

		var event = this.get_event_form_json();
		if (!event) return; // error

		delete event.id;
		delete event.created;
		delete event.modified;
		delete event.username;
		delete event.timing;
		delete event.secret;
		delete event.secret_value;
		delete event.secret_preview;

		event.title = "Copy of " + event.title;

		this.event_copy = event;
		Nav.go('Schedule?sub=new_event');
	},

	run_event_from_edit: function (e) {
		// run event in its current (possibly edited, unsaved) state
		app.clearError();

		let event = this.get_event_form_json();
		let event_copy = JSON.parse(JSON.stringify(event));

		if (!event) return; // error

		// debug options 
		if ($("#fe_ee_debug_chain").is(":checked")) {
			event.chain = "";
			event.chain_error = "";
		}
		if ($("#fe_ee_debug_notify").is(":checked")) {
			event.notify_success = "";
			event.notify_fail = "";
			event.web_hook = "";
			event.web_hook_start = ""
		}
		event.tty = $("#fe_ee_debug_tty").is(":checked") ? 1 : 0;
		event.debug_sudo = $("#fe_ee_debug_sudo").is(":checked") && app.isAdmin() ? 1 : 0;

		this.event = event;
		this.run_event('edit', e);
		this.event = event_copy;
	},

	do_save_event: function () {
		// save changes to existing event
		app.clearError();

		this.old_event = JSON.parse(JSON.stringify(this.event));

		var event = this.get_event_form_json();
		if (!event) return; // error

		this.event = event;

		app.showProgress(1.0, "Saving event...");
		app.api.post('app/update_event', event, this.save_event_finish.bind(this));
	},

	save_event_finish: function (resp, tx) {
		// existing event saved successfully
		var self = this;
		var event = this.event;

		app.hideProgress();
		app.showMessage('success', "The event was saved successfully.");
		window.scrollTo(0, 0);

		// copy active jobs to array
		var jobs = [];
		for (var id in app.activeJobs) {
			var job = app.activeJobs[id];
			if ((job.event == event.id) && !job.detached) jobs.push(job);
		}

		// if the event was disabled and there are running jobs, ask user to abort them
		if (this.old_event.enabled && !event.enabled && jobs.length && !parseInt(event.repeat)) {
			app.confirm('<span style="color:red">Abort Jobs</span>', "There " + ((jobs.length != 1) ? 'are' : 'is') + " currently still " + jobs.length + " active " + pluralize('job', jobs.length) + " using the disabled event <b>" + event.title + "</b>.  Do you want to abort " + ((jobs.length != 1) ? 'these' : 'it') + " now?", "Abort", function (result) {
				if (result) {
					app.showProgress(1.0, "Aborting " + pluralize('Job', jobs.length) + "...");
					app.api.post('app/abort_jobs', { event: event.id }, function (resp) {
						app.hideProgress();
						if (resp.count > 0) {
							app.showMessage('success', "The " + pluralize('job', resp.count) + " " + ((resp.count != 1) ? 'were' : 'was') + " aborted successfully.");
						}
						else {
							app.showMessage('warning', "No jobs were aborted.  It is likely they completed while the dialog was up.");
						}
					});
				} // clicked Abort
			}); // app.confirm
		} // disabled + jobs
		else {
			// if certain key properties were changed and event has active jobs, ask user to update them
			var need_update = false;
			var updates = {};
			var keys = ['title', 'timeout', 'repeat', 'interval', 'enabled', 'retries', 'retry_delay', 'chain', 'chain_error', 'notify_success', 'notify_fail', 'web_hook', 'cpu_limit', 'cpu_sustain', 'memory_limit', 'memory_sustain', 'log_max_size'];

			for (var idx = 0, len = keys.length; idx < len; idx++) {
				var key = keys[idx];
				if (event[key] != this.old_event[key]) {
					updates[key] = event[key];
					need_update = true;
				}
			} // foreach key

			// recount active jobs, including detached this time
			jobs = [];
			for (var id in app.activeJobs) {
				var job = app.activeJobs[id];
				if (job.event == event.id) jobs.push(job);
			}

			if (need_update && jobs.length) {
				app.confirm('Update Jobs', "This event currently has " + jobs.length + " active " + pluralize('job', jobs.length) + ".  Do you want to update " + ((jobs.length != 1) ? 'these' : 'it') + " as well?", "Update", function (result) {
					if (result) {
						app.showProgress(1.0, "Updating " + pluralize('Job', jobs.length) + "...");
						app.api.post('app/update_jobs', { event: event.id, updates: updates }, function (resp) {
							app.hideProgress();
							if (resp.count > 0) {
								app.showMessage('success', "The " + pluralize('job', resp.count) + " " + ((resp.count != 1) ? 'were' : 'was') + " updated successfully.");
							}
							else {
								app.showMessage('warning', "No jobs were updated.  It is likely they completed while the dialog was up.");
							}
						});
					} // clicked Update
				}); // app.confirm
			} // jobs need update
		} // check for update

		delete this.old_event;
		if (event.secret_value && typeof event.secret_value === 'string') {
			delete event.secret_value
			$('#fe_ee_secret').val('').attr('placeholder', '[*****]')
		}
	},

	set_event_secret(val) { // invoked if user editing secret
		let event = this.event
		event.secret_value = val
		$('#fe_ee_secret').attr('placeholder', '')
	},

	get_event_edit_html: function () {
		// get html for editing a event (or creating a new one)
		var html = '';
		var event = this.event;

		// event title
		//let evt_tip = event.id ? "" : "pro-tip: embed id in title as bracketed prefix, e.g. [event_id] event_title"
		html += get_form_table_row('Event Name', `<input type="text" id="fe_ee_title" size="35" value="` + escape_text_field_value(event.title) + '" spellcheck="false"/>');
		html += get_form_table_caption("Enter a title for the event, which will be displayed on the main schedule.");
		html += get_form_table_spacer();

		// event enabled
		html += get_form_table_row('Schedule', '<input type="checkbox" id="fe_ee_enabled" value="1" ' + (event.enabled ? 'checked="checked"' : '') + '/><label for="fe_ee_enabled">Event Enabled</label>');
		html += get_form_table_caption("Select whether the event should be enabled or disabled in the schedule.");
		html += get_form_table_spacer();

		// category
		app.categories.sort(function (a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		});

		html += get_form_table_row('Category',
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><select id="fe_ee_cat" onMouseDown="this.options[0].disabled=true"><option value="">Select Category</option>' + render_menu_options(app.categories, event.category, false) + '</select></td>' +
			(app.isAdmin() ? '<td><span class="link addme" style="padding-left:5px; font-size:13px;" title="Add New Category" onMouseUp="$P().show_quick_add_cat_dialog()">&laquo; Add New...</span></td>' : '') +
			'</tr></table>'
		);
		html += get_form_table_caption("Select a category for the event (this may limit the max concurrent jobs, etc.)");
		html += get_form_table_spacer();

		// target (server group or individual server)
		html += get_form_table_row('Target',
			'<select id="fe_ee_target" onChange="$P().set_event_target(this.options[this.selectedIndex].value)">' + this.render_target_menu_options(event.target) + '</select>'
		);

		/*html += get_form_table_row( 'Target', 
			'<table cellspacing="0" cellpadding="0"><tr>' + 
				'<td><select id="fe_ee_target">' + this.render_target_menu_options( event.target ) + '</select></td>' + 
				'<td style="padding-left:15px;"><input type="checkbox" id="fe_ee_multiplex" value="1" ' + (event.multiplex ? 'checked="checked"' : '') + ' onChange="$P().setGroupVisible(\'mp\',this.checked).setGroupVisible(\'algo\',!this.checked)"/><label for="fe_ee_multiplex">Multiplex</label></td>' + 
			'</tr></table>' 
		);*/
		html += get_form_table_caption(
			"Select a target server group or individual server to run the event on."
			// "Multiplex means that the event will run on <b>all</b> matched servers simultaneously." 
		);
		html += get_form_table_spacer();

		// algo selection
		var algo_classes = 'algogroup';
		var target_group = !event.target || find_object(app.server_groups, { id: event.target });
		if (!target_group) algo_classes += ' collapse';

		var algo_items = [['random', "Random"], ['round_robin', "Round Robin"], ['least_cpu', "Least CPU Usage"], ['least_mem', "Least Memory Usage"], ['prefer_first', "Prefer First (Alphabetically)"], ['prefer_last', "Prefer Last (Alphabetically)"], ['multiplex', "Multiplex"]];

		html += get_form_table_row(algo_classes, 'Algorithm', '<select id="fe_ee_algo" onChange="$P().set_algo(this.options[this.selectedIndex].value)">' + render_menu_options(algo_items, event.algo, false) + '</select>');

		html += get_form_table_caption(algo_classes,
			"Select the desired algorithm for choosing a server from the target group.<br/>" +
			"'Multiplex' means that the event will run on <b>all</b> group servers simultaneously."
		);
		html += get_form_table_spacer(algo_classes, '');

		// multiplex stagger
		var mp_classes = 'mpgroup';
		if (!event.multiplex || !target_group) mp_classes += ' collapse';

		var stagger_units = 60;
		var stagger = parseInt(event.stagger || 0);
		if ((stagger >= 3600) && (stagger % 3600 == 0)) {
			// hours
			stagger_units = 3600;
			stagger = stagger / 3600;
		}
		else if ((stagger >= 60) && (stagger % 60 == 0)) {
			// minutes
			stagger_units = 60;
			stagger = Math.floor(stagger / 60);
		}
		else {
			// seconds
			stagger_units = 1;
		}

		// stagger
		html += get_form_table_row(mp_classes, 'Stagger',
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><input type="text" id="fe_ee_stagger" style="font-size:14px; width:40px;" value="' + stagger + '"/></td>' +
			'<td><select id="fe_ee_stagger_units" style="font-size:12px">' + render_menu_options([[1, 'Seconds'], [60, 'Minutes'], [3600, 'Hours']], stagger_units) + '</select></td>' +
			'</tr></table>'
		);
		html += get_form_table_caption(mp_classes,
			"For multiplexed events, optionally stagger the jobs across the servers.<br/>" +
			"Each server will delay its launch by a multiple of the specified time."
		);
		html += get_form_table_spacer(mp_classes, '');

		// plugin
		app.plugins.sort(function (a, b) {
			// return (b.title < a.title) ? 1 : -1;
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		});

		html += get_form_table_row('Plugin', '<select id="fe_ee_plugin" onMouseDown="this.options[0].disabled=true" onChange="$P().change_edit_plugin()"><option value="">Select Plugin</option>' + render_menu_options(app.plugins, event.plugin, false) + '</select>');

		// plugin params
		html += get_form_table_row('', '<div id="d_ee_plugin_params">' + this.get_plugin_params_html() + '</div>');
		html += get_form_table_spacer();

		// arguments
		let arg_title = "Argument values are available as ARG[1-9] env variable or parameter on shellplug (e.g. $ARG1 or [/ARG1])\nOn httpplug use [/params/ARG1], on event workflow JOB_ARG env variable. ARGS env variable will store entire string";
		html += get_form_table_row('Arguments', `<input title="${arg_title}" type="text" id="fe_ee_args" size="50" value="${event.args || ''}" autocomplete="one-time-code" spellcheck="false"/>`);
		html += get_form_table_caption("List of comma separated arguments. Use alphanumeric/email characters only");
		html += get_form_table_spacer();

		// timing
		var timing = event.timing;
		var tmode = '';
        
		if(parseInt(event.repeat)) tmode = 'repeat'
		else if (parseInt(event.interval) > 0) tmode = 'interval'
		else if (!timing) tmode = 'demand';
		else if (timing.years && timing.years.length) tmode = 'custom';
		else if (timing.months && timing.months.length && timing.weekdays && timing.weekdays.length) tmode = 'custom';
		else if (timing.days && timing.days.length && timing.weekdays && timing.weekdays.length) tmode = 'custom';
		else if (timing.months && timing.months.length) tmode = 'yearly';
		else if (timing.weekdays && timing.weekdays.length) tmode = 'weekly';
		else if (timing.days && timing.days.length) tmode = 'monthly';
		else if (timing.hours && timing.hours.length) tmode = 'daily';
		else if (timing.minutes && timing.minutes.length) tmode = 'hourly';
		else if (!num_keys(timing)) tmode = 'hourly';

		var timing_items = [
			['demand', 'On Demand'],
			['custom', 'Custom'],
			['yearly', 'Yearly'],
			['monthly', 'Monthly'],
			['weekly', 'Weekly'],
			['daily', 'Daily'],
			['hourly', 'Hourly'],
			['interval', 'Interval'],
			['repeat', 'Repeat']
		];

		html += get_form_table_row('Timing',
			'<div class="right">' +
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><span class="label" style="font-size:12px;">Timezone:&nbsp;</span></td>' +
			'<td><select id="fe_ee_timezone" style="max-width:150px; font-size:12px;" onChange="$P().change_timezone()">' + render_menu_options(app.zones, event.timezone || app.tz, false) + '</select></td>' +
			'</tr></table>' +
			'</div>' +

			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><select id="fe_ee_timing" onChange="$P().change_edit_timing()">' + render_menu_options(timing_items, tmode, false) + '</select></td>' +
			'<td><span class="link addme" style="padding-left:5px; font-size:13px;" title="Import from Crontab" onMouseUp="$P().show_crontab_import_dialog()">&laquo; Import...</span></td>' +
			'</tr></table>' +

			'<div class="clear"></div>'
		);

		// timing params
		this.show_all_minutes = false;

		html += get_form_table_row('', '<div id="d_ee_timing_params">' + this.get_timing_params_html(tmode) + '</div>');

		// advanced timing option 
		let time_options_exp = !!(event.ticks || event.start_time || event.end_time);
		html += get_form_table_row('', `
			<br><div style="font-size:13px; ${time_options_exp ? 'display:none;' : ''}"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Timing Options</span></div>
			<fieldset style="padding:10px 10px 0 10px; margin-bottom:5px;${time_options_exp ? '' : 'display:none;'}"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Timing Options</legend>
		     <div class="plugin_params_label">Extra Ticks: </div>
		     <div class="plugin_params_content">
		      <input type="text" id="fe_ee_ticks" size="50" value="${event.ticks || ''}" autocomplete="one-time-code" placeholder="e.g. 3PM|16:45|2020-01-01 09:30" spellcheck="false" onchange="$P().parseTicks()"/>
		      <span class="link addme" style="padding-left:4px; font-size:13px;" onMouseUp="$P().parseTicks()"> check &nbsp;&nbsp;|</span>
		      <span class="link addme" style="padding-left:0px; font-size:13px;" onMouseUp="$P().ticks_add_now()">add timestamp</span>		   
		      <div class="caption" style="margin-top:6px;">Optional extra minute ticks (extends regular schedule). Separate by comma or pipe.<br> Use HH:mm fromat for daily recurring or YYYY-MM-DD HH:mm for onetime ticks</div>
		     <div style="padding: 5px 0px 0px 5px;"><span style="color: green" id="fe_ee_parsed_ticks"/></div>
		    </div>			
			<div class="plugin_params_label">Start/Resume at</div>
			<div class="plugin_params_content">
			  <input id="event_starttime" type="text" autocomplete="one-time-code" placeholder="(now)" >
			</div>
			
			<div class="plugin_params_label">Stop/Suspend at</div>
			<div class="plugin_params_content"><input autocomplete="one-time-code" placeholder="(never)" id="event_endtime" type="text"></div>
			</fieldset>
			<script>$P().render_time_options()</script>
		`
		);
		html += get_form_table_spacer();

		// show token (admin only) 
		if (app.user.privileges.admin && event.id) {
			html += get_form_table_row('Allow Token', `
							<input type="checkbox" id="fe_ee_token" value="1" ${(event.salt ? 'checked="checked"' : '')} onclick="$P().toggle_token()"/>
							  <label id="fe_ee_token_label" for="fe_ee_token">generate event webhook</label><span style="font-size: 1em" id="fe_ee_token_val"></span>
							</input><script>$P().toggle_token()</script>
							`);
			html += get_form_table_caption("Allow invoking this event via token");
			html += get_form_table_spacer();
		}

		// Secret
		let sph = event.secret_preview ? '[' + event.secret_preview + ']' : '';
		html += get_form_table_row('Secret', `<textarea  style="width:620px; height:45px;resize:vertical;" id="fe_ee_secret" oninput="$P().set_event_secret(this.value)" placeholder="${sph}" spellcheck="false"></textarea>`);
		html += get_form_table_caption("Specify KEY=VALUE pairs to set ENV variables. Some plugins require KEY prefix (e.g. DOCKER_ or SSH_ ) to pass it to job runtime.");
		html += get_form_table_spacer();

		// max children
		html += get_form_table_row('Concurrency', '<select id="fe_ee_max_children">' + render_menu_options([[1, "1 (Singleton)"], 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], event.max_children, false) + '</select>');
		html += get_form_table_caption("Select the maximum number of jobs that can run simultaneously.");
		html += get_form_table_spacer();

		// timeout
		html += get_form_table_row('Timeout', this.get_relative_time_combo_box('fe_ee_timeout', event.timeout));
		html += get_form_table_caption("Enter the maximum time allowed for jobs to complete, 0 to disable.");
		html += get_form_table_spacer();

		// retries
		html += get_form_table_row('Retries',
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><select id="fe_ee_retries" onChange="$P().change_retry_amount()">' + render_menu_options([[0, 'None'], 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], event.retries, false) + '</select></td>' +
			'<td id="td_ee_retry1" ' + (event.retries ? '' : 'style="display:none"') + '><span style="padding-left:15px; font-size:13px; color:#777;"><b>Delay:</b>&nbsp;</span></td>' +
			'<td id="td_ee_retry2" ' + (event.retries ? '' : 'style="display:none"') + '>' + this.get_relative_time_combo_box('fe_ee_retry_delay', event.retry_delay, '', true) + '</td>' +
			'</tr></table>'
		);
		html += get_form_table_caption("Select the number of retries to be attempted before an error is reported.");
		html += get_form_table_spacer();

		// log expiration
		html += get_form_table_row('Log Expires',
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><select id="fe_ee_expire_days" onChange="">' + render_menu_options([[0, 'Default'], 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31], event.log_expire_days, false) + '</select></td>' +
			'</tr></table>'
		);
		html += get_form_table_caption("Number of days to keep job logs in storage (alters job_data_expire_days config)");
		html += get_form_table_spacer();

		// catch-up mode (run all)
		// method (interruptable, non-interruptable)
		html += get_form_table_row('Misc. Options',
			'<div><input type="checkbox" id="fe_ee_catch_up" value="1" ' + (event.catch_up ? 'checked="checked"' : '') + ' ' + (event.id ? 'onChange="$P().setGroupVisible(\'rc\',this.checked)"' : '') + ' /><label for="fe_ee_catch_up">Catch-Up (Run All)</label></div>' +
			'<div class="caption">Automatically run all missed events after server downtime or scheduler/event disabled.</div>' +

			'<div style="margin-top:10px"><input type="checkbox" id="fe_ee_detached" value="1" ' + (event.detached ? 'checked="checked"' : '') + '/><label for="fe_ee_detached">Detached (Uninterruptible)</label></div>' +
			'<div class="caption">Run event as a detached background process that is never interrupted.</div>' +

			'<div style="margin-top:10px"><input type="checkbox" id="fe_ee_queue" value="1" ' + (event.queue ? 'checked="checked"' : '') + ' onChange="$P().setGroupVisible(\'eq\',this.checked)"/><label for="fe_ee_queue">Allow Queued Jobs</label></div>' +
			'<div class="caption">Jobs that cannot run immediately will be queued.</div>' +

			'<div style="margin-top:10px"><input type="checkbox" id="fe_ee_silent" value="1" ' + (event.silent ? 'checked="checked"' : '') + '/><label for="fe_ee_silent">Silent</label>' +
			'<div class="caption">Hide job from common reporting (for maintenance/debug).</div>' +

			'<div style="margin-top:10px"><input type="checkbox" id="fe_ee_concurrent_arg" value="1" ' + (event.concurrent_arg ? 'checked="checked"' : '') + '/><label for="fe_ee_concurrent_arg">Argument Concurrency</label>' +
			'<div class="caption">Apply concurrency setting to event/argument combination, allowing concurrent job for each distinct argument passed by WF.</div>'

		);
		html += get_form_table_spacer();

		// reset cursor (only for catch_up and edit mode)
		var rc_epoch = normalize_time(time_now(), { sec: 0 });
		if (event.id && app.state && app.state.cursors && app.state.cursors[event.id]) {
			rc_epoch = app.state.cursors[event.id];
		}

		var rc_classes = 'rcgroup';
		if (!event.catch_up || !event.id) rc_classes += ' collapse';

		html += get_form_table_row(rc_classes, 'Time Machine',
			'<table cellspacing="0" cellpadding="0"><tr>' +
			'<td><input type="checkbox" id="fe_ee_rc_enabled" value="1" onChange="$P().toggle_rc_textfield(this.checked)"/></td><td><label for="fe_ee_rc_enabled">Set Event Clock:</label>&nbsp;</td>' +
			'<td><input type="text" id="fe_ee_rc_time" style="font-size:13px; width:180px;" disabled="disabled" value="' + $P().rc_get_short_date_time(rc_epoch) + '" data-epoch="' + rc_epoch + '" onFocus="this.blur()" onMouseUp="$P().rc_click()"/></td>' +
			'<td><span id="s_ee_rc_reset" class="link addme" style="opacity:0" onMouseUp="$P().reset_rc_time_now()">&laquo; Reset</span></td>' +
			'</tr></table>'
		);
		html += get_form_table_caption(rc_classes,
			"Optionally reset the internal clock for this event, to repeat past jobs, or jump over a queue."
		);
		html += get_form_table_spacer(rc_classes, '');

		// event queue max
		var eq_classes = 'eqgroup';
		if (!event.queue) eq_classes += ' collapse';

		html += get_form_table_row(eq_classes, 'Queue Limit',
			'<input type="text" id="fe_ee_queue_max" size="8" value="' + escape_text_field_value(event.queue_max || 0) + '" spellcheck="false"/>'
		);
		html += get_form_table_caption(eq_classes,
			"Set the maximum number of jobs that can be queued up for this event (or '0' for no limit)."
		);
		html += get_form_table_spacer(eq_classes, '');

		// chain reaction
		var sorted_events = app.schedule.sort(function (a, b) {
			return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
		});

		var chain_expanded = !!(event.chain || event.chain_error);
		html += get_form_table_row('Chain Reaction',
			'<div style="font-size:13px;' + (chain_expanded ? 'display:none;' : '') + '"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Chain Options</span></div>' +
			'<fieldset style="padding:10px 10px 0 10px; margin-bottom:5px;' + (chain_expanded ? '' : 'display:none;') + '"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Chain Options</legend>' +
			'<div class="plugin_params_label">Run Event on Success:</div>' +
			'<div class="plugin_params_content"><select id="fe_ee_chain" style="margin-left:10px; font-size:12px;"><option value="">(None)</option>' + render_menu_options(sorted_events, event.chain, false) + '</select></div>' +

			'<div class="plugin_params_label">Run Event on Failure:</div>' +
			'<div class="plugin_params_content"><select id="fe_ee_chain_error" style="margin-left:10px; font-size:12px;"><option value="">(None)</option>' + render_menu_options(sorted_events, event.chain_error, false) + '</select></div>' +

			'</fieldset>'
		);
		html += get_form_table_caption("Select events to run automatically after this event completes.");
		html += get_form_table_spacer();

		// notification
		var notif_expanded = !!(event.notify_success || event.notify_fail || event.web_hook || event.web_hook_start);
		html += get_form_table_row('Notification',
			'<div style="font-size:13px;' + (notif_expanded ? 'display:none;' : '') + '"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Notification Options</span></div>' +
			'<fieldset style="padding:10px 10px 0 10px; margin-bottom:5px;' + (notif_expanded ? '' : 'display:none;') + '"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Notification Options</legend>' +
			'<div class="plugin_params_label">Email on Success:</div>' +
			'<div class="plugin_params_content"><input type="text" id="fe_ee_notify_success" size="50" value="' + escape_text_field_value(event.notify_success) + '" placeholder="email@sample.com" spellcheck="false" onChange="$P().update_add_remove_me($(this))"/><span class="link addme" onMouseUp="$P().add_remove_me($(this).prev())"></span></div>' +

			'<div class="plugin_params_label">Email on Failure:</div>' +
			'<div class="plugin_params_content"><input type="text" id="fe_ee_notify_fail" size="50" value="' + escape_text_field_value(event.notify_fail) + '" placeholder="email@sample.com" spellcheck="false" onChange="$P().update_add_remove_me($(this))"/><span class="link addme" onMouseUp="$P().add_remove_me($(this).prev())"></span></div>' +

			'<div class="plugin_params_label">Web Hook URL (start):</div>' +
			'<div class="plugin_params_content"><input type="text" id="fe_ee_web_hook_start" size="60" value="' + escape_text_field_value(event.web_hook_start) + '" placeholder="http://" spellcheck="false"/></div>' +
			'<div class="plugin_params_label">Web Hook URL (complete):</div>' +
			'<div class="plugin_params_content"><input type="text" id="fe_ee_web_hook" size="60" value="' + escape_text_field_value(event.web_hook) + '" placeholder="http://" spellcheck="false"/></div>' +
			'<div style="margin-top:10px"><input type="checkbox" id="fe_ee_web_hook_error" value="1" ' + (event.web_hook_error ? 'checked="checked"' : '') + '/><label for="fe_ee_web_hook_error">fire webhook on failure only</label>' +
			'<div><br></div>' +

			'</fieldset>'
		);
		html += get_form_table_caption("Enter one or more e-mail addresses for notification (comma-separated), and optionally a web hook URL.");
		html += get_form_table_spacer();

		// resource limits
		var res_expanded = !!(event.memory_limit || event.memory_sustain || event.cpu_limit || event.cpu_sustain || event.log_max_size);
		html += get_form_table_row('Limits',
			'<div style="font-size:13px;' + (res_expanded ? 'display:none;' : '') + '"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Resource Limits</span></div>' +
			'<fieldset style="padding:10px 10px 0 10px; margin-bottom:5px;' + (res_expanded ? '' : 'display:none;') + '"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Resource Limits</legend>' +

			'<div class="plugin_params_label">CPU Limit:</div>' +
			'<div class="plugin_params_content"><table cellspacing="0" cellpadding="0" class="fieldset_params_table"><tr>' +
			'<td style="padding-right:2px"><input type="checkbox" id="fe_ee_cpu_enabled" value="1" ' + (event.cpu_limit ? 'checked="checked"' : '') + ' /></td>' +
			'<td><label for="fe_ee_cpu_enabled">Abort job if CPU exceeds</label></td>' +
			'<td><input type="text" id="fe_ee_cpu_limit" style="width:30px;" value="' + (event.cpu_limit || 0) + '"/>%</td>' +
			'<td>for</td>' +
			'<td>' + this.get_relative_time_combo_box('fe_ee_cpu_sustain', event.cpu_sustain, 'fieldset_params_table') + '</td>' +
			'</tr></table></div>' +

			'<div class="plugin_params_label">Memory Limit:</div>' +
			'<div class="plugin_params_content"><table cellspacing="0" cellpadding="0" class="fieldset_params_table"><tr>' +
			'<td style="padding-right:2px"><input type="checkbox" id="fe_ee_memory_enabled" value="1" ' + (event.memory_limit ? 'checked="checked"' : '') + ' /></td>' +
			'<td><label for="fe_ee_memory_enabled">Abort job if memory exceeds</label></td>' +
			'<td>' + this.get_relative_size_combo_box('fe_ee_memory_limit', event.memory_limit, 'fieldset_params_table') + '</td>' +
			'<td>for</td>' +
			'<td>' + this.get_relative_time_combo_box('fe_ee_memory_sustain', event.memory_sustain, 'fieldset_params_table') + '</td>' +
			'</tr></table></div>' +

			'<div class="plugin_params_label">Log Size Limit:</div>' +
			'<div class="plugin_params_content"><table cellspacing="0" cellpadding="0" class="fieldset_params_table"><tr>' +
			'<td style="padding-right:2px"><input type="checkbox" id="fe_ee_log_enabled" value="1" ' + (event.log_max_size ? 'checked="checked"' : '') + ' /></td>' +
			'<td><label for="fe_ee_log_enabled">Abort job if log file exceeds</label></td>' +
			'<td>' + this.get_relative_size_combo_box('fe_ee_log_limit', event.log_max_size, 'fieldset_params_table') + '</td>' +
			'</tr></table></div>' +

			'</fieldset>'
		);
		html += get_form_table_caption(
			"Optionally set CPU load, memory usage and log size limits for the event."
		);
		html += get_form_table_spacer();

		// graph icon
		let giTitle = "Specify the hex code of fontAwsome or Unicode character. The default value is F111 (FA circle)"
		let giLabel = `<label for="fe_ee_graph_icon"><i style="font-family: FontAwesome; font-style: normal;  font-weight: 900; vertical-align: middle" onclick="$P().show_graph()" id="fe_ee_graph_icon_label"/></label>`
		html += get_form_table_row('Graph Icon', `<input id="fe_ee_graph_icon" oninput="$P().update_graph_icon_label()" size=5 title="${giTitle}" value="${event.graph_icon || ''}"/>${giLabel}`);
		html += get_form_table_caption("hex code");
		html += '<script>$P().update_graph_icon_label()</script>'
		html += get_form_table_spacer();

		// notes
		html += get_form_table_row('Notes', '<textarea id="fe_ee_notes" style="width:600px; height:80px; resize:vertical;">' + escape_text_field_value(event.notes) + '</textarea>');
		html += get_form_table_caption("Optionally enter notes for the event, which will be included in all e-mail notifications.");
		html += get_form_table_spacer();

		// debugging options (avoid emails/webhooks/history), existing events only
		if (event.id) {
			let sudo = app.isAdmin() ? '<input type="checkbox" id="fe_ee_debug_sudo" class="debug_options" value="1"><label for="fe_ee_debug_sudo" title="This will ignore plugin UID setting and run the job using main process UID"> Sudo </label><br>' : "";
			let ttyTitle = "This option let you capture colorized terminal output using /usr/bin/script tool (typically in the box, on alpine install util-linux). Please note - it will supress stdin/stderr sent to/from job and will also hang on interactive prompts"
			html += get_form_table_row('Debug Opts', `				
				  <input type="checkbox" id="fe_ee_debug_chain"  value="1"><label for="fe_ee_debug_chain"> Omit chaining</label><br>
				  <input type="checkbox" id="fe_ee_debug_notify"  value="1"><label for="fe_ee_debug_notify"> Omit notification </label><br>
				  <input type="checkbox" id="fe_ee_debug_tty" value="1"><label for="fe_ee_debug_tty" title="${ttyTitle}"> Use terminal emulator</label><br>
				  ${sudo}
				  `);
			html += get_form_table_caption("Debugging options. Applies only to manual execution (not stored with event)");
			html += get_form_table_spacer();
		} //


		setTimeout(function () {
			$P().update_add_remove_me($('#fe_ee_notify_success, #fe_ee_notify_fail'));
		}, 1);

		return html;
	},

	set_event_target: function (target) {
		// event target has changed (from menu selection)
		// hide / show sections as necessary
		var target_group = find_object(app.server_groups, { id: target });
		var algo = $('#fe_ee_algo').val();

		this.setGroupVisible('algo', !!target_group);
		this.setGroupVisible('mp', !!target_group && (algo == 'multiplex'));
	},

	set_algo: function (algo) {
		// target server algo has changed
		// hide / show multiplex stagger as necessary
		this.setGroupVisible('mp', (algo == 'multiplex'));
	},

	change_retry_amount: function () {
		// user has selected a retry amount from the menu
		// adjust the visibility of the retry delay controls accordingly
		var retries = parseInt($('#fe_ee_retries').val());
		if (retries) {
			if (!$('#td_ee_retry1').hasClass('yup')) {
				$('#td_ee_retry1, #td_ee_retry2').css({ display: 'table-cell', opacity: 0 }).fadeTo(250, 1.0, function () {
					$(this).addClass('yup');
				});
			}
		}
		else {
			$('#td_ee_retry1, #td_ee_retry2').fadeTo(250, 0.0, function () {
				$(this).css({ display: 'none', opacity: 0 }).removeClass('yup');
			});
		}
	},

	show_crontab_import_dialog: function () {
		// allow user to paste in crontab syntax to set timing
		var self = this;
		var html = '';

		html += '<div style="font-size:12px; color:#777; margin-bottom:20px;">Use this to import event timing settings from a <a href="https://en.wikipedia.org/wiki/Cron#CRON_expression" target="_blank">Crontab expression</a>.  This is a string comprising five (or six) fields separated by white space that represents a set of dates/times.  Example: <b>30 4 1 * *</b> (First day of every month at 4:30 AM)</div>';

		html += '<center><table>' +
			// get_form_table_spacer() + 
			get_form_table_row('Crontab:', '<input type="text" id="fe_ee_crontab" style="width:330px;" value="" spellcheck="false"/>') +
			get_form_table_caption("Enter your crontab date/time expression here.") +
			'</table></center>';

		app.confirm('<i class="fa fa-clock-o">&nbsp;</i>Import from Crontab', html, "Import", function (result) {
			app.clearError();

			if (result) {
				var cron_exp = $('#fe_ee_crontab').val().toLowerCase();
				if (!cron_exp) return app.badField('fe_ee_crontab', "Please enter a crontab date/time expression.");

				// validate, convert to timing object
				var timing = null;
				try {
					timing = parse_crontab(cron_exp, $('#fe_ee_title').val());
				}
				catch (e) {
					return app.badField('fe_ee_crontab', e.toString());
				}

				// hide dialog
				Dialog.hide();

				// replace event timing object
				self.event.timing = timing;

				// redraw display
				var tmode = '';
				if(parseInt(self.event.repeat) > 0) tmode = 'repeat'
				else if (parseInt(self.event.interval) > 0) tmode = 'interval';
				else if (timing.years && timing.years.length) tmode = 'custom';
				else if (timing.months && timing.months.length && timing.weekdays && timing.weekdays.length) tmode = 'custom';
				else if (timing.days && timing.days.length && timing.weekdays && timing.weekdays.length) tmode = 'custom';
				else if (timing.months && timing.months.length) tmode = 'yearly';
				else if (timing.weekdays && timing.weekdays.length) tmode = 'weekly';
				else if (timing.days && timing.days.length) tmode = 'monthly';
				else if (timing.hours && timing.hours.length) tmode = 'daily';
				else if (timing.minutes && timing.minutes.length) tmode = 'hourly';
				else if (!num_keys(timing)) tmode = 'hourly';

				$('#fe_ee_timing').val(tmode);
				$('#d_ee_timing_params').html(self.get_timing_params_html(tmode));

				// and we're done
				app.showMessage('success', "Crontab date/time expression was imported successfully.");

			} // user clicked add
		}); // app.confirm

		setTimeout(function () {
			$('#fe_ee_crontab').focus();
		}, 1);
	},

	show_quick_add_cat_dialog: function () {
		// allow user to quickly add a category
		var self = this;
		var html = '';

		html += '<div style="font-size:12px; color:#777; margin-bottom:20px;">Use this to quickly add a new category.  Note that you should visit the Admin Categories page later so you can set additional options, add a descripton, etc.</div>';

		html += '<center><table>' +
			// get_form_table_spacer() + 
			get_form_table_row('Category Title:', '<input type="text" id="fe_ee_cat_title" style="width:315px" value=""/>') +
			get_form_table_caption("Enter a title for your category here.") +
			'</table></center>';

		app.confirm('<i class="fa fa-folder-open-o">&nbsp;</i>Quick Add Category', html, "Add", function (result) {
			app.clearError();

			if (result) {
				var cat_title = $('#fe_ee_cat_title').val();
				if (!cat_title) return app.badField('fe_ee_cat_title', "Please enter a title for the category.");
				Dialog.hide();

				var category = {};
				category.title = cat_title;
				category.description = '';
				category.max_children = 0;
				category.notify_success = '';
				category.notify_fail = '';
				category.web_hook = '';
				category.enabled = 1;
				let baseColors = ["#5dade2 ", "#ec7063 ", "#58d68d", "#f4d03f", , "#af7ac5", "#dc7633", "#99a3a4", " #45b39d", "#a93226"]

				category.gcolor = baseColors[(app.categories || []).length % 7];

				app.showProgress(1.0, "Adding category...");
				app.api.post('app/create_category', category, function (resp) {
					app.hideProgress();
					app.showMessage('success', "Category was added successfully.");

					// set event to new category
					category.id = resp.id;
					self.event.category = category.id;

					// due to race conditions with websocket, app.categories may or may not have our new cat at this point
					// so add it manually if needed
					if (!find_object(app.categories, { id: category.id })) {
						app.categories.push(category);
					}

					// resort cats for menu rebuild
					app.categories.sort(function (a, b) {
						// return (b.title < a.title) ? 1 : -1;
						return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
					});

					// rebuild menu and select new cat
					$('#fe_ee_cat').html(
						'<option value="" disabled="disabled">Select Category</option>' +
						render_menu_options(app.categories, self.event.category, false)
					);
				}); // api.post

			} // user clicked add
		}); // app.confirm

		setTimeout(function () {
			$('#fe_ee_cat_title').focus();
		}, 1);
	},

	rc_get_short_date_time: function (epoch, includeWeekDay) {
		// get short date/time with tz abbrev using moment
		var tz = this.event.timezone || app.tz;
		// return moment.tz( epoch * 1000, tz).format("MMM D, YYYY h:mm A z");
		let ddd = includeWeekDay ? 'ddd ' : '';
		let hhFormat = app.hh24 ? 'yyyy-MM-DD HH:mm' : 'lll'
		return moment.tz(epoch * 1000, tz).format(`${ddd}${hhFormat} z`);
	},

	rc_click: function () {
		// click in 'reset cursor' text field, popup edit dialog
		var self = this;
		$('#fe_ee_rc_time').blur();

		if ($('#fe_ee_rc_enabled').is(':checked')) {
			var epoch = parseInt($('#fe_ee_rc_time').data('epoch'));

			this.choose_date_time({
				when: epoch,
				title: "Set Event Clock",
				timezone: this.event.timezone || app.tz,

				callback: function (rc_epoch) {
					$('#fe_ee_rc_time').data('epoch', rc_epoch).val(self.rc_get_short_date_time(rc_epoch));
					$('#fe_ee_rc_time').blur();
				}
			});
		}
	},

	set_interval_start: function () {
		// click in 'reset cursor' text field, popup edit dialog
		const self = this;
		const event = this.event;

		// if ($('#fe_ee_rc_enabled').is(':checked')) {
		var epoch = parseInt(event.interval_start || 0);

		this.choose_date_time({
			when: epoch,
			title: "Set Interval Start",
			timezone: this.event.timezone || app.tz,

			callback: function (int_epoch) {
				event.interval_start = int_epoch
				$('#fe_ee_interval_start').data('epoch', int_epoch).val(self.rc_get_short_date_time(int_epoch));
			}
		});
		// }
	},

	reset_rc_time_now: function () {
		// reset cursor value to now, from click
		var rc_epoch = normalize_time(time_now(), { sec: 0 });
		$('#fe_ee_rc_time').data('epoch', rc_epoch).val(this.rc_get_short_date_time(rc_epoch));
	},

	update_rc_value: function () {
		// received state update from server, event cursor may have changed
		// only update field if in edit mode, catch_up, and field is disabled
		var event = this.event;

		if (event.id && $('#fe_ee_catch_up').is(':checked') && !$('#fe_ee_rc_enabled').is(':checked') && app.state && app.state.cursors && app.state.cursors[event.id]) {
			$('#fe_ee_rc_time').data('epoch', app.state.cursors[event.id]).val(this.rc_get_short_date_time(app.state.cursors[event.id]));
		}
	},

	toggle_rc_textfield: function (state) {
		// set 'disabled' attribute of 'reset cursor' text field, based on checkbox
		var event = this.event;

		if (state) {
			$('#fe_ee_rc_time').removeAttr('disabled').css('cursor', 'pointer');
			$('#s_ee_rc_reset').fadeTo(250, 1.0);
		}
		else {
			$('#fe_ee_rc_time').attr('disabled', 'disabled').css('cursor', 'default');
			$('#s_ee_rc_reset').fadeTo(250, 0.0);

			// reset value just in case it changed while field was enabled
			if (event.id && app.state && app.state.cursors && app.state.cursors[event.id]) {
				$('#fe_ee_rc_time').data('epoch', app.state.cursors[event.id]).val(this.rc_get_short_date_time(app.state.cursors[event.id]));
			}
		}
	},

	change_timezone: function () {
		// change timezone setting
		var event = this.event;

		// update 'reset cursor' text field to reflect new timezone
		var new_cursor = parseInt($('#fe_ee_rc_time').data('epoch'));
		if (!new_cursor || isNaN(new_cursor)) {
			new_cursor = app.state.cursors[event.id] || normalize_time(time_now(), { sec: 0 });
		}
		new_cursor = normalize_time(new_cursor, { sec: 0 });

		// update timezone
		event.timezone = $('#fe_ee_timezone').val();
		this.change_edit_timing_param();

		// render out new RC date/time
		$('#fe_ee_rc_time').data('epoch', new_cursor).val(this.rc_get_short_date_time(new_cursor));
	},

	parseTicks: function () {
		let tickString = $("#fe_ee_ticks").val()
		if (tickString) {
			let parsed = tickString.trim().replace(/\s+/g, ' ').split(/[\,\|]/).map(e => {
				let format = e.trim().length > 8 ? 'YYYY-MM-DD HH:mm A' : 'HH:mm A';
				let t = moment(e, format);
				return t._isValid ? t.format(e.trim().length > 8 ? 'YYYY-MM-DD HH:mm' : 'HH:mm') : null;
			}).filter(e => e).join(" | ")
			$("#fe_ee_parsed_ticks").text(' parsed ticks: ' + parsed);
		} else {
			$("#fe_ee_parsed_ticks").text('');
		}
	},

	ticks_add_now: function () {
		let currTicks = $("#fe_ee_ticks").val()
		let tme = moment().add(1, 'minute').format('YYYY-MM-DD HH:mm')
		if (currTicks.trim()) {
			$("#fe_ee_ticks").val(currTicks + ', ' + tme);
		}
		else { $("#fe_ee_ticks").val(tme) }
		this.parseTicks();
	},

	change_edit_timing: function () {
		// change edit timing mode
		var event = this.event;
		var timing = event.timing;
		var tmode = $('#fe_ee_timing').val();
		var dargs = get_date_args(time_now());

		// clean up timing object, add sane defaults for the new tmode
		switch (tmode) {
			case 'demand':
				timing = false;
				event.timing = false;
				break;

			case 'interval':
				timing = false;
				event.timing = false;
				event.repeat = false;
				break;

			case 'repeat':
				timing = false;
				event.timing = false;
				event.interval = false;
				event.interval_start = false;
				break;

			case 'custom':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				break;

			case 'yearly':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				delete timing.years;
				if (!timing.months) timing.months = [];
				if (!timing.months.length) timing.months.push(dargs.mon);

				if (!timing.days) timing.days = [];
				if (!timing.days.length) timing.days.push(dargs.mday);

				if (!timing.hours) timing.hours = [];
				if (!timing.hours.length) timing.hours.push(dargs.hour);
				break;

			case 'weekly':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				delete timing.years;
				delete timing.months;
				delete timing.days;
				if (!timing.weekdays) timing.weekdays = [];
				if (!timing.weekdays.length) timing.weekdays.push(dargs.wday);

				if (!timing.hours) timing.hours = [];
				if (!timing.hours.length) timing.hours.push(dargs.hour);
				break;

			case 'monthly':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				delete timing.years;
				delete timing.months;
				delete timing.weekdays;
				if (!timing.days) timing.days = [];
				if (!timing.days.length) timing.days.push(dargs.mday);

				if (!timing.hours) timing.hours = [];
				if (!timing.hours.length) timing.hours.push(dargs.hour);
				break;

			case 'daily':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				delete timing.years;
				delete timing.months;
				delete timing.weekdays;
				delete timing.days;
				if (!timing.hours) timing.hours = [];
				if (!timing.hours.length) timing.hours.push(dargs.hour);
				break;

			case 'hourly':
				if (!timing) timing = event.timing = {};
				event.interval = false;
				event.interval_start = false;
				event.repeat = false;
				delete timing.years;
				delete timing.months;
				delete timing.weekdays;
				delete timing.days;
				delete timing.hours;
				break;
		}

		if (timing) {
			if (!timing.minutes) timing.minutes = [];
			if (!timing.minutes.length) timing.minutes.push(0);
			event.interval = false;
			event.interval_start = false;
			event.repeat = false;
		}

		$('#d_ee_timing_params').html(this.get_timing_params_html(tmode));
	},

	get_timing_params_html: function (tmode) {
		// get timing param editor html
		var html = '';
		var event = this.event;
		var timing = event.timing;

		html += '<div style="font-size:13px; margin-top:7px; display:none;"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Timing Details</span></div>';
		html += '<fieldset style="margin-top:7px; padding:10px 10px 0 10px; width:55rem;"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Timing Details</legend>';

		// html += '<fieldset style="margin-top:7px; padding:10px 10px 0 10px; max-width:600px;"><legend>Timing Details</legend>';

		// only show years in custom mode
		if (tmode == 'custom') {
			html += '<div class="timing_details_label">Years</div>';
			var year = (new Date()).getFullYear();
			html += '<div class="timing_details_content">' + this.get_timing_checkbox_set('year', [year, year + 1, year + 2, year + 3, year + 4, year + 5, year + 6, year + 7, year + 8, year + 9, year + 10], timing.years || [], true) + '</div>';
		} // years

		if (tmode == 'interval') {
			// html += '<div class="timing_details_label">Interval</div>';
			html += '<div class="timing_details_content">'
			let intSelect = this.get_relative_time_combo_box('fe_ee_interval', (parseInt(event.interval) || 60 * 10));
			let intStart = event.interval_start ? $P().rc_get_short_date_time(event.interval_start, true) : 'epoch'
			html += `<table cellspacing="0" cellpadding="0"><tr>
			<td><label>Every: </label><td style="padding:12px"> ${intSelect} </td></td><td style="padding:12px"><label> Starting From: </label>&nbsp;</td>
			<td><input type="text" id="fe_ee_interval_start" style="font-size:13px; width:200px;" value="${intStart}" onclick="$P().set_interval_start()"/></td>
			<td></td>
			</tr></table>
			</div>`
		} // interval

		if (tmode == 'repeat') {
			// html += '<div class="timing_details_label">Interval</div>';
			html += '<div class="timing_details_content">'
			let repeatSelect = this.get_relative_time_combo_box('fe_ee_repeat', (parseInt(event.repeat) || 30), null, true);
			html += `<table cellspacing="0" cellpadding="0"><tr>
			<td><label>Repeat event every: </label><td style="padding:12px"> ${repeatSelect} </td></td>
			<td></td>
			</tr></table>
			</div>`
		} // interval

		if (tmode.match(/(custom|yearly)/)) {
			// show months
			html += '<div class="timing_details_label">Months</div>';
			html += '<div class="timing_details_content">' + this.get_timing_checkbox_set('month', _months, timing.months || []) + '</div>';
		} // months

		if (tmode.match(/(custom|weekly)/)) {
			// show weekdays
			var wday_items = [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'],
			[4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']];

			html += '<div class="timing_details_label">Weekdays</div>';
			html += '<div class="timing_details_content">' + this.get_timing_checkbox_set('weekday', wday_items, timing.weekdays || []) + '</div>';
		} // weekdays

		if (tmode.match(/(custom|yearly|monthly)/)) {
			// show days of month
			var mday_items = [];
			for (var idx = 1; idx < 32; idx++) {
				var num_str = '' + idx;
				var num_label = num_str + _number_suffixes[parseInt(num_str.substring(num_str.length - 1))];
				mday_items.push([idx, num_label]);
			}

			html += '<div class="timing_details_label">Days of the Month</div>';
			html += '<div class="timing_details_content">' + this.get_timing_checkbox_set('day', mday_items, timing.days || []) + '</div>';
		} // days

		if (tmode.match(/(custom|yearly|monthly|weekly|daily)/)) {
			// show hours
			var hour_items = [];
			for (var idx = 0; idx < 24; idx++) {
				hour_items.push([idx, _hour_names[idx].toUpperCase()]);
			}

			html += '<div class="timing_details_label">Hours</div>';
			html += '<div class="timing_details_content">' + this.get_timing_checkbox_set('hour', hour_items, timing.hours || []) + '</div>';
		} // hours

		// always show minutes (if timing is enabled)
		if (timing) {
			var min_items = [];
			for (var idx = 0; idx < 60; idx += this.show_all_minutes ? 1 : 5) {
				var num_str = ':' + ((idx < 10) ? '0' : '') + idx;
				min_items.push([idx, num_str, (idx % 5 == 0) ? '' : 'plain']);
			} // minutes

			html += '<div class="timing_details_label">Minutes';
			html += ' <span class="link" style="font-weight:normal; font-size:11px" onMouseUp="$P().toggle_show_all_minutes()">(' + (this.show_all_minutes ? 'Show Less' : 'Show All') + ')</span>';
			html += '</div>';

			html += '<div class="timing_details_content">';
			html += this.get_timing_checkbox_set('minute', min_items, timing.minutes || [], function (idx) {
				var num_str = ':' + ((idx < 10) ? '0' : '') + idx;
				return ([idx, num_str, (idx % 5 == 0) ? '' : 'plain']);
			});
			html += '</div>';
		}

		// summary (for non-interval)
		if (tmode !== 'interval' && tmode !== 'repeat') {
			html += '<div class="info_label">The event will run:</div>';
			html += '<div class="info_value" id="d_ee_timing_summary">' + summarize_event_timing(timing, event.timezone).replace(/(every\s+minute)/i, '<span style="color:red">$1</span>');
			// add event webhook info if "On demand" is selected
			let base_path = (/^\/\w+$/i).test(config.base_path) ? config.base_path : ''
			let apiUrl = base_path + '/api/app/run_event?id=' + (event.id || 'eventId') + '&post_data=1&api_key=API_KEY'
			let webhookInfo = !timing ? '<br><span title="Use this Url to trigger event via webhook. API_KEY with [Run Events] privelege should be created by admin user. If using Gitlab webhook - api_key can be also set via SECRET parameter"> <br>[webhook] </span>' + window.location.origin + apiUrl : ' '
			html += webhookInfo + '</div>';
		}

		html += '</fieldset>';
		html += '<div class="caption" style="margin-top:6px;">Choose when and how often the event should run.</div>';

		setTimeout(function () {
			$('.ccbox_timing').mouseup(function () {
				// need another delay for event listener race condition
				// we want this to happen LAST, after the CSS classes are updated
				setTimeout(function () {
					$P().change_edit_timing_param();
				}, 1);
			});
		}, 1);

		return html;
	},

	toggle_show_all_minutes: function () {
		// toggle showing every minutes from 0 - 59, to just the 5s
		this.show_all_minutes = !this.show_all_minutes;
		var tmode = $('#fe_ee_timing').val();
		$('#d_ee_timing_params').html(this.get_timing_params_html(tmode));
	},

	change_edit_timing_param: function () {
		// edit timing param has changed, refresh entire timing block
		// rebuild entire event.timing object from scratch
		var event = this.event;
		event.timing = {};
		var timing = event.timing;

		// if tmode is demand, wipe timing object
		if ($('#fe_ee_timing').val() == 'demand') {
			event.timing = false;
			timing = false;
		}

		// if tmode is demand, wipe timing object
		if ($('#fe_ee_timing').val() == 'interval') {
			event.timing = false;
			timing = false;
		}

		$('.ccbox_timing_year.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var year = parseInt(RegExp.$1);
				if (!timing.years) timing.years = [];
				timing.years.push(year);
			}
		});

		$('.ccbox_timing_month.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var month = parseInt(RegExp.$1);
				if (!timing.months) timing.months = [];
				timing.months.push(month);
			}
		});

		$('.ccbox_timing_weekday.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var weekday = parseInt(RegExp.$1);
				if (!timing.weekdays) timing.weekdays = [];
				timing.weekdays.push(weekday);
			}
		});

		$('.ccbox_timing_day.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var day = parseInt(RegExp.$1);
				if (!timing.days) timing.days = [];
				timing.days.push(day);
			}
		});

		$('.ccbox_timing_hour.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var hour = parseInt(RegExp.$1);
				if (!timing.hours) timing.hours = [];
				timing.hours.push(hour);
			}
		});

		$('.ccbox_timing_minute.checked').each(function () {
			if (this.id.match(/_(\d+)$/)) {
				var minute = parseInt(RegExp.$1);
				if (!timing.minutes) timing.minutes = [];
				timing.minutes.push(minute);
			}
		});

		// update summary
		$('#d_ee_timing_summary').html(summarize_event_timing(timing, event.timezone).replace(/(every\s+minute)/i, '<span style="color:red">$1</span>'));
	},

	get_timing_checkbox_set: function (name, items, values, auto_add) {
		// render html for set of color label checkboxes for timing category
		var html = '';

		// make sure all items are arrays
		for (var idx = 0, len = items.length; idx < len; idx++) {
			var item = items[idx];
			if (!isa_array(item)) items[idx] = [item, item];
		}

		// add unknown values to items array
		if (auto_add) {
			var is_callback = !!(typeof (auto_add) == 'function');
			var added = 0;
			for (var idx = 0, len = values.length; idx < len; idx++) {
				var value = values[idx];
				var found = false;
				for (var idy = 0, ley = items.length; idy < ley; idy++) {
					if (items[idy][0] == value) { found = true; idy = ley; }
				} // foreach item
				if (!found) {
					items.push(is_callback ? auto_add(value) : [value, value]);
					added++;
				}
			} // foreach value

			// resort items
			if (added) {
				items = items.sort(function (a, b) {
					return a[0] - b[0];
				});
			}
		} // auto_add

		for (var idx = 0, len = items.length; idx < len; idx++) {
			var item = items[idx];
			var checked = !!(values.indexOf(item[0]) > -1);
			var classes = [];
			if (checked) classes.push("checked");
			classes.push("ccbox_timing");
			classes.push("ccbox_timing_" + name);
			if (item[2]) classes.push(item[2]);

			if (html) html += ' ';
			html += app.get_color_checkbox_html("ccbox_timing_" + name + '_' + item[0], item[1], classes.join(' '));
			// NOTE: the checkbox id isn't currently even used

			// if (break_every && (((idx + 1) % break_every) == 0)) html += '<br/>';
		} // foreach item

		return html;
	},

	change_edit_plugin: function () {
		// switch plugins, set default params, refresh param editor
		var event = this.event;
		var plugin_id = $('#fe_ee_plugin').val();
		event.plugin = plugin_id;
		event.params = {};

		if (plugin_id) {
			var plugin = find_object(app.plugins, { id: plugin_id });
			if (plugin && plugin.params && plugin.params.length) {
				for (var idx = 0, len = plugin.params.length; idx < len; idx++) {
					var param = plugin.params[idx];
					event.params[param.id] = param.value;
				}
			}
		}

		this.refresh_plugin_params();
	},

	setScriptEditor: function () {

		let params = this.event.params || {}
		let el = document.getElementById("fe_ee_pp_script")

		if (!el) return

		let privs = app.user.privileges;
		let canEdit = privs.admin || privs.edit_events || privs.create_events;

		let lang = params.lang || params.default_lang || 'shell';
		// gutter for yaml linting
		let gutter = ''
		let lint = 'false'

		if (lang == 'java') { lang = 'text/x-java' }
		if (lang == 'scala') { lang = 'text/x-scala' }
		if (lang == 'csharp') { lang = 'text/x-csharp' }
		if (lang == 'sql') { lang = 'text/x-sql' }
		if (lang == 'dockerfile') { lang = 'text/x-dockerfile' }
		if (lang == 'toml') { lang = 'text/x-toml' }
		if (lang == 'yaml') {
			lang = 'text/x-yaml'
			gutter = 'CodeMirror-lint-markers'
			lint = 'CodeMirror.lint.yaml'
		}
		if (lang == 'json') {
			lang = 'application/json'
			lint = 'CodeMirror.lint.json'
		}
		if (lang == 'props') { lang = 'text/x-properties' }

		let theme = app.getPref('theme') == 'dark' && params.theme == 'default' ? 'gruvbox-dark' : params.theme;
		if (params.theme == 'light') theme = 'default'

		let editor = CodeMirror.fromTextArea(el, {
			mode: lang,
			readOnly: !canEdit,
			styleActiveLine: true,
			lineWrapping: false,
			scrollbarStyle: "overlay",
			lineNumbers: true,
			theme: theme || 'default',
			matchBrackets: true,
			gutters: [gutter],
			lint: lint,
			extraKeys: {
				"F11": (cm) => cm.setOption("fullScreen", !cm.getOption("fullScreen")),
				"Esc": (cm) => cm.getOption("fullScreen") ? cm.setOption("fullScreen", false) : null,
				"Ctrl-/": (cm) => cm.execCommand('toggleComment')
			}
		});

		editor.on('change', (cm) => { el.value = cm.getValue() })

		// syntax selector
		document.getElementById("fe_ee_pp_lang").addEventListener("change", function () {
			let ln = this.options[this.selectedIndex].value;

			editor.setOption("gutters", ['']);
			editor.setOption("lint", false)

			if (ln == 'java') { ln = 'text/x-java' }
			if (ln == 'scala') { ln = 'text/x-scala' }
			if (ln == 'csharp') { ln = 'text/x-csharp' }
			if (ln == 'sql') { ln = 'text/x-sql' }
			if (ln == 'dockerfile') { ln = 'text/x-dockerfile' }
			if (ln == 'toml') { ln = 'text/x-toml' }
			if (ln == 'json') {
				ln = 'application/json'
				editor.setOption("lint", CodeMirror.lint.json)
			}
			if (ln == 'props') { ln = 'text/x-properties' }
			if (ln == 'yaml') {
				ln = 'text/x-yaml'
				editor.setOption("gutters", ['CodeMirror-lint-markers']);
				editor.setOption("lint", CodeMirror.lint.yaml)
			}
			editor.setOption("mode", ln);
		});

		// theme 
		document.getElementById("fe_ee_pp_theme").addEventListener("change", function () {
			var thm = this.options[this.selectedIndex].value;
			if (thm === 'default' && app.getPref('theme') === 'dark') thm = 'gruvbox-dark';
			if (thm === 'light') thm = 'default';
			editor.setOption("theme", thm);
		});
	},

	get_plugin_params_html: function () {
		// get plugin param editor html
		var html = '';
		var event = this.event;
		var params = event.params;

		if (event.plugin) {
			var plugin = find_object(app.plugins, { id: event.plugin });
			if (plugin && plugin.params && plugin.params.length) {

				html += '<div style="font-size:13px; margin-top:7px; display:none;"><span class="link addme" onMouseUp="$P().expand_fieldset($(this))"><i class="fa fa-plus-square-o">&nbsp;</i>Plugin Parameters</span></div>';
				html += '<fieldset style="margin-top:7px; padding:10px 10px 0 10px; width: 55rem;"><legend class="link addme" onMouseUp="$P().collapse_fieldset($(this))"><i class="fa fa-minus-square-o">&nbsp;</i>Plugin Parameters</legend>';

				for (var idx = 0, len = plugin.params.length; idx < len; idx++) {
					var param = plugin.params[idx];
					var value = (param.id in params) ? params[param.id] : param.value;
					switch (param.type) {

						case 'text':

							html += '<div class="plugin_params_label">' + param.title + '</div>';
							html += '<div class="plugin_params_content" style="width: 54rem"><input type="text" id="fe_ee_pp_' + param.id + '" size="' + param.size + '" value="' + escape_text_field_value(value) + '" spellcheck="false"/></div>';
							break;

						case 'textarea':
							let ta_height = parseInt(param.rows) * 15;
							html += '<div class="plugin_params_label">' + param.title + '</div>';
							html += '<div class="plugin_params_content" style="width: 54rem"><textarea id="fe_ee_pp_' + param.id + '" style="width:99%; height:' + ta_height + 'px; resize:vertical;" spellcheck="false" onkeydown="return catchTab(this,event)">' + escape_text_field_value(value) + '</textarea></div>';
							break;

						case 'checkbox':
							html += '<div class="plugin_params_content"><input type="checkbox" id="fe_ee_pp_' + param.id + '" value="1" ' + (value ? 'checked="checked"' : '') + '/><label for="fe_ee_pp_' + param.id + '">' + param.title + '</label></div>';
							if (param.id == 'sub_params') {
								html += `<script>
								$("label[for='fe_ee_pp_sub_params']").attr("title", "Substitute placeholders (e.g. [/p1/p2]) using config.params and argument values");
								 </script>
								 `
							}
							break;

						case 'eventlist':
							let workflow = this.event.workflow || []
							let opts = this.event.options || {}
							html += `<div class="plugin_params_label">${param.title}</div>
						  <div class="plugin_params_content" style="margin:10px 10px 10px 10px"> <span> Start From Step: </span>
						    <select onChange="$P().wf_update_start()" id="wf_start_from_step" style="margin:5px" >
							  ${render_menu_options(workflow.map((e, i) => i + 1), opts.wf_start_from_step || 1)}
						    </select>
					      </div>
					      <div id="fe_ee_pp_evt_list"></div>
					      <script>$P().render_wf_event_list()</script>
					      <div class="button mini" style="width:90px;float:left; margin:10px 10px 10px 0px" onMouseUp="$P().wf_event_add()">Add Event</div>
						  <div class="button mini" style="width:90px;float:left; margin:10px 10px 10px 8px" onMouseUp="$P().wf_event_add_cat()">Add Category</div><br>
					      `
							break;

						case 'filelist':
							html += `
							  <div id="fe_ee_pp_file_list"></div>
							  <script>$P().render_file_list()</script>
							  <div class="button mini" style="width:90px; margin:10px 10px 10px 0px" onMouseUp="$P().file_add()">Attach File</div>
							  <div class="caption" >Access files via env vars: FILE_NAME_EXT or files/name.ext</div>
							<br>
	 					    `
							event.theme = param.theme
							break;

						case 'select':
							html += '<div class="plugin_params_label">' + param.title + '</div>';
							html += '<div class="plugin_params_content"><select id="fe_ee_pp_' + param.id + '">' + render_menu_options(param.items, value, true) + '</select></div>';
							break;

						case 'hidden':
							// no visible UI
							break;

					} // switch type
				} // foreach param

				html += '</fieldset>';
				html += '<div class="caption" style="margin-top:6px;">Select the plugin parameters for the event.</div>';

			} // plugin params
			else {
				html += '<div class="caption">The selected plugin has no editable parameters.</div>';
			}
		}
		else {
			html += '<div class="caption">Select a plugin to edit its parameters.</div>';
		}

		return html;
	},

	refresh_plugin_params: function () {
		// redraw plugin param area after change
		$('#d_ee_plugin_params').html(this.get_plugin_params_html());
		this.setScriptEditor();
	},

	get_random_event: function () {
		let tools = { randArray: (array) => array[Math.floor(Math.random() * array.length)] }
		let left = "admiring;adoring;affectionate;agitated;amazing;angry;awesome;beautiful;blissful;bold;boring;brave;busy;charming;clever;cool;compassionate;competent;condescending;confident;cranky;crazy;dazzling;determined;distracted;dreamy;eager;ecstatic;elastic;elated;elegant;eloquent;epic;exciting;fervent;festive;flamboyant;focused;friendly;frosty;funny;gallant;gifted;goofy;gracious;great;happy;hardcore;heuristic;hopeful;hungry;infallible;inspiring;interesting;intelligent;jolly;jovial;keen;kind;laughing;loving;lucid;magical;mystifying;modest;musing;naughty;nervous;nice;nifty;nostalgic;objective;optimistic;peaceful;pedantic;pensive;practical;priceless;quirky;quizzical;recursing;relaxed;reverent;romantic;sad;serene;sharp;silly;sleepy;stoic;strange;stupefied;suspicious;sweet;tender;thirsty;trusting;unruffled;upbeat;vibrant;vigilant;vigorous;wizardly;wonderful;xenodochial;youthful;zealous;zen".split(";");
		let right = "albattani;allen;almeida;antonelli;agnesi;archimedes;ardinghelli;aryabhata;austin;babbage;banach;banzai;bardeen;bartik;bassi;beaver;bell;benz;bhabha;bhaskara;black;blackburn;blackwell;bohr;booth;borg;bose;bouman;boyd;brahmagupta;brattain;brown;buck;burnell;cannon;carson;cartwright;carver;cerf;chandrasekhar;chaplygin;chatelet;chatterjee;chebyshev;cohen;chaum;clarke;colden;cori;cray;curran;curie;darwin;davinci;dewdney;dhawan;diffie;dijkstra;dirac;driscoll;dubinsky;easley;edison;einstein;elbakyan;elgamal;elion;ellis;engelbart;euclid;euler;faraday;feistel;fermat;fermi;feynman;franklin;gagarin;galileo;galois;ganguly;gates;gauss;germain;goldberg;goldstine;goldwasser;golick;goodall;gould;greider;grothendieck;haibt;hamilton;haslett;hawking;hellman;heisenberg;hermann;herschel;hertz;heyrovsky;hodgkin;hofstadter;hoover;hopper;hugle;hypatia;ishizaka;jackson;jang;jemison;jennings;jepsen;johnson;joliot;jones;kalam;kapitsa;kare;keldysh;keller;kepler;khayyam;khorana".split(";")
		let event_title = tools.randArray(left) + '_' + tools.randArray(right);
		let template = app.schedule.find(e => e.title == 'template')

		let evt = {}

		if (template) {
			evt = JSON.parse(JSON.stringify(template))
			evt.title = event_title
			evt.session_id = localStorage.session_id
			delete evt.id
			delete evt.modified
			delete evt.created
		}
		else {
			evt = {
				"enabled": 1,
				params: {
					"duration": "5-20",
					"progress": 1,
					"burn": tools.randArray([0, 1]),
					"action": "Random",
					"secret": "Will not be shown in Event UI",
				},
				"timing": { "minutes": [Math.floor(Math.random() * 60)], "hours": [Math.floor(Math.random() * 24)] },
				"max_children": 1, "timeout": 3600, "catch_up": 0, "queue_max": 1000, "timezone": "America/New_York",
				"plugin": "testplug",
				"title": event_title,
				"category": $("#fe_sch_cat").val() || "general",
				"target": "allgrp", "algo": "random", "multiplex": 0, "stagger": 0, "retries": 0,
				"retry_delay": 0, "detached": 0, "queue": 0, "chain": "", "chain_error": "", "notify_success": "", "notify_fail": "", "web_hook": "", "cpu_limit": 0, "cpu_sustain": 0,
				"memory_limit": 0, "memory_sustain": 0, "log_max_size": 0, "notes": "Randomly Generated Job",
				"session_id": localStorage.session_id,
			}
		}

		return evt

	},

	get_event_form_json: function (quiet) {
		// get event elements from form, used for new or edit
		var event = this.event;

		// event title
		event.title = trim($('#fe_ee_title').val());
		if (!event.title) return quiet ? false : app.badField('fe_ee_title', "Please enter a title for the event.");

		// event enabled
		event.enabled = $('#fe_ee_enabled').is(':checked') ? 1 : 0;

		// event silent
		event.silent = $('#fe_ee_silent').is(':checked') ? 1 : 0;

		// argument concurrency
		event.concurrent_arg = $('#fe_ee_concurrent_arg').is(':checked') ? 1 : 0;

		//graph icon 
		event.graph_icon = $('#fe_ee_graph_icon').val()  //|| 'f111';
		//args
		event.args = $('#fe_ee_args').val()
		event.ticks = $('#fe_ee_ticks').val()

		// category
		event.category = $('#fe_ee_cat').val();
		if (!event.category) return quiet ? false : app.badField('fe_ee_cat', "Please select a Category for the event.");

		// target (server group or individual server)
		event.target = $('#fe_ee_target').val();

		// algo / multiplex / stagger
		event.algo = $('#fe_ee_algo').val();
		event.multiplex = (event.algo == 'multiplex') ? 1 : 0;
		if (event.multiplex) {
			event.stagger = parseInt($('#fe_ee_stagger').val()) * parseInt($('#fe_ee_stagger_units').val());
			if (isNaN(event.stagger)) return quiet ? false : app.badField('fe_ee_stagger', "Please enter a number of seconds to stagger by.");
		}
		else {
			event.stagger = 0;
		}

		// opts
		event.options = event.options || {}

		// plugin
		event.plugin = $('#fe_ee_plugin').val();
		if (!event.plugin) return quiet ? false : app.badField('fe_ee_plugin', "Please select a Plugin for the event.");

		// workflow
		// if (event.plugin == 'workflow' && Array.isArray(event.workflow)) {
		// 	event.workflow = event.workflow || []
		// } 
		// else {
		// 	event.workflow = undefined // erase wf info if event plugin is not workflow anymore
		// }

		// files 
		event.files = Array.isArray(this.event.files) ? this.event.files : undefined

		// plugin params
		event.params = {};
		var plugin = find_object(app.plugins, { id: event.plugin });
		if (plugin && plugin.params && plugin.params.length) {
			for (var idx = 0, len = plugin.params.length; idx < len; idx++) {
				var param = plugin.params[idx];
				switch (param.type) {
					case 'text':
					case 'textarea':
					case 'select':
						event.params[param.id] = $('#fe_ee_pp_' + param.id).val();
						break;

					case 'hidden':
						// Special case: Always set this to the plugin default value
						event.params[param.id] = param.value;
						break;

					case 'checkbox':
						event.params[param.id] = $('#fe_ee_pp_' + param.id).is(':checked') ? 1 : 0;
						break;
				} // switch type
			} // foreach param
		} // plugin params

		// timezone
		event.timezone = $('#fe_ee_timezone').val();
		event.start_time = new Date($('#event_starttime').val()).valueOf()
		event.end_time = new Date($('#event_endtime').val()).valueOf()

		let eventInterval = $('#fe_ee_interval').val()
		let repeatInterval = $('#fe_ee_repeat').val()
         
		if(repeatInterval) {
			if ((parseInt(repeatInterval) || 0) < 1) return app.badField('fe_ee_repeat', "Invalid repeat value (must be positive integer)");
			event.repeat = (parseInt($('#fe_ee_repeat').val()) * parseInt($('#fe_ee_repeat_units').val()));
			event.timing = false
			event.interval = false
			event.interval_start = false 
		}
		else if (eventInterval) {
			if ((parseInt(eventInterval) || 0) < 1) return app.badField('fe_ee_interval', "Invalid interval value (must be positive integer)");
			event.interval = (parseInt($('#fe_ee_interval').val()) * parseInt($('#fe_ee_interval_units').val()));
			event.interval_start = parseInt(event.interval_start) || 0
			event.timing = false
			event.repeat = false
		}
		else {
			event.interval = false
			event.interval_start = false
			event.repeat = false
		}


		// max children
		event.max_children = parseInt($('#fe_ee_max_children').val());

		// timeout
		event.timeout = parseInt($('#fe_ee_timeout').val()) * parseInt($('#fe_ee_timeout_units').val());
		if (isNaN(event.timeout)) return quiet ? false : app.badField('fe_ee_timeout', "Please enter an integer value for the event timeout.");
		if (event.timeout < 0) return quiet ? false : app.badField('fe_ee_timeout', "Please enter a positive integer for the event timeout.");

		// retries
		event.retries = parseInt($('#fe_ee_retries').val());
		event.retry_delay = parseInt($('#fe_ee_retry_delay').val()) * parseInt($('#fe_ee_retry_delay_units').val());
		if (isNaN(event.retry_delay)) return quiet ? false : app.badField('fe_ee_retry_delay', "Please enter an integer value for the event retry delay.");
		if (event.retry_delay < 0) return quiet ? false : app.badField('fe_ee_retry_delay', "Please enter a positive integer for the event retry delay.");

		// log expiration
		event.log_expire_days = parseInt($('#fe_ee_expire_days').val()) || undefined;

		// catch-up mode (run all)
		event.catch_up = $('#fe_ee_catch_up').is(':checked') ? 1 : 0;

		// method (interruptable, non-interruptable)
		event.detached = $('#fe_ee_detached').is(':checked') ? 1 : 0;

		// event queue
		event.queue = $('#fe_ee_queue').is(':checked') ? 1 : 0;
		event.queue_max = parseInt($('#fe_ee_queue_max').val() || "0");
		if (isNaN(event.queue_max)) return quiet ? false : app.badField('fe_ee_queue_max', "Please enter an integer value for the event queue max.");
		if (event.queue_max < 0) return quiet ? false : app.badField('fe_ee_queue_max', "Please enter a positive integer for the event queue max.");

		// chain reaction
		event.chain = $('#fe_ee_chain').val();
		event.chain_error = $('#fe_ee_chain_error').val();

		// cursor reset
		if (event.id && event.catch_up && $('#fe_ee_rc_enabled').is(':checked')) {
			var new_cursor = parseInt($('#fe_ee_rc_time').data('epoch'));
			if (!new_cursor || isNaN(new_cursor)) return quiet ? false : app.badField('fe_ee_rc_time', "Please enter a valid date/time for the new event time.");
			event['reset_cursor'] = normalize_time(new_cursor, { sec: 0 });
		}
		else delete event['reset_cursor'];

		// notification
		event.notify_success = $('#fe_ee_notify_success').val();
		event.notify_fail = $('#fe_ee_notify_fail').val();
		event.web_hook = $('#fe_ee_web_hook').val();
		event.web_hook_start = $('#fe_ee_web_hook_start').val();
		event.web_hook_error = $('#fe_ee_web_hook_error').is(':checked') ? 1 : 0;

		// cpu limit
		if ($('#fe_ee_cpu_enabled').is(':checked')) {
			event.cpu_limit = parseInt($('#fe_ee_cpu_limit').val());
			if (isNaN(event.cpu_limit)) return quiet ? false : app.badField('fe_ee_cpu_limit', "Please enter an integer value for the CPU limit.");
			if (event.cpu_limit < 0) return quiet ? false : app.badField('fe_ee_cpu_limit', "Please enter a positive integer for the CPU limit.");

			event.cpu_sustain = parseInt($('#fe_ee_cpu_sustain').val()) * parseInt($('#fe_ee_cpu_sustain_units').val());
			if (isNaN(event.cpu_sustain)) return quiet ? false : app.badField('fe_ee_cpu_sustain', "Please enter an integer value for the CPU sustain period.");
			if (event.cpu_sustain < 0) return quiet ? false : app.badField('fe_ee_cpu_sustain', "Please enter a positive integer for the CPU sustain period.");
		}
		else {
			event.cpu_limit = 0;
			event.cpu_sustain = 0;
		}

		// mem limit
		if ($('#fe_ee_memory_enabled').is(':checked')) {
			event.memory_limit = parseInt($('#fe_ee_memory_limit').val()) * parseInt($('#fe_ee_memory_limit_units').val());
			if (isNaN(event.memory_limit)) return quiet ? false : app.badField('fe_ee_memory_limit', "Please enter an integer value for the memory limit.");
			if (event.memory_limit < 0) return quiet ? false : app.badField('fe_ee_memory_limit', "Please enter a positive integer for the memory limit.");

			event.memory_sustain = parseInt($('#fe_ee_memory_sustain').val()) * parseInt($('#fe_ee_memory_sustain_units').val());
			if (isNaN(event.memory_sustain)) return quiet ? false : app.badField('fe_ee_memory_sustain', "Please enter an integer value for the memory sustain period.");
			if (event.memory_sustain < 0) return quiet ? false : app.badField('fe_ee_memory_sustain', "Please enter a positive integer for the memory sustain period.");
		}
		else {
			event.memory_limit = 0;
			event.memory_sustain = 0;
		}

		// log file size limit
		if ($('#fe_ee_log_enabled').is(':checked')) {
			event.log_max_size = parseInt($('#fe_ee_log_limit').val()) * parseInt($('#fe_ee_log_limit_units').val());
			if (isNaN(event.log_max_size)) return quiet ? false : app.badField('fe_ee_log_limit', "Please enter an integer value for the log size limit.");
			if (event.log_max_size < 0) return quiet ? false : app.badField('fe_ee_log_limit', "Please enter a positive integer for the log size limit.");
		}
		else {
			event.log_max_size = 0;
		}

		// notes
		event.notes = trim($('#fe_ee_notes').val());

		return event;
	},

	onDataUpdate: function (key, value) {
		// recieved data update (websocket), see if sub-page cares about it
		switch (key) {
			case 'schedule':
				if (this.args.sub == 'events' && value.length !== this.args.eventCount) {
					this.args.eventCount = value.length
					this.gosub_events(this.args);
				}
				break;

			case 'state':
				if (this.args.sub == 'edit_event') this.update_rc_value();
				else if (this.args.sub == 'events') this.update_job_last_runs();
				break;

			case 'tick':  // refresh schedule page on minute tick to update timing
				if (this.args.sub == 'events') this.gosub_events(this.args);
				break;
		}
	},

	onStatusUpdate: function (data) {
		if (data.jobs_changed) this.update_job_last_runs()

	},

	onResizeDelay: function (size) {
		// called 250ms after latest window resize
		// so we can run more expensive redraw operations
		// if (this.args.sub == 'events') this.gosub_events(this.args);
	},

	leavesub_edit_event: function (args) {
		// special hook fired when leaving edit_event sub-page
		// try to save edited state of event in mem cache
		if (this.event_copy) return; // in middle of edit --> copy operation

		var event = this.get_event_form_json(true); // quiet mode
		if (event) {
			app.autosave_event = event;
		}
	},

	onDeactivate: function () {
		// called when page is deactivated
		// this.div.html( '' );
		if (app.network) app.network.unselectAll();

		// allow sub-page to hook deactivate
		if (this.args && this.args.sub && this['leavesub_' + this.args.sub]) {
			this['leavesub_' + this.args.sub](this.args);
		}

		return true;
	}

});
