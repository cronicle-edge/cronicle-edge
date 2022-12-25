// SQL Storage Plugin
// Released under the MIT License

// Requires the 'knex' module from npm
// npm install knex
// also need install db drivers
// for sqlite: npm i sqlite3
// for mysql: npm i mysql2
// for postgres: npm i pg
// for oracle: npm i oracledb
// for mssql: npm i tedious


const Component = require("pixl-server/component");
const { knex, Knex } = require('knex')
const { Readable } = require('stream');

module.exports = class SQLEngine extends Component {

     __name = 'SQLEngine'
    // __parent = Component

    /**
     * @type {Knex}}
     */
    db
    
    /**
     * @type {String}
     */
    tableName  // can set with table property on SQL config. default = cronicle

    /**
     * @type {('sqlite3'|'pg'|'mysql2'|'oracledb'|'mssql')}
     */
    client  // db client type

    getBlobSizeFn = 'length(V)'

    /**
     * @type {String}
     * @description need to use Merge Statement with Oracle/MSSQL
     */
    mergeStmt

    defaultConfig = {
        client: 'sqlite3',
        table: 'cronicle',
        useNullAsDefault: true,
        connection: {
            filename: '/tmp/cronicle.db',
        }
    }

    startup(callback) {
        let publicConf = JSON.parse(JSON.stringify(this.config.get()))
        delete (publicConf.connection || {}).password // hide password on logging
        this.logDebug(2, "Setting up SQL Connection", publicConf);
        this.setup(callback);
    }

    async setup(callback) {
        // setup SQL connection
        const self = this;
        const sql_config = this.config.get();

        this.db = knex(sql_config)

        this.db.client.pool.on('createSuccess', () => {
            self.logDebug(3, "SQL connected successfully")           
        })

        this.tableName = sql_config.table || 'cronicle'

        this.client = sql_config.client
        
        if (this.client === 'mssql') {
            this.getBlobSizeFn = 'len(V)'
            this.mergeStmt = `
            MERGE INTO "${this.tableName}" T 
            USING (SELECT ? as K, ? as V ) S
            ON (s.K = t.K)
            WHEN MATCHED THEN UPDATE SET t.V = s.V, t."updated" = CURRENT_TIMESTAMP
            WHEN NOT MATCHED THEN INSERT (K, V) VALUES (s.K, s.V);     
            `
        }

        if (this.client === 'oracledb') { // need to pass large blob via variable to avoid "too long" error
            this.mergeStmt = `
            DECLARE
            k VARCHAR(256);
            b BLOB;
           BEGIN 
               k := ?;
               b := ?;
               MERGE INTO "${this.tableName}" T
               USING (SELECT k AS K FROM DUAL) S
               ON (s.K = t.K)
               WHEN MATCHED THEN UPDATE SET t.V = b, t."updated" = CURRENT_TIMESTAMP
               WHEN NOT MATCHED THEN INSERT (K, V) VALUES (s.K, b );
           END;     
            `
        }

        // create destiation table if not exists. It should happen while running "control.sh setup"
        if (! await this.db.schema.hasTable(this.tableName)) {
            await this.db.schema
            .createTable(this.tableName, table => {
                table.string('K', 256).primary();
                // default BLOB size for mysql is limited with 64KB
                this.client.startsWith('mysql') ? table.specificType('V', 'longblob') : table.binary('V');
                table.dateTime('created').defaultTo(this.db.fn.now());
                table.dateTime('updated').defaultTo(this.db.fn.now());
                table.index(['updated']);
            })          
        }

        if (!self.storage.started) return callback();
       
    }

    prepKey(key) { // no need to prep key for SQL at this point
        return key;
    }

    /**
     * @param {string | number} key
     * @param {string | Buffer} value
     * @param {(err: Error | null ) => void} callback
     */
    async put(key, value, callback) {
        // store key+value in SQL
        var self = this;
        key = this.prepKey(key);

        if (this.storage.isBinaryKey(key)) {
            this.logDebug(9, "Storing SQL Binary Object: " + key, '' + value.length + ' bytes');
        }
        else {
            this.logDebug(9, "Storing SQL JSON Object: " + key, this.debugLevel(10) ? value : null);
            value = JSON.stringify(value);
        }

        // For oracle/mssql use MERGE statement, for other drivers use "INSEERT/ON CONFLICT" mechanism
        try {
            if (this.mergeStmt) { // this.client === 'mssql' || this.client === 'oracledb'
                await this.db.raw(this.mergeStmt, [ key, Buffer.from(value)])                
            }
            else {
                await this.db(this.tableName)
                    .insert({ K: key, V: Buffer.from(value), updated: this.db.fn.now() })
                    .onConflict('K')
                    .merge()
            }

            self.logDebug(9, "Store complete: " + key);
            if (callback) callback(null);
        }
        catch (err) {
            err.message = "Failed to store object: " + key + ": " + err;
            self.logError('sql', '' + err);
            if (callback) callback(err);

        }

    }

    putStream(key, inp, callback) {
        // store key+value in SQL using read stream
        var self = this;

        // There is no common way to stream BLOBs from SQL
        // So, we have to do this the RAM-hard way...

        var chunks = [];
        inp.on('data', function (chunk) {
            chunks.push(chunk);
        });
        inp.on('end', function () {
            var buf = Buffer.concat(chunks);
            self.put(key, buf, callback);
        });
    }

    async head(key, callback) {
        // head value by given key. Just return blob size
        var self = this;
        key = this.prepKey(key);

        try {
            let rows = await this.db(this.tableName).where('K', key).select([
                this.db.raw(`${this.getBlobSizeFn} as len`),
                this.db.raw('1 as mod')
            ])
            if (rows.length > 0) {
                callback(null, rows[0]);
            }
            else {
                let err = new Error("Failed to head key: " + key + ": Not found");
                err.code = "NoSuchKey";
                callback(err, null);
            }

        }
        catch (err) {
            err.message = "Failed to head key: " + key + ": " + err;
            self.logError('SQL', '' + err);
            callback(err);
        }

    }

    async get(key, callback) {
        // fetch SQL value given key
        var self = this;
        key = this.prepKey(key);

        this.logDebug(9, "Fetching SQL Object: " + key);

        try {
            let data = (await this.db(this.tableName).where('K', key).select(["K as key", 'V as value']))[0] // expected {key: key, value: value}
            let result = (data || {}).value
            if (result) {
                if (self.storage.isBinaryKey(key)) {
                    self.logDebug(9, "Binary fetch complete: " + key, '' + result.length + ' bytes');
                    callback(null, result);
                }
                else {
                    try { result = JSON.parse(result.toString()); }
                    catch (err) {
                        self.logError('sql', "Failed to parse JSON record: " + key + ": " + err);
                        callback(err, null);
                        return;
                    }
                    self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? result : null);
                    callback(null, result);
                }
            }
            else {
                let err = new Error("Failed to fetch key: " + key + ": Not found");
                err.code = "NoSuchKey";
                callback(err, null);
            }

        }
        catch (err) {
            err.message = "Failed to fetch key: " + key + ": " + err;
            self.logError('sql', '' + err);
            callback(err);
        }

    }

    getStream(key, callback) {
        // get readable stream to record value given key
        var self = this;

        // There is no common way to stream BLOB from SQL
        // So, we have to do this the RAM-hard way...

        this.get(key, function (err, buf) {
            if (err) {
                // an actual error
                err.message = "Failed to fetch key: " + key + ": " + err;
                self.logError('SQL', '' + err);
                return callback(err);
            }
            else if (!buf) {
                // record not found
                let ERR = new Error("Failed to fetch key: " + key + ": Not found");
                ERR.code = "NoSuchKey";
                return callback(ERR, null);
            }

            let stream = Readable.from(buf) // new BufferStream(buf);
            callback(null, stream, { mod: 1, len: buf.length });
        });
    }

    getStreamRange(key, start, end, callback) {
        // get readable stream to record value given key and range
        var self = this;

        // There is no common way to stream BLOB from SQL
        // So, we have to do this the RAM-hard way...

        this.get(key, function (err, buf) {
            if (err) {
                // an actual error
                err.message = "Failed to fetch key: " + key + ": " + err;
                self.logError('SQL', '' + err);
                return callback(err);
            }
            else if (!buf) {
                // record not found
                let ERR = new Error("Failed to fetch key: " + key + ": Not found");
                ERR.code = "NoSuchKey";
                return callback(ERR, null);
            }

            // validate byte range, now that we have the head info
            if (isNaN(start) && !isNaN(end)) {
                start = buf.length - end;
                end = buf.length ? buf.length - 1 : 0;
            }
            else if (!isNaN(start) && isNaN(end)) {
                end = buf.length ? buf.length - 1 : 0;
            }
            if (isNaN(start) || isNaN(end) || (start < 0) || (start >= buf.length) || (end < start) || (end >= buf.length)) {
                callback(new Error("Invalid byte range (" + start + '-' + end + ") for key: " + key + " (len: " + buf.length + ")"), null);
                return;
            }

            let range = buf.slice(start, end + 1);
            let stream = Readable.from(range) //new BufferStream(range);
            callback(null, stream, { mod: 1, len: buf.length });
        });
    }

    async delete(key, callback) {
        // delete SQL key given key
        var self = this;
        key = this.prepKey(key);

        this.logDebug(9, "Deleting SQL Object: " + key);

        let ERR

        try {
            let d = await this.db(this.tableName).where('K', key).del()

            if (d > 0) {
                self.logDebug(9, "Delete complete: " + key);
                if (callback) callback(null)
            } else {
                ERR = new Error("Failed to fetch key: " + key + ": Not found");
                ERR.code = "NoSuchKey";

            }

        }
        catch (err) {
            self.logError('sql', "Failed to delete object: " + key + ": " + err);
            ERR = err
        }

        if (callback) callback(ERR)

    }

    runMaintenance(callback) {
        // run daily maintenance
        callback();
    }

    shutdown(callback) {
        // shutdown storage
        this.logDebug(2, "Shutting down SQL");
        this.db.destroy()
        callback();
    }

}

