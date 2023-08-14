// Local File Storage Plugin
// Copyright (c) 2015 - 2019 Joseph Huckaby
// Released under the MIT License

var path = require('path');
var fs = require('fs');
var async = require('async');
var crypto = require('crypto');

var Class = require("pixl-class");
var Component = require("pixl-server/component");
var Tools = require("pixl-tools");
var Cache = require("pixl-cache");

const syncMode = process.platform == 'win32' ? 'r+' : 'r'; // transaction fix for WIndows platform (fsync won't work in 'r' mode)

var mkdirp = Tools.mkdirp;

module.exports = Class.create({
	
	__name: 'Filesystem',
	__parent: Component,
	
	startup: function(callback) {
		// setup storage plugin
		var self = this;
		this.logDebug(2, "Setting up filesystem storage");
		
		this.setup();
		this.config.on('reload', function() { self.setup(); } );
		
		// counter so worker temp files don't collide
		this.tempFileCounter = 1;
		
		this.logDebug(3, "Base directory: " + this.baseDir);
		
		callback();
	},
	
	setup: function() {
		// setup storage system (also called for config reload)
		var self = this;
		this.baseDir = this.config.get('base_dir') || process.cwd();
		this.keyNamespaces = this.config.get('key_namespaces') || 0;
		this.pretty = this.config.get('pretty') || 0;
		this.rawFilePaths = this.config.get('raw_file_paths') || 0;
		
		this.keyPrefix = (this.config.get('key_prefix') || '').replace(/^\//, '');
		if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';
		
		this.keyTemplate = (this.config.get('key_template') || '').replace(/^\//, '').replace(/\/$/, '');
		
		// perform some cleanup on baseDir, just in case
		// (baseDir is used as a sentinel for recursive parent dir deletes, so we have to be careful)
		this.baseDir = this.baseDir.replace(/\/$/, '').replace(/\/\//g, '/');
		
		// create initial data dir if necessary
		try {
			mkdirp.sync( this.baseDir ); 
		}
		catch (e) {
			var msg = "FATAL ERROR: Base directory could not be created: " + this.baseDir + ": " + e;
			this.logError('file', msg);
			throw new Error(msg);
		}
		
		// create temp dir
		// (MUST be on same filesystem as base dir, for atomic renames)
		this.tempDir = this.baseDir + '/_temp';
		
		try {
			mkdirp.sync( this.tempDir ); 
		}
		catch (e) {
			var msg = "FATAL ERROR: Temp directory could not be created: " + this.tempDir + ": " + e;
			this.logError('file', msg);
			throw new Error(msg);
		}
		
		// optional LRU cache
		this.cache = null;
		var cache_opts = this.config.get('cache');
		if (cache_opts && cache_opts.enabled) {
			this.logDebug(3, "Setting up LRU cache", cache_opts);
			this.cache = new Cache( Tools.copyHashRemoveKeys(cache_opts, { enabled: 1 }) );
			this.cache.on('expire', function(item, reason) {
				self.logDebug(9, "Expiring LRU cache object: " + item.key + " due to: " + reason, {
					key: item.key,
					reason: reason,
					totalCount: self.cache.count,
					totalBytes: self.cache.bytes
				});
			});
		}
	},
	
	getFilePath: function(key) {
		// get local path to file given storage key
		var file = '';
		
		if (this.rawFilePaths) {
			// file path is raw key, no md5 hashing
			// used for very small apps and testing
			file = this.baseDir + '/' + key;
			if (!key.match(/\.(\w+)$/)) file += '.json';
		}
		else {
			// hash key to get dir structure
			// no need for salt, as this is not for security, 
			// only for distributing the files evenly into a tree of subdirs
			var md5 = Tools.digestHex(key, 'md5');
			
			// locate directory on disk
			var dir = this.baseDir;
			
			if (this.keyPrefix) {
				dir += '/' + this.keyPrefix;
			}
			
			// if key contains a base "dir", use that on disk as well (one level deep only)
			// i.e. users/jhuckaby --> users/01/9a/aa/019aaa6887e5ce3533dcc691b05e69e4.json
			if (this.keyNamespaces) {
				if (key.match(/^([\w\-\.]+)\//)) dir += '/' + RegExp.$1;
				else dir += '/' + key;
			}
			
			if (this.keyTemplate) {
				// apply hashing using key template
				var idx = 0;
				var temp = this.keyTemplate.replace( /\#/g, function() {
					return md5.substr(idx++, 1);
				} );
				file = dir + '/' + Tools.substitute( temp, { key: key, md5: md5 } );
			}
			else {
				// classic legacy md5 hash dir layout, e.g. ##/##/##/[md5]
				dir += '/' + md5.substring(0, 2) + '/' + md5.substring(2, 4) + '/' + md5.substring(4, 6);
				
				// filename is full hash
				file = dir + '/' + md5;
			}
			
			// grab ext from key, or default to json
			// (all binary keys should have a file extension IN THE KEY)
			if (key.match(/\.(\w+)$/)) file += '.' + RegExp.$1;
			else file += '.json';
		}
		
		return file;
	},
	
	_makeDirs: function(dir, perms, callback) {
		// make directories recursively, with retries
		var self = this;
		var retries = 5;
		var last_err = null;
		
		mkdirp( dir, perms, function(err) {
			if (err) {
				// go into retry loop
				self.logDebug(6, "Error creating directory: " + dir + ": " + err + " (will retry)");
				
				async.whilst(
					function() { return( retries >= 0 ); },
					function(callback) {
						mkdirp( dir, perms, function(err) {
							if (err) {
								self.logDebug(6, "Error creating directory: " + dir + ": " + err + " (" + retries + " retries remain)");
								last_err = err;
								retries--;
							}
							else {
								// success, jump out of loop
								last_err = null;
								retries = -1;
							}
							callback();
						} );
					},
					function() {
						callback( last_err );
					}
				); // whilst
			} // err
			else callback();
		} ); // mkdirp
	},
	
	_renameFile: function(source_file, dest_file, callback) {
		// rename file plus mkdir if needed
		var self = this;
		
		fs.rename(source_file, dest_file, function(rn_err) {
			if (!rn_err || (rn_err.code == 'EXDEV')) return callback();
			
			self.logDebug(6, "Error renaming file: " + source_file + " --> " + dest_file + ": " + rn_err + " (will retry)");
			
			// we may need one more mkdir (race condition with delete)
			self._makeDirs( path.dirname(dest_file), 0o0775, function(mk_err) {
				if (mk_err) return callback(rn_err);
				
				// last try
				fs.rename(source_file, dest_file, callback);
			});
		});
	},
	
	put: function(key, value, callback) {
		// store key+value on disk
		var self = this;
		var file = this.getFilePath(key);
		var is_binary = this.storage.isBinaryKey(key);
		
		// serialize json if needed
		if (is_binary) {
			this.logDebug(9, "Storing Binary Object: " + key, '' + value.length + ' bytes');
		}
		else {
			this.logDebug(9, "Storing JSON Object: " + key, this.debugLevel(10) ? value : file);
			value = this.pretty ? JSON.stringify( value, null, "\t" ) : JSON.stringify( value );
		}
		
		var dir = path.dirname( file );
		
		var temp_file = this.tempDir + '/' + path.basename(file) + '.tmp.' + this.tempFileCounter;
		this.tempFileCounter = (this.tempFileCounter + 1) % 10000000;
		
		// write temp file (atomic mode)
		fs.writeFile( temp_file, value, function (err) {
			if (err) {
				// failed to write file
				var msg = "Failed to write file: " + key + ": " + temp_file + ": " + err.message;
				self.logError('file', msg);
				return callback( new Error(msg), null );
			}
			
			// make sure parent dirs exist, async
			self._makeDirs( dir, 0o0775, function(err) {
				if (err) {
					// failed to create directory
					var msg = "Failed to create directory: " + key + ": " + dir + ": " + err.message;
					self.logError('file', msg);
					return callback( new Error(msg), null );
				}
				
				// finally, rename temp file to final
				self._renameFile( temp_file, file, function (err) {
					if (err) {
						// failed to write file
						var msg = "Failed to rename file: " + key + ": " + temp_file + ": " + err.message;
						self.logError('file', msg);
						return callback( new Error(msg), null );
					}
					
					// possibly cache in LRU
					if (self.cache && !is_binary) {
						self.cache.set( key, value, { date: Tools.timeNow(true) } );
					}
					
					// all done
					self.logDebug(9, "Store operation complete: " + key);
					callback(null, null);
				} ); // rename
			} ); // mkdirp
		} ); // temp file
	},
	
	putStream: function(key, inp, callback) {
		// store key+stream of data to disk
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Storing Binary Stream Object: " + key, file);
		
		var dir = path.dirname( file );
		
		var temp_file = this.tempDir + '/' + path.basename(file) + '.tmp.' + this.tempFileCounter;
		this.tempFileCounter = (this.tempFileCounter + 1) % 10000000;
		
		// create the write stream to temp file
		var outp = fs.createWriteStream( temp_file );
		
		outp.on('error', function(err) {
			// failed to write file
			var msg = "Failed to write file: " + key + ": " + temp_file + ": " + err.message;
			self.logError('file', msg);
			return callback( new Error(msg), null );
		} );
		
		outp.on('finish', function() {
			// make sure parent dirs exist, async
			self._makeDirs( dir, 0o0775, function(err) {
				if (err) {
					// failed to create directory
					var msg = "Failed to create directory: " + key + ": " + dir + ": " + err.message;
					self.logError('file', msg);
					return callback( new Error(msg), null );
				}
				
				// rename temp file to final
				self._renameFile( temp_file, file, function (err) {
					if (err) {
						// failed to write file
						var msg = "Failed to rename file: " + key + ": " + temp_file + ": " + err.message;
						self.logError('file', msg);
						return callback( new Error(msg), null );
					}
					
					// all done
					self.logDebug(9, "Store operation complete: " + key);
					callback(null, null);
				} ); // rename
			} ); // mkdirp
		} ); // pipe finish
		
		// pipe inp to outp
		inp.pipe( outp );
	},
	
	putStreamCustom: function(key, inp, opts, callback) {
		// store key+stream of data to disk
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Storing Binary Stream Object: " + key, file);
		
		var dir = path.dirname( file );
		
		var temp_file = this.tempDir + '/' + path.basename(file) + '.tmp.' + this.tempFileCounter;
		this.tempFileCounter = (this.tempFileCounter + 1) % 10000000;
		
		// create the write stream to temp file
		var outp = fs.createWriteStream( temp_file, opts || {} );
		
		outp.on('error', function(err) {
			// failed to write file
			var msg = "Failed to write file: " + key + ": " + temp_file + ": " + err.message;
			self.logError('file', msg);
			return callback( new Error(msg), null );
		} );
		
		outp.on('finish', function() {
			// make sure parent dirs exist, async
			self._makeDirs( dir, 0o0775, function(err) {
				if (err) {
					// failed to create directory
					var msg = "Failed to create directory: " + key + ": " + dir + ": " + err.message;
					self.logError('file', msg);
					return callback( new Error(msg), null );
				}
				
				// rename temp file to final
				self._renameFile( temp_file, file, function (err) {
					if (err) {
						// failed to write file
						var msg = "Failed to rename file: " + key + ": " + temp_file + ": " + err.message;
						self.logError('file', msg);
						return callback( new Error(msg), null );
					}
					
					// all done
					self.logDebug(9, "Store operation complete: " + key);
					callback(null, null);
				} ); // rename
			} ); // mkdirp
		} ); // pipe finish
		
		// pipe inp to outp
		inp.pipe( outp );
	},
	
	head: function(key, callback) {
		// head value given key
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Pinging Object: " + key, file);
		
		// check cache first
		if (this.cache && this.cache.has(key)) {
			var item = this.cache.getMeta(key);
			
			process.nextTick( function() {
				self.logDebug(9, "Cached head complete: " + key);
				callback( null, {
					mod: item.date,
					len: item.value.length
				} );
			} );
			return;
		} // cache
		
		fs.stat(file, function(err, stats) {
			if (err) {
				if (err.message.match(/ENOENT/)) {
					err.message = "File not found";
					err.code = "NoSuchKey";
				}
				else {
					// log fs errors that aren't simple missing files (i.e. I/O errors)
					self.logError('file', "Failed to stat file: " + key + ": " + file + ": " + err.message);
				}
				
				err.message = "Failed to head key: " + key + ": " + err.message;
				return callback( err, null );
			}
			
			self.logDebug(9, "Head complete: " + key);
			callback( null, {
				mod: Math.floor(stats.mtime.getTime() / 1000),
				len: stats.size
			} );
		} );
	},
	
	get: function(key, callback) {
		// fetch value given key
		var self = this;
		var file = this.getFilePath(key);
		var is_binary = this.storage.isBinaryKey(key);
		
		this.logDebug(9, "Fetching Object: " + key, file);
		
		// check cache first
		if (this.cache && !is_binary && this.cache.has(key)) {
			var data = this.cache.get(key);
			
			process.nextTick( function() {
				try { data = JSON.parse( data ); }
				catch (e) {
					self.logError('file', "Failed to parse JSON record: " + key + ": " + e);
					callback( e, null );
					return;
				}
				self.logDebug(9, "Cached JSON fetch complete: " + key, self.debugLevel(10) ? data : null);
				
				callback( null, data );
			} );
			return;
		} // cache
		
		var opts = {};
		if (!this.storage.isBinaryKey(key)) opts = { encoding: 'utf8' };
		
		fs.readFile(file, opts, function (err, data) {
			if (err) {
				if (err.message.match(/ENOENT/)) {
					err.message = "File not found";
					err.code = "NoSuchKey";
				}
				else {
					// log fs errors that aren't simple missing files (i.e. I/O errors)
					self.logError('file', "Failed to read file: " + key + ": " + file + ": " + err.message);
				}
				
				err.message = "Failed to fetch key: " + key + ": " + err.message;
				return callback( err, null );
			}
			
			// possibly cache in LRU
			if (self.cache && !is_binary) {
				self.cache.set( key, data, { date: Tools.timeNow(true) } );
			}
			
			if (!is_binary) {
				try { data = JSON.parse( data ); }
				catch (e) {
					self.logError('file', "Failed to parse JSON record: " + key + ": " + e);
					callback( e, null );
					return;
				}
				self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? data : null);
			}
			else {
				self.logDebug(9, "Binary fetch complete: " + key, '' + data.length + ' bytes');
			}
			
			callback( null, data );
		} );
	},
	
	getStream: function(key, callback) {
		// get readable stream to record value given key
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Fetching Binary Stream: " + key, file);
		
		// make sure record exists
		fs.stat(file, function(err, stats) {
			if (err) {
				if (err.message.match(/ENOENT/)) {
					err.message = "File not found";
					err.code = "NoSuchKey";
				}
				else {
					// log fs errors that aren't simple missing files (i.e. I/O errors)
					self.logError('file', "Failed to stat file: " + key + ": " + file + ": " + err.message);
				}
				
				err.message = "Failed to head key: " + key + ": " + err.message;
				return callback( err, null );
			}
			
			// create read stream
			var inp = fs.createReadStream( file );
			
			callback( null, inp, {
				mod: Math.floor(stats.mtime.getTime() / 1000),
				len: stats.size
			} );
		} );
	},
	
	getStreamRange: function(key, start, end, callback) {
		// get readable stream to record value given key and byte range
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Fetching ranged binary stream: " + key, { file, start, end } );
		
		// make sure record exists
		fs.stat(file, function(err, stats) {
			if (err) {
				if (err.message.match(/ENOENT/)) {
					err.message = "File not found";
					err.code = "NoSuchKey";
				}
				else {
					// log fs errors that aren't simple missing files (i.e. I/O errors)
					self.logError('file', "Failed to stat file: " + key + ": " + file + ": " + err.message);
				}
				
				err.message = "Failed to head key: " + key + ": " + err.message;
				return callback( err, null );
			}
			
			// validate byte range, now that we have the head info
			if (isNaN(start) && !isNaN(end)) {
				start = stats.size - end;
				end = stats.size ? stats.size - 1 : 0;
			} 
			else if (!isNaN(start) && isNaN(end)) {
				end = stats.size ? stats.size - 1 : 0;
			}
			if (isNaN(start) || isNaN(end) || (start < 0) || (start >= stats.size) || (end < start) || (end >= stats.size)) {
				download.destroy();
				callback( new Error("Invalid byte range (" + start + '-' + end + ") for key: " + key + " (len: " + stats.size + ")"), null );
				return;
			}
			
			// create read stream
			var inp = fs.createReadStream( file, { start, end } );
			
			callback( null, inp, {
				mod: Math.floor(stats.mtime.getTime() / 1000),
				len: stats.size
			} );
		} );
	},
	
	delete: function(key, callback) {
		// delete key given key
		var self = this;
		var file = this.getFilePath(key);
		
		this.logDebug(9, "Deleting Object: " + key, file);
		
		fs.unlink(file, function(err) {
			if (err) {
				if (err.message.match(/ENOENT/)) {
					err.message = "File not found";
					err.code = "NoSuchKey";
				}
				
				self.logError('file', "Failed to delete file: " + key + ": " + file + ": " + err.message);
				
				err.message = "Failed to delete key: " + key + ": " + err.message;
				return callback( err );
			}
			else {
				self.logDebug(9, "Delete complete: " + key);
				
				// possibly delete from LRU cache as well
				if (self.cache && self.cache.has(key)) {
					self.cache.delete(key);
				}
				
				// cleanup parent dirs if empty
				var done = false;
				var dir = path.dirname(file);
				
				if (dir != self.baseDir) {
					async.whilst(
						function() { 
							return (!done); 
						},
						function(callback) {
							fs.rmdir( dir, function(err) {
								if (err) {
									// dir has files, we're done
									done = true;
								}
								else {
									// success -- do we need to go shallower?
									self.logDebug(9, "Deleted empty parent dir: " + dir);
									
									dir = path.dirname( dir );
									if (dir == self.baseDir) {
										// cannot go any further
										done = true;
									}
								} // success
								callback();
							} ); // rmdir
						},
						callback
					);
				}
				else return callback();
			} // success
		} ); // unlink
	},
	
	sync: function(key, callback) {
		// sync data to disk for given key (i.e. fsync)
		var self = this;
		if (this.config.get('no_fsync')) return process.nextTick( callback );
		
		var file = this.getFilePath(key);
		this.logDebug(9, "Synchronizing Object: " + key, file);
		
		// fsync new file to make sure it is really written to disk
		fs.open( file, syncMode, function(err, fh) {
			if (err) {
				var msg = "Failed to open file: " + key + ": " + file + ": " + err.message;
				self.logError('file', msg);
				return callback( new Error(msg) );
			}
			
			fs.fsync(fh, function(err) {
				if (err) {
					var msg = "Failed to fsync file: " + key + ": " + file + ": " + err.message;
					self.logError('file', msg);
					return callback( new Error(msg) );
				}
				
				fs.close(fh, function(err) {
					if (err) {
						var msg = "Failed to close file: " + key + ": " + file + ": " + err.message;
						self.logError('file', msg);
						return callback( new Error(msg) );
					}
					
					// all done
					self.logDebug(9, "Sync operation complete: " + key);
					callback();
				}); // fs.close
			}); // fs.fsync
		}); // fs.open
	},
	
	runMaintenance: function(callback) {
		// run daily maintenance - delete old temp files
		var self = this;
		var now = Tools.timeNow(true);
		
		fs.readdir( this.tempDir, function(err, files) {
			if (err) return callback();
			
			if (files && files.length) {
				// temp dir has files
				async.eachSeries( files, function(file, callback) {
					// stat each file to get mod date
					file = self.tempDir + '/' + file;
					
					fs.stat( file, function(err, stats) {
						if (err) return callback();
						
						if (stats && stats.isFile()) {
							// file is an ordinary file
							var mod = stats.mtime.getTime() / 1000;
							if (mod < now - 43200) {
								// file is old, delete it
								self.logDebug(9, "Deleting old temp file: " + file);
								fs.unlink( file, callback );
							}
							else callback();
						}
						else callback();
					} );
				},
				function(err) {
					if (err) self.logError('maint', "Failed to cleanup temp dir: " + err);
					callback();
				} );
			} // got files
			else callback();
		} );
	},
	
	shutdown: function(callback) {
		// shutdown storage
		this.logDebug(2, "Shutting down file storage");
		callback();
	}
	
});