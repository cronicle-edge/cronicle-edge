// Requires the 'lmdb' module from npm
// npm install lmdb

// sample config
// "Storage": {
//     "engine": "Lmdb",
//     "list_page_size": 50,
//     "concurrency": 4,
//     "log_event_types": { "get": 1, "put": 1, "head": 1, "delete": 1, "expire_set": 1 },
//     "Lmdb": {"dbpath":"lmdb-data", "compression":true }    
// },

const Component = require("pixl-server/component");
const { Readable } = require('stream');
const lmdb = require("lmdb");

class NoSuchKeyError extends Error {
	constructor(key = 'key', crudOp = 'Fetch') {
		super(`Failed to ${crudOp} key: ${key}: Not found`)
	}
	code = "NoSuchKey"
}

module.exports = class LmdbEngine extends Component {

	__name = 'Lmdb'

	defaultConfig = {
		dbpath: 'data-lmdb',
		compression: true
	}

	startup(callback) {
		// setup LevelDb 
		const l_config = this.config.get();

		this.dbpath = l_config.dbpath

		this.logDebug(2, "Opening lmdb:", this.dbpath)

		this.setup(callback);
	}

	async setup(callback) {

		const self = this;

		let db = lmdb.open(this.dbpath, { valueEncoding: 'json' })
		this.db = db

		// // if db is in use by other process we'll get an error here
		// await this.db.open()
		
		if(this.storage.config.get('trans')) {
			// beginTransaction
            db.transactionSync(() => new Promise(resolve => self.commit = resolve));
			
		}

		callback();
	}

	prepKey(key) {
		// key prep is mainly meant for FS an S3, just keep it for compatibility
		return key;
	}

	async put(key, value, callback) {

		const self = this
		let isBinary = this.storage.isBinaryKey(key)

		isBinary ? self.logDebug(9, `Storing Level Binary Object: ${key} ${value.length} bytes`) :
			self.logDebug(9, "Storing Redis JSON Object: " + key, self.debugLevel(10) ? value : null)

		try { // no need for special handling of buffers, lmdb can serialize it
			await self.db.put(key, value)
			self.logDebug(9, "Store complete: " + key);

			if (callback) callback(null);
		}
		catch (err) {
			err.message = "Failed to store object: " + key + ": " + err;
			self.logError('error', '' + err);
			if (callback) callback(err);
		}		
	}

	putStream(key, inp, callback) {
		// store key+value in LevelDb using read stream
		const self = this;

		// The LevelDb API has no stream support.
		// So, we have to do this the RAM-hard way...

		let chunks = [];
		inp.on('data', function (chunk) {
			chunks.push(chunk);
		});
		inp.on('end', function () {
			let buf = Buffer.concat(chunks);
			self.put(key, buf, callback);
		});
	}

	async head(key, callback) {

		key = this.prepKey(key)

		try {

			if (this.db.doesExist(key)) {
				callback(null, { mod: 1, len: 0 })
			}
			else {
				callback(new NoSuchKeyError(key), null)
			}
		}
		catch (err) {
			err.message = "Failed to head key: " + key + ": " + err.message;
			this.logError('level', '' + err);
			callback(err, null);
		}
	}

	get(key, callback) {
		// fetch LevelDB value by given key
		const self = this;
		
		key = this.prepKey(key);

		let isBinary = self.storage.isBinaryKey(key)

		this.logDebug(9, "Fetching LevelDb Object: " + key);

		let getError = null;
		let val = null

		// lmdb's get is sync

		try {
			val = this.db.get(key)
			if (val === undefined) getError = new NoSuchKeyError(key)
			isBinary ? self.logDebug(9, `Binary fetch complete: ${key} ${val.length} bytes`) :
				self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? result : null)

		}
		catch (err) {
			self.logError('lmdb', 'Failed to fetch key', err);

		}
		finally {
			callback(getError, val)
		}
		
	}

	getStream(key, callback) {

		var self = this;

		// The Lmdb API has no stream support.
		// So, we have to do this the RAM-hard way...

		try {
			let buf = this.db.get(key)
			if (!buf) return callback(new NoSuchKeyError(key), null);
			callback(null, Readable.from(buf), { mod: 1, len: buf.length });
		} catch (err) {
			err.message = "Failed to fetch key: " + key + ": " + err;
			self.logError('lmdb', '' + err);
			return callback(err);
		}

	}


	async delete(key, callback) {
		// delete LevelDb key given key
		var self = this;
		key = this.prepKey(key);

		this.logDebug(9, "Deleting LevelDb Object: " + key);

		let delError = null;

		try {
			delError = await this.db.del(key) ? self.logDebug(9, "Delete complete: " + key) : new NoSuchKeyError(key)
		}
		catch (err) {
			self.logDebug(9, "Delete complete: " + key);
			delError = err
		}

		callback(delError)

	}

	runMaintenance(callback) {
		// run daily maintenance
		callback();
	}

	async shutdown(callback) {
		// shutdown storage
		this.logDebug(2, "Closing Lmdb");
		if(this.commit) await this.commit();
		if (this.db) await this.db.close();
		callback();
	}

}

