#!/usr/bin/env node

// Cronicle Server - Main entry point
// Copyright (c) 2015 - 2022 Joseph Huckaby
// Released under the MIT License

// Emit warning for broken versions of node v10
// See: https://github.com/jhuckaby/Cronicle/issues/108
if (process.version.match(/^v10\.[012345678]\.\d+$/)) {
	console.error("\nWARNING: You are using an incompatible version of Node.js (" + process.version + ") with a known timer bug.\nCronicle will stop working after approximately 25 days under these conditions.\nIt is highly recommended that you upgrade to Node.js v10.9.0 or later, or downgrade to Node LTS (v8.x).\nSee https://github.com/jhuckaby/Cronicle/issues/108 for details.\n");
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

let storage_config = process.env['CRONICLE_storage_config'] || "conf/storage.json"
if(fs.existsSync(storage_config)) configFiles.push( {
	file: storage_config , key: "Storage"
})

const server = new PixlServer({
	
	__name: 'Cronicle',
	__version: require('../package.json').version,
	
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
