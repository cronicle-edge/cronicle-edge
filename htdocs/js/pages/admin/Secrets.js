// Cronicle Admin Page -- Secrets

Class.add( Page.Admin, {
	
	gosub_secrets: function (args) {
		// show Config Key list
		app.setWindowTitle("Secrets");
		var self = this;
		self.div.addClass('loading');
		self.secret = {};
		app.api.post('/api/app/get_secret', { id: 'globalenv' }, self.receive_secrets.bind(self));
	},
	
	receive_secrets: function(resp) {
		// receive all Configs from server, render them sorted
		this.lastSecretsResp = resp;
		this.secret = resp.secret
		
		var html = '';
		this.div.removeClass('loading');
		
		var size = get_inner_window_size();
		
		html += this.getSidebarTabs( 'secrets',
			[
				['activity', "Activity Log"],
				['conf_keys', "Configs"],
				['secrets', "Secrets"],
				['api_keys', "API Keys"],
				['categories', "Categories"],
				['plugins', "Plugins"],
				['servers', "Servers"],
				['users', "Users"]
			]
		);
		
		html += '<div style="padding:20px 20px 30px 20px">';
		html += '<div class="subtitle">';
		let env_lock = this.secret.encrypted ? '<i class="fa fa-lock">&nbsp;&nbsp;</i>' : ''
		html += `Env Secret Editor &nbsp;&nbsp;<span id="fe_env_lock">${env_lock}</span>`;

		html += '<div class="clear"></div>';
		html += '</div>';

		html += `
		<div  class="plugin_params_content" id="fe_ee_env">
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
		  theme: "${app.getPref('theme') == 'light' ? 'default' : 'solarized dark'}",
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
		html += '</div>'; // padding
		
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

	}	
	
});
