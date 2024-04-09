#!/usr/bin/env node

// Cronicle Server - Main entry point
// Copyright (c) 2015 - 2022 Joseph Huckaby
// Released under the MIT License

// Error out if Node.js version is old
if (process.version.match(/^v?(\d+)/) && (parseInt(RegExp.$1) < 16) && !process.env['CRONICLE_OLD']) {
	console.error("\nERROR: You are using an incompatible version of Node.js (" + process.version + ").  Please upgrade to v16 or later.  Instructions: https://nodejs.org/en/download/package-manager\n\nTo ignore this error and run unsafely, set a CRONICLE_OLD environment variable.  Do this at your own risk.\n");
	process.exit(1);
}

const PixlServer = require("pixl-server");
const fs = require('fs');

// chdir to the proper server root dir
process.chdir( require('path').dirname( __dirname ) );

// resolve secret key and config file
let secret_key_file = process.env['CRONICLE_secret_key_file'] || 'conf/secret_key';
if(!process.env['CRONICLE_secret_key'] && fs.existsSync(secret_key_file)) {
	process.env['CRONICLE_secret_key'] = fs.readFileSync(secret_key_file).toString().trim();
}

let configFiles = []

let config_file = process.env['CRONICLE_config_file'] || 'conf/config.json'
if(fs.existsSync(config_file)) configFiles.push( {
	file: config_file
})

// override storage config if needed
if (process.env['CRONICLE_sqlite']) { // use sqlite
	process.env["CRONICLE_Storage__engine"] = "SQL"
	process.env["CRONICLE_Storage__SQL__connection__filename"] = process.env['CRONICLE_sqlite']
	process.env["CRONICLE_Storage__SQL__client"] = "sqlite3"
	process.env["CRONICLE_Storage__SQL__table"] = "cronicle"
	process.env["CRONICLE_Storage__SQL__useNullAsDefault"] = 1
}
else {  // or resolve storage config from files
	let storage_config = process.env['CRONICLE_storage_config'] || "conf/storage.json"
	if (fs.existsSync(storage_config)) configFiles.push({
		file: storage_config, key: "Storage"
	})
}

const server = new PixlServer({
	
	__name: 'Cronicle',
	__version: process.env['CRONICLE_dev_version'] || require('../package.json').version,
	
	// configFile: config_file,
	multiConfig: configFiles,
	
	components: [
		require('pixl-server-storage'),
		require('pixl-server-web'),
		require('pixl-server-api'),
		require('./user.js'),
		require('./engine.js')
	]
	
});

server.startup( function() {
	// server startup complete
	process.title = server.__name + ' Server';
} );
