// Requires the 'level' module from npm
// npm install level

// sample config
// "Storage": {
// 	"engine": "Level",
// 	"list_page_size": 50,
// 	"concurrency": 4,
//  "log_event_types": { "get": 1, "put": 1, "head": 1, "delete": 1, "expire_set": 1 },
//   "Level": {"dbpath":"level-data"}       
// },

const Component = require("pixl-server/component");
const { Level } = require('level')
const { Readable } = require('stream');

class NoSuchKeyError extends Error {
	constructor(key = 'key', crudOp = 'Fetch' ) {
		super(`Failed to ${crudOp} key: ${key}: Not found`)
	}
	code = "NoSuchKey"
}

module.exports = class LevelEngine extends Component {

	__name = 'LevelDb'
	// __parent = Component

	defaultConfig = {
		dbpath: 'level-data'
	}


	l_config;

	startup(callback) {
		// setup LevelDb 
		this.l_config = this.config.get();

		this.l_config.valueEncoding = 'json'

		this.dbpath = this.l_config.dbpath

		this.logDebug(2, "Opening LevelDb:", this.dbpath)

		this.setup(callback);
	}

	async setup(callback) {

		this.l_config
		
		this.db = new Level(this.dbpath, this.l_config)
        
		// if db is in use by other process we'll get an error here
		await this.db.open()

		callback();
	}

	prepKey(key) {
		// key prep is mainly meant for FS an S3, just keep it for compatibility
		return key;
	}

	async put(key, value, callback) {

		// const self = this
		let isBinary = this.storage.isBinaryKey(key)
        let err 

		isBinary ? this.logDebug(9, `Storing Level Binary Object: ${key} ${value.length} bytes`) :
		this.logDebug(9, "Storing Level JSON Object: " + key, this.debugLevel(10) ? value : null)

		try {
            
			await this.db.put(key, value, {valueEncoding: isBinary ? 'buffer' : 'json' })
			this.logDebug(9, "Store complete: " + key);
		}
		catch (err) {
			err.message = "Failed to store object: " + key + ": " + err;
			this.logError('level', '' + err);			
		}
        finally {
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
		
		try {
			await this.db.keys({ gte: key, lte: key }).next() ? 
			   callback(null, { mod: 1, len: 0}) : callback(new NoSuchKeyError(key, 'head'), null)	
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

		this.logDebug(9, "Fetching Level Object: " + key);

		let isBinary = self.storage.isBinaryKey(key)

		this.db.get(key, { valueEncoding: isBinary ? 'buffer' : 'json' }, function (err, result) {

			// "NoFound" will raise an error
			if (err) {
			    err.message.includes('NotFound') ? err.code = 'NoSuchKey' : self.logError('leveldb', err.code);
				err.message = "Failed to fetch key: " + key + ": " + err.message;
				callback(err, null)
			}
			else {
				isBinary ? self.logDebug(9, `Binary fetch complete: ${key} ${result.length} bytes`) :
					self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? result : null)

				callback(null, result);
			}
		})
	}

	getStream(key, callback) {
		// get readable stream to record value given key
		const self = this;

		// The Level API has no stream support.
		// So, we have to do this the RAM-hard way...

		this.get(key, function (err, buf) {
			if (err) {
				// an actual error
				err.message = "Failed to fetch key: " + key + ": " + err;
				self.logError('level', '' + err);
				return callback(err);
			}

			buf ? callback(null, Readable.from(buf), { mod: 1, len: buf.length }) : callback(new NoSuchKeyError(key), null)

		});
	}


	delete(key, callback) {

		var self = this;
		key = this.prepKey(key);

		this.logDebug(9, "Deleting LevelDb Object: " + key);

		this.db.del(key, function (err, deleted) {
			// fyi - deleted will always be undefined, even if key does not exist
			err ? self.logError('level', "Failed to delete object: " + key + ": " + err) : self.logDebug(9, "Delete complete: " + key);

			callback(err);
		});
	}

	runMaintenance(callback) {
		// run daily maintenance
        const self = this;

        // perform compaction
        this.db.compactRange(null, null)
         .then( d=> {self.logDebug(3, 'DB compaction completed', self.dbpath)})
         .catch(e=>{self.logError('level', 'Failed to perform compaction', err.message)})
		callback();
	}

	shutdown(callback) {
		// shutdown storage
		this.logDebug(2, "Closing Level", this.dbpath);
		if (this.db) this.db.close();
		callback();
	}

}
