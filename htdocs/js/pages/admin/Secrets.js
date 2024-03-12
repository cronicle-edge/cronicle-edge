// Cronicle Admin Page -- Secrets

Class.add( Page.Admin, {
	
	gosub_secrets: function (args) {
		// show Config Key list
		const self = this
		let secret = this.secret
		app.setWindowTitle("Secrets");		
		self.div.addClass('loading');
		self.secret = {};
		self.secretId = args.id
		
		app.api.post('/api/app/get_secret', { id: args.id || 'globalenv' }, self.receive_secrets.bind(self));
	},

	setSecretEditor: function(id) {
		const self = this;
		let secret = self.secret;
		let editor = CodeMirror.fromTextArea(document.getElementById(id), {
			mode: "text/x-properties",
			styleActiveLine: true,
			lineWrapping: false,
			scrollbarStyle: "overlay",
			placeholder: "# set dotenv style KEY=VAL pairs, it will be mounted as env variables. Multiline values should be enquoted",
			lineNumbers: true,
			matchBrackets: true,
			theme: app.getPref('theme') == 'light' ? 'default' : 'solarized dark',
			extraKeys: {
			  "F11": function(cm) {
				cm.setOption("fullScreen", !cm.getOption("fullScreen"));
			  },
			  "Esc": function(cm) {
				if (cm.getOption("fullScreen")) cm.setOption("fullScreen", false);
			  }
			}								  
		  });

		 editor.on('change', function(cm){
			secret.data = cm.getValue();
		  });
  
		 editor.setValue(secret.data || '');

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
		let secretId = this.secretId
		let plugs = (app.plugins || []).map(e=>({id: e.id, title: 'plug: ' + e.title}))
		let cats = (app.categories || []).map(e=>({id: e.id, title: 'cat: ' + e.title}))
		let menu = '<optgroup label="Plugins:">' + render_menu_options(plugs, secretId, false) + '</optgroup>';
		menu += '<optgroup label="Categories:">' + render_menu_options(cats, secretId, false) + '</optgroup>';
		let secretList = (app.plugins || []).map(e=>({id: e.id, title: 'plugin: ' + e.title}))
		let env_lock = this.secret.encrypted ? '<i class="fa fa-lock">&nbsp;&nbsp;</i>' : ''
		html += `Secret Editor &nbsp;&nbsp;<span id="fe_env_lock">${env_lock}</span>`;
		html += `<div class="subtitle_widget"><span style="font-size:16px;font-weight: bold;padding-right: 20px">Scope: </span><i class="fa fa-chevron-down">&nbsp;</i><select id="fe_sec_plugin" class="subtitle_menu subtitle_menu_big" style="width:180px;margin-bottom:5px" onChange="$P().switch_secret(this.value)"><option value="">Global</option>${menu}</select></div>`

		html += '<div class="clear"></div>';
		html += '</div>';

		html += `
		<div  class="plugin_params_content" id="fe_ee_env">
		  <textarea id="fe_ee_env_editor" ></textarea>
		  <div style="height:10px;"></div>
		  <center><table><tr>
		  <td><div id="env_enc_button" class="button" style="width:130px;" onMouseUp="$P().toggle_env_encryption()">${this.secret.encrypted ? 'Decrypt' : 'Encrypt'}</div></td>
		  <td width="40">&nbsp;</td>
		  <td><div class="button" style="width:130px;" onMouseUp="$P().update_secret()"><i class="fa fa-save">&nbsp;&nbsp;</i>Save</div></td>
		  </tr></table></center>		  
		</div>
		<script>$P().setSecretEditor("fe_ee_env_editor")</script>
		`
		html += '</div>'; // padding
		
		this.div.html(html);
	},

	switch_secret: function(id) {
		if(id) Nav.go(`#Admin?sub=secrets&id=${id}`)
		else Nav.go(`#Admin?sub=secrets`)
	},

	update_secret: function () {
		const self = this
		let secret = this.secret
		// secret.data = env_editor.getValue();
		self.args = {id: secret.id}
		app.showProgress(1.0, "Updating Secret Data...");

		let apiUrl = secret.virtual ? '/api/app/create_secret' : '/api/app/update_secret'
		delete secret.virtual

		app.api.post(apiUrl, secret, function (resp) {
			app.hideProgress();
			if (resp.code == 0) app.showMessage('success', "Secret Data has been updated successfully.");
			
		});
		// self.gosub_secrets({id: secret.id})
	
	},

	toggle_env_encryption: function () {
		this.secret.encrypted = !this.secret.encrypted;
		$("#env_enc_button").html(this.secret.encrypted ? 'Decrypt' : 'Encrypt');
		$("#fe_env_lock").html(this.secret.encrypted ? '<i class="fa fa-lock">&nbsp;&nbsp;</i>' : '')

	}	
	
});
