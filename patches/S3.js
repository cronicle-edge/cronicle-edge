// Amazon AWS S3 Storage Plugin
// Copyright (c) 2022 mikeTWC1984
// Released under the MIT License

// Requires the '@aws-sdk/client-s3' module from npm
// npm install @aws-sdk/client-s3 @aws-sdk/lib-storage

const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage")
const Class = require("pixl-class");
const Component = require("pixl-server/component");
const Tools = require("pixl-tools");
const Cache = require("pixl-cache");

/**
 * 
 * @param {any} stream 
 * @returns {Promise<Buffer>}
 */
const stream2buffer = function (stream) {
	return new Promise((resolve, reject) => {
		const _buf = [];
		stream.on("data", (chunk) => _buf.push(chunk));
		stream.on("end", () => resolve(Buffer.concat(_buf)));
		stream.on("error", (err) => reject(err));
	});
}

module.exports = Class.create({

	__name: 'S3',
	__parent: Component,

	startup: function (callback) {
		// setup Amazon AWS connection
		const self = this;

		this.setup();
		callback();
	},

	setup: function () {
		// setup AWS connection
		const self = this;
		const aws_config = this.storage.config.get('AWS') || this.server.config.get('AWS');
		const s3_config = this.config.get();
		this.bucket = s3_config.params.Bucket;

		this.logDebug(2, "Setting up Amazon S3 (" + aws_config.region + ")");
		this.logDebug(3, "S3 Bucket ID: " + s3_config.params.Bucket);

		this.keyPrefix = (s3_config.keyPrefix || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';

		this.keyTemplate = (s3_config.keyTemplate || '').replace(/^\//, '').replace(/\/$/, '');
		this.fileExtensions = !!s3_config.fileExtensions;

		if (this.debugLevel(10)) {
			// S3 has a logger API but it's extremely verbose -- restrict to level 10 only
			s3_config.logger = {
				log: function (msg) { self.logDebug(10, "S3 Debug: " + msg); }
			};
		}

		// optional LRU cache
		// do not enable for Cronicle
		this.cache = null;
		const cache_opts = s3_config.cache;
		if (cache_opts && cache_opts.enabled) {
			this.logDebug(3, "Setting up LRU cache", cache_opts);
			this.cache = new Cache(Tools.copyHashRemoveKeys(cache_opts, { enabled: 1 }));
			this.cache.on('expire', function (item, reason) {
				self.logDebug(9, "Expiring LRU cache object: " + item.key + " due to: " + reason, {
					key: item.key,
					reason: reason,
					totalCount: self.cache.count,
					totalBytes: self.cache.bytes
				});
			});
		}
		delete s3_config.cache;

		// AWS.config.update( aws_config );
		// this.s3 = new AWS.S3( Tools.copyHashRemoveKeys(s3_config, { keyPrefix:1, keyTemplate:1, fileExtensions:1, cache:1 }) );
		this.s3 = new S3Client(aws_config)

	},

	prepKey: function (key) {
		// prepare key for S3 based on config
		let md5 = Tools.digestHex(key, 'md5');

		let ns = '';
		if (key.match(/^([\w\-\.]+)\//)) ns = RegExp.$1;

		if (this.keyPrefix) {
			key = this.keyPrefix + key;
		}

		if (this.keyTemplate) {
			let idx = 0;
			let temp = this.keyTemplate.replace(/\#/g, function () {
				return md5.substr(idx++, 1);
			});
			key = Tools.sub(temp, { key: key, md5: md5, ns: ns });
		}

		return key;
	},

	extKey: function (key, orig_key) {
		// possibly add suffix to key, if fileExtensions mode is enabled
		// and key is not binary
		if (this.fileExtensions && !this.storage.isBinaryKey(orig_key)) {
			key += '.json';
		}
		return key;
	},

	put: async function (key, value, callback) {
		// store key+value in s3
		const self = this;
		let orig_key = key;
		let is_binary = this.storage.isBinaryKey(key);
		key = this.prepKey(key);

		let params = {
			Key: this.extKey(key, orig_key),
			Body: value,
			Bucket: this.bucket
		}

		// serialize json if needed
		if (is_binary) {
			this.logDebug(9, "Storing S3 Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing S3 JSON Object: " + key, this.debugLevel(10) ? params.Body : null);
			params.Body = JSON.stringify(params.Body);
			params.ContentType = 'application/json';
		}

		try {
			let data = await this.s3.send(new PutObjectCommand(params))
			self.logDebug(9, "Store complete: " + key);
			if (callback) callback(null, data.$metadata);
		} catch (err) {
			self.logError('s3', "Failed to store object: " + key + ": " + (err.message || err), err);
			if (callback) callback(err, null);
		}

	},

	putStream: async function (key, value, callback) {

		const self = this;
		let orig_key = key;
		key = this.prepKey(key);

		let params = {
			Key: this.extKey(key, orig_key),
			Body: value,
			Bucket: this.bucket
		}

		try {

			let upload = new Upload({
				client: this.s3,
				params: params
			})

			let data = await upload.done()
			self.logDebug(9, "Store complete: " + key);
			if (callback) callback(null, data.$metadata);
		} catch (err) {
			self.logError('s3', "Failed to store object: " + key + ": " + (err.message || err), err);
			if (callback) callback(err, null);
		}

	},

	head: async function (key, callback) {
		// head s3 value given key
		const self = this;
		let orig_key = key;
		key = this.prepKey(key);

		this.logDebug(9, "Pinging S3 Object: " + key);

		// check cache first
		if (this.cache && this.cache.has(orig_key)) {
			process.nextTick(function () {
				let item = self.cache.getMeta(orig_key);
				self.logDebug(9, "Cached head complete: " + orig_key);
				callback(null, {
					mod: item.date,
					len: item.value.length
				});
			});
			return;
		} // cache

		let params = {
			Key: this.extKey(key, orig_key),
			Bucket: this.bucket
		}

		try {

			let data = await this.s3.send(new HeadObjectCommand(params))
			self.logDebug(9, "Head complete: " + key);
			callback(null, {
				mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
				len: data.ContentLength
			});

		} catch (err) {

			if ((err.Code == 'NoSuchKey') || (err.Code == 'NotFound')) {
				// key not found, special case, don't log an error
				// always include "Not found" in error message
				err = new Error("Failed to head key: " + key + ": Not found");
				err.code = "NoSuchKey";
			}
			else {
				// some other error
				self.logError('s3', "Failed to head key: " + key + ": " + (err.message || err), err);
			}
			callback(err, null);
			return;
		}
	},

	get: async function (key, callback) {
		// fetch s3 value given key
		const self = this;
		let orig_key = key;
		let is_binary = this.storage.isBinaryKey(key);
		key = this.prepKey(key);

		this.logDebug(9, "Fetching S3 Object: " + key);

		// check cache first
		if (this.cache && !is_binary && this.cache.has(orig_key)) {
			process.nextTick(function () {		
				let data = self.cache.get(orig_key);
				try { 
					data = JSON.parse(data);
				}
				catch (e) {
					self.logError('file', "Failed to parse JSON record: " + orig_key + ": " + e);
					callback(e, null);
					return;
				}
				self.logDebug(9, "Cached JSON fetch complete: " + orig_key, self.debugLevel(10) ? data : null);

				callback(null, data);
			});
			return;
		} // cache

		let params = {
			Key: this.extKey(key, orig_key),
			Bucket: this.bucket
		}

		try {

			let data = await this.s3.send(new GetObjectCommand(params))

			/**@type {string|Buffer} */
			let body = await stream2buffer(data.Body)

			if (is_binary) {
				self.logDebug(9, "Binary fetch complete: " + key, '' + body.length + ' bytes');
			}
			else {
				body = String(body);

				// possibly cache in LRU
				if (self.cache) {
					self.cache.set(orig_key, body, { date: Tools.timeNow(true) });
				}

				try { body = JSON.parse(body); }
				catch (e) {
					self.logError('s3', "Failed to parse JSON record: " + key + ": " + e);
					console.log(body)
					callback(e, null);
					return;
				}
				self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? body : null);
			}

			callback(null, body, {
				mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
				len: data.ContentLength
			});

		} catch (err) {
			if ((err.Code == 'NoSuchKey') || (err.Code == 'NotFound')) {
				// key not found, special case, don't log an error
				// always include "Not found" in error message
				err = new Error("Failed to fetch key not found: " + key + ": Not found");
				err.code = "NoSuchKey";
			}
			else {
				// some other error
				self.logError('s3', "Failed to fetch key other: " + key + ": " + (err.message || err), err);
			}

			callback(err, null);
			return;
		}

	},

	getStream: async function (key, callback) {
		// get readable stream to record value given key
		const self = this;
		let orig_key = key;
		key = this.prepKey(key);

		this.logDebug(9, "Fetching S3 Stream: " + key);

		let params = { Key: this.extKey(key, orig_key), Bucket: this.bucket };

		try {

			let data = await this.s3.send(new GetObjectCommand(params))

			let download = data.Body

			//var proceed = false;

			download.on('error', function (err) {
				//if (proceed) self.logError('s3', "Failed to download key: " + key + ": " + (err.message || err), err);
				self.logError('s3', "Failed to download key: " + key + ": " + (err.message || err), err);
			});
			download.once('end', function () {
				self.logDebug(9, "S3 stream download complete: " + key);
			});
			download.once('close', function () {
				self.logDebug(9, "S3 stream download closed: " + key);
			});

			callback(null, download, {
				mod: Math.floor((new Date(data.LastModified)).getTime() / 1000),
				len: data.ContentLength
			});
		}
		catch (err) {
			//download.destroy();
			callback(err, null);
			return;
		}

		// Do we really need to invoke head?
		// this.head(key, function (err, data) {
		//     if (err) {
		//         download.destroy();
		//         callback(err, null);
		//         return;
		//     }
		//     proceed = true;
		//     callback(null, download, data);
		// }); // headObject
	},

	delete: async function (key, callback) {
		// delete s3 key given key
		const self = this;
		let orig_key = key;
		key = this.prepKey(key);

		this.logDebug(9, "Deleting S3 Object: " + key);

		let params = {
			Key: this.extKey(key, orig_key),
			Bucket: this.bucket
		}

		try {
			let data = await this.s3.send(new DeleteObjectCommand(params))
			self.logDebug(9, "Delete complete: " + key);
			if (callback) callback(null, data.$metadata);
		}
		catch (err) {
			self.logError('s3', "Failed to delete object: " + key + ": " + (err.message || err), err);
			if (callback) callback(err, null);
		}

		// possibly delete from LRU cache as well
		if (self.cache && self.cache.has(orig_key)) {
			self.cache.delete(orig_key);
		}
	},

	runMaintenance: function (callback) {
		// run daily maintenance
		callback();
	},

	shutdown: function (callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down S3 storage");
		delete this.s3;
		callback();
	}

});
