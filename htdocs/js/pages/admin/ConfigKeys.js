// Cronicle Admin Page -- Configs

Class.add( Page.Admin, {
	
	gosub_conf_keys: function (args) {
		// show Config Key list
		app.setWindowTitle("Configs");
		var self = this;
		self.div.addClass('loading');
		self.secret = {};
		app.api.post('/api/app/get_secret', { id: 'globalenv' }, function (resp) {
			//if(err) console.log('failed to retreive secret');
			if (resp.secret) self.secret = resp.secret;
			app.api.post('app/get_conf_keys', copy_object(args), self.receive_confkeys.bind(self));
		});
	},
	
	receive_confkeys: function(resp) {
		// receive all Configs from server, render them sorted
		this.lastConfigKeysResp = resp;
		
		var html = '';
		this.div.removeClass('loading');
		
		var size = get_inner_window_size();
		var col_width = Math.floor( ((size.width * 0.9) + 200) / 7 );
		
		if (!resp.rows) resp.rows = [];
		
		// sort by title ascending
		this.conf_keys = resp.rows.sort( function(a, b) {
			return a.title.toLowerCase().localeCompare( b.title.toLowerCase() );
		} );
		
		html += this.getSidebarTabs( 'conf_keys',
			[
				['activity', "Activity Log"],
				['conf_keys', "Configs"],
				['api_keys', "API Keys"],
				['categories', "Categories"],
				['plugins', "Plugins"],
				['servers', "Servers"],
				['users', "Users"]
			]
		);
		
		var cols = ['Config Key', 'Value', 'Action'];
		
		html += '<div style="padding:20px 20px 30px 20px">';
		
		html += '<div class="subtitle">';
		let env_lock = this.secret.encrypted ? '<i class="fa fa-lock">&nbsp;&nbsp;</i>' : ''
		html += `Configs &nbsp;&nbsp;<span id="fe_env_lock">${env_lock}</span>`;

		var showEnvEditor = app.showEnvEditor ? 'checked' : ''

		html += `<div class="subtitle_widget"><a href="/conf" ><b>Config Viewer</b></a></div>`
		html += `<div class="subtitle_widget" ><input ${showEnvEditor} id="fe_ee_env_toggle" onclick="$('#fe_ee_env').toggle();env_editor.refresh();app.showEnvEditor=!app.showEnvEditor;" type="checkbox"></input><label for="fe_ee_env_toggle">Show Env Editor</label></div>`

		html += '<div class="clear"></div>';
		html += '</div>';

		html += `
		<div  class="plugin_params_content" id="fe_ee_env" style="${app.showEnvEditor ? '' : 'display: none'}">
		  <textarea id="fe_ee_env_editor" ></textarea>
		  <div style="height:10px;"></div>
		  <center><table><tr>
		  <td><div id="env_enc_button" class="button" style="width:130px;" onMouseUp="$P().toggle_env_encryption()">${this.secret.encrypted ? 'Decrypt' : 'Encrypt'}</div></td>
		  <td width="40">&nbsp;</td>
		  <td><div class="button" style="width:130px;" onMouseUp="$P().update_globalenv()"><i class="fa fa-save">&nbsp;&nbsp;</i>Save</div></td>
		  </tr></table></center>		  
		</div>
		<script>
		
		var env_editor = CodeMirror.fromTextArea(document.getElementById("fe_ee_env_editor"), {
		  mode: "text/x-properties",
		  styleActiveLine: true,
		  lineWrapping: false,
		  scrollbarStyle: "overlay",
		  lineNumbers: true,
		  matchBrackets: true,
		  extraKeys: {
			"F11": function(cm) {
			  cm.setOption("fullScreen", !cm.getOption("fullScreen"));
			},
			"Esc": function(cm) {
			  if (cm.getOption("fullScreen")) cm.setOption("fullScreen", false);
			}
		  }								  
		});

		env_editor.setValue(($P().secret.data || '').toString());
		</script>
		`
		html += this.getBasicTable(this.conf_keys, cols, 'key', function (item, idx) {
			var actions = [
				'<span class="link" onMouseUp="$P().edit_conf_key(' + idx + ')"><b>Edit</b></span>',
				'<span class="link" onMouseUp="$P().delete_conf_key(' + idx + ')"><b>Delete</b></span>'
			];

			let kt_map = {
				'application/json': '[JSON]',
				'text/xml': '[XML]',
				'text/x-sql': '[SQL]',
				'text/plain': '[TEXT]'
			}

			let key_disp = kt_map[item.type] || item.key ;
			if(item.type == "bool" && item.key) key_disp = "☑"
			if(item.type == "bool" && !item.key) key_disp = "☐"

			return [
				`<div style="white-space:nowrap;" title="${(item.description || '').replace(/\"/g, "&quot;")}" ><i class="fa fa-wrench">&nbsp;&nbsp;</i><b>${item.title}<b></div>`
				, `<div class="activity_desc">${encode_entities(key_disp)}</div>`
				, '<div style="white-space:nowrap;">' + actions.join(' | ') + '</div>'
			];
		});

		html += '<div style="height:30px;"></div>';
		html += '<center><table><tr>';
		html += '<td><div class="button" style="width:130px;" onMouseUp="$P().edit_conf_key(-1)"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Add Config Key...</div></td>';
		html += '<td width="40">&nbsp;</td>';
		html += '<td><div class="button" style="width:130px;" onMouseUp="$P().do_reload_conf_key()"><i class="fa fa-refresh">&nbsp;&nbsp;</i>Reload</div></td>';
		html += '</tr></table></center>';

		html += '</div>'; // padding
		html += '</div>'; // sidebar tabs

		this.div.html(html);
	},

	update_globalenv: function () {
		this.secret.data = env_editor.getValue();
		app.showProgress(1.0, "Updating Enviroment Data...");

		app.api.post('/api/app/update_secret', this.secret, function (resp) {
			app.hideProgress();
			if (resp.code == 0) app.showMessage('success', "Enviroment Data has been updated successfully.");

		});
	},

	toggle_env_encryption: function () {
		this.secret.encrypted = !this.secret.encrypted;
		$("#env_enc_button").html(this.secret.encrypted ? 'Decrypt' : 'Encrypt');
		$("#fe_env_lock").html(this.secret.encrypted ? '<i class="fa fa-lock">&nbsp;&nbsp;</i>' : '')

	},
	
	edit_conf_key: function(idx) {
		// jump to edit sub
		if (idx > -1) Nav.go( '#Admin?sub=edit_conf_key&id=' + this.conf_keys[idx].id );
		else Nav.go( '#Admin?sub=new_conf_key' );
	},
	
	delete_conf_key: function(idx) {
		// delete key from search results
		this.conf_key = this.conf_keys[idx];
		this.show_delete_conf_key_dialog();
	},
	
	gosub_new_conf_key: function(args) {
		// create new Config Key
		var html = '';
		app.setWindowTitle( "New Config Key" );
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'new_conf_key',
			[
				['activity', "Activity Log"],
				['conf_keys', "Configs"],
				['new_conf_key', "New Config Key"],
				['api_keys', "API Keys"],
				['categories', "Categories"],
				['plugins', "Plugins"],
				['servers', "Servers"],
				['users', "Users"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">New Config Key</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center><table style="margin:0;">';
		
		this.conf_key = { key: 'true' };
		
		html += this.get_conf_key_edit_html();
		
		// buttons at bottom
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().cancel_conf_key_edit()">Cancel</div></td>';
				html += '<td width="50">&nbsp;</td>';
				
				html += '<td><div class="button" style="width:120px;" onMouseUp="$P().do_new_conf_key()"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i>Create Key</div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table></center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
		
		setTimeout( function() {
			$('#fe_ck_title').focus();
		}, 1 );
	},
	
	cancel_conf_key_edit: function() {
		// cancel editing Config Key and return to list
		Nav.go( 'Admin?sub=conf_keys' );
	},
	
	do_new_conf_key: function(force) {
		// create new Config Key
		app.clearError();
		var conf_key = this.get_conf_key_form_json();
		if (!conf_key) return; // error
		
		if (!conf_key.title.length) {
			return app.badField('#fe_ck_title', "Please enter Config Name");
		}
		
		this.conf_key = conf_key;
		
		app.showProgress( 1.0, "Creating Config Key..." );
		app.api.post( 'app/create_conf_key', conf_key, this.new_conf_key_finish.bind(this) );
	},
	
	new_conf_key_finish: function(resp) {
		// new Config Key created successfully
		app.hideProgress();
		
		Nav.go('Admin?sub=edit_conf_key&id=' + resp.id);
		
		setTimeout( function() {
			app.showMessage('success', "The new Config Key was created successfully.");
		}, 150 );
	},
	
	gosub_edit_conf_key: function(args) {
		// edit Config Key subpage
		this.div.addClass('loading');
		app.api.post( 'app/get_conf_key', { id: args.id }, this.receive_confkey.bind(this) );
	},
	
	receive_confkey: function(resp) {
		// edit existing Config Key
		var html = '';
		this.conf_key = resp.conf_key;
		
		app.setWindowTitle( "Editing Config Key \"" + (this.conf_key.title) + "\"" );
		this.div.removeClass('loading');
		
		html += this.getSidebarTabs( 'edit_conf_key',
			[
				['activity', "Activity Log"],
				['conf_keys', "Configs"],
				['edit_conf_key', "Edit Config Key"],
				['api_keys', "API Keys"],
				['categories', "Categories"],
				['plugins', "Plugins"],
				['servers', "Servers"],
				['users', "Users"]
			]
		);
		
		html += '<div style="padding:20px;"><div class="subtitle">Editing Config Key &ldquo;' + (this.conf_key.title) + '&rdquo;</div></div>';
		
		html += '<div style="padding:0px 20px 50px 20px">';
		html += '<center>';
		html += '<table style="margin:0;">';
		
		html += this.get_conf_key_edit_html();
		
		html += '<tr><td colspan="2" align="center">';
			html += '<div style="height:30px;"></div>';
			
			html += '<table><tr>';
				html += '<td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().cancel_conf_key_edit()">Cancel</div></td>';
				html += '<td width="40">&nbsp;</td>';
				html += '<td><div class="button" style="width:120px; font-weight:normal;" onMouseUp="$P().show_delete_conf_key_dialog()">Delete Key...</div></td>';
				html += '<td width="40">&nbsp;</td>';
				html += '<td><div class="button" style="width:120px;" onMouseUp="$P().do_save_conf_key()"><i class="fa fa-floppy-o">&nbsp;&nbsp;</i>Save Changes</div></td>';
				html += '<td width="40">&nbsp;</td>';
				html +=  '<td><div class="button" style="width:120px;" onMouseUp="$P().edit_conf_key(-1)"><i class="fa fa-plus-circle">&nbsp;&nbsp;</i> New </div></td>';
			html += '</tr></table>';
			
		html += '</td></tr>';
		
		html += '</table>';
		html += '</center>';
		html += '</div>'; // table wrapper div
		
		html += '</div>'; // sidebar tabs
		
		this.div.html( html );
	},
	
	do_save_conf_key: function() {
		// save changes to Config Key
		app.clearError();
		var conf_key = this.get_conf_key_form_json();
		if (!conf_key) return; // error
		
		this.conf_key = conf_key;
		
		app.showProgress( 1.0, "Saving Config Key..." );
		app.api.post( 'app/update_conf_key', conf_key, this.save_conf_key_finish.bind(this) );
	},
	
	save_conf_key_finish: function(resp, tx) {
		// new Config Key saved successfully
		app.hideProgress();
		app.showMessage('success', "The Config Key was saved successfully.");
		window.scrollTo( 0, 0 );
	},

	do_reload_conf_key: function(args) {
		// save changes to Config Key
		app.clearError();
		app.showProgress( 1.0, "Reloading Config Key..." );
		app.api.post( 'app/reload_conf_key', args, this.reload_conf_key_finish.bind(this) );
	},
	
	reload_conf_key_finish: function(resp, tx) {
		// new Config Key saved successfully
		app.hideProgress();
		app.showMessage('success', "Configs were reloaded successfully.");
		window.scrollTo( 0, 0 );
	},

	
	show_delete_conf_key_dialog: function() {
		// show dialog confirming Config Key delete action
		var self = this;
		app.confirm( '<span style="color:red">Delete Config Key</span>', "Are you sure you want to <b>permanently delete</b> the Config Key \""+this.conf_key.title+"\"?  There is no way to undo this action.", 'Delete', function(result) {
			if (result) {
				app.showProgress( 1.0, "Deleting Config Key..." );
				app.api.post( 'app/delete_conf_key', self.conf_key, self.delete_conf_key_finish.bind(self) );
			}
		} );
	},
	
	delete_conf_key_finish: function(resp, tx) {
		// finished deleting Config Key
		var self = this;
		app.hideProgress();
		
		Nav.go('Admin?sub=conf_keys', 'force');
		
		setTimeout( function() {
			app.showMessage('success', "The Config Key '"+self.conf_key.title+"' was deleted successfully.");
		}, 150 );
	},
	
	get_conf_key_edit_html: function() {
        // get html for editing an Config Key (or creating a new one)
        var html = '';
        var conf_key = this.conf_key;


        // title
        var disableConfTitle = ''
        if(conf_key.title) disableConfTitle = 'disabled' // let edit only if new
        html += get_form_table_row( 'Config Title', `<input type="text" id="fe_ck_title" size="86" value="${escape_text_field_value(conf_key.title)}" spellcheck="false" ${disableConfTitle}/>` );
        html += get_form_table_caption( "For nested properties use . (e.g. servers.worker1)");
        html += get_form_table_spacer();

        // Config  Value
        html += get_form_table_row( 'Type', `
        <select name="ck_type" id="fe_ck_type" onchange="toggleCkType();">
          <option value="string">String</option>
		  <option value="bool">Boolean</option>
          <option value="text/plain">Text</option>
          <option value="text/x-sql">SQL</option>
          <option value="application/json">JSON</option>
          <option value="text/xml">XML</option>
        </select>
        <script>
        $("#fe_ck_type").val($P().conf_key.type || 'string');

        function toggleCkType(){
            if($("#fe_ck_type").val()==="string") {
                $("#conf_editor_div").hide();
				$("#fe_ck_key_bool").hide();
                $("#fe_ck_key").show();
            } 
			else if($("#fe_ck_type").val()==="bool") {
                $("#conf_editor_div").hide();
				$("#fe_ck_key").hide();
                $("#fe_ck_key_bool").show();
            } else {
                $("#conf_editor_div").show();
                conf_editor.refresh();
                $("#fe_ck_key").hide();
				$("#fe_ck_key_bool").hide();
            }
        }

		document.getElementById("fe_ck_type").addEventListener("change", function(){
			conf_editor.setOption("mode", this.options[this.selectedIndex].value);
		});
		
        </script>
        ` );

        html += get_form_table_caption( "Choose value type" );
        html += get_form_table_spacer();

                // Config  Type

        let isString = (conf_key.type || 'string') == 'string';
		let isBool = conf_key.type == 'bool'
		let isText = !isString && !isBool

		html += get_form_table_row( 'Value', `
		<input type="text" style="${isString ? '' : 'display: none'}" id="fe_ck_key" size="73" value="${escape_text_field_value(conf_key.key)}" spellcheck="false"/>
		<input type="checkbox" style="${isBool ? '' : 'display: none'}" id="fe_ck_key_bool" ${conf_key.key ? 'checked' : ''}></input>
		<div id="conf_editor_div" style="width: 40rem;${isText? '' : 'display: none' }" ><textarea id="fe_ee_conf_editor" ></textarea></div>

		<script>
		var conf_editor = CodeMirror.fromTextArea(document.getElementById("fe_ee_conf_editor"), {
			mode: "${ conf_key.type ? conf_key.type : 'text/plain'}",
			styleActiveLine: true,
			lineWrapping: false,
			scrollbarStyle: "overlay",
			lineNumbers: true,
			matchBrackets: true,
			lint: true,
			extraKeys: {
				"F11": function(cm) {
				  cm.setOption("fullScreen", !cm.getOption("fullScreen"));
				},
				"Esc": function(cm) {
				  if (cm.getOption("fullScreen")) cm.setOption("fullScreen", false);
				}
			}	

		  });

		  if($P().conf_key.type == 'bool' && $P().conf_key.key) $("#fe_ck_key_bool").prop("checked", true);
		  conf_editor.setValue(($P().conf_key.key || ' ').toString());
		  </script>

		` );

        // html += get_form_table_caption( "For boolean use 0/1 or true/false" );
        html += get_form_table_spacer();


        // description
        html += get_form_table_row('Description', '<textarea id="fe_ck_desc" style="width:40rem; height:100px; resize:vertical;">'+escape_text_field_value(conf_key.description)+'</textarea>');
        html += get_form_table_caption( "Config purpose (optional)" );
        html += get_form_table_spacer();

        return html;
    },
	
	get_conf_key_form_json: function() {
        // get Config Key elements from form, used for new or edit
        var conf_key = this.conf_key;

		if($('#fe_ck_type').val()  == 'string') conf_key.key = $('#fe_ck_key').val()
		else if($('#fe_ck_type').val()  == 'bool') conf_key.key = $('#fe_ck_key_bool').is(":checked");
		else conf_key.key = conf_editor.getValue();

       // conf_key.key = $('#fe_ck_type').val()  == 'string' ? $('#fe_ck_key').val() : conf_editor.getValue();
        conf_key.active = $('#fe_ck_status').val();
        conf_key.title = $('#fe_ck_title').val();
        conf_key.type = $('#fe_ck_type').val();

        conf_key.description = $('#fe_ck_desc').val();

        if (conf_key.key === "") {
            return app.badField('#fe_ck_key', "Please enter an Config Key string");
        }

        return conf_key;
    }
	
	
});
