var Class = require("pixl-class");
var Component = require("pixl-server/component");
var mongoClient = require("mongodb").MongoClient;
var Tools = require("pixl-tools");
const Keyv = require('keyv');
var mongoDBClient = null;
var keyv = null;
module.exports = Class.create({
    __name: 'MongoDB',
    __parent: Component,
    defaultConfig:{
        host:"",
        mongoDB:null,
        password: "",
        serialize: false,
        keyPrefix: "",
        keyTemplate: ""
    },
    startup: function(callback) {
        // setup initial connection
        var self = this;
        this.logDebug(2, "Setting up MongoDB");
        // Connecting to MongoDB
        keyv = new Keyv(this.config.get('host'));
        keyv.on('error', err => {});
        callback();
    },
    prepKey: function(key) {
        // prepare key for S3 based on config
        var md5 = Tools.digestHex(key, 'md5');
        if (this.keyPrefix) {
            key = this.keyPrefix + key;
        }
        if (this.keyTemplate) {
            var idx = 0;
            var temp = this.keyTemplate.replace( /\#/g, function() {
                return md5.substr(idx++, 1);
            } );
            key = Tools.substitute( temp, { key: key, md5: md5 } );
        }
        return key;
    },
    put: function(key, value, callback) {
        var self = this;
        key = this.prepKey(key);
        if (this.storage.isBinaryKey(key)) {
            this.logDebug(9, "Storing Mongo Binary Object: " + key, '' + value.length + ' bytes');
        }
        else {
            this.logDebug(9, "Storing Mongo JSON Object: " + key, this.debugLevel(10) ? value : null);
            if (this.config.get('serialize')) value = JSON.stringify( value );
        }
        keyv.set(key, value).then((result)=>{
            if(result)
                callback();
        }).catch((err)=>{
            callback(err);
        });
    },
    putStream: function(key, inp, callback) {
        // store key+value in MongoDB using read stream
        var self = this;
        var chunks = [];
        inp.on('data', function(chunk) {
            chunks.push( chunk );
        } );
        inp.on('end', function() {
            var buf = Buffer.concat(chunks);
            self.put( key, buf, callback );
        } );
    },
    head: function(key, callback) {
        var self = this;
        this.get( key, function(err, data) {
            if (err) {
                err.message = "Failed to head key: " + key + ": " + err.message;
                callback(err);
            }
            else if (!data) {
                var err = new Error("Failed to head key: " + key + ": Not found");
                err.code = "NoSuchKey";
                callback( err, null );
            }
            else {
                callback( null, { mod: 1, len: data.length } );
            }
        } );
    },
    get: function(key, callback) {
        var self = this;
        key = this.prepKey(key);
        this.logDebug(9, "Fetching KVMongo Object: " + key);
        keyv.get(key).then((result)=>{
            if(!result){
                var keyNotFoundError = new Error("Failed to fetch key: " + key + ": Not found");
                keyNotFoundError.code = "NoSuchKey";
                callback(keyNotFoundError,null);
            }else{
                var body = result;
                if (self.storage.isBinaryKey(key)) {
                }
                else {
                    if (self.config.get('serialize')) {
                        try { body = JSON.parse( body.toString() ); }
                        catch (e) {
                            callback( e, null );
                            return;
                        }
                    }
                }
                callback( null, body );
            }
        }).catch((err)=>{
            //callback(err,null);
        });
    },
    getStream: function(key, callback) {
        var self = this;
        this.get( key, function(err, buf) {
            if (err) {
                err.message = "Failed to fetch key: " + key + ": " + err.message;
                return callback(err);
            }
            else if (!buf) {
                var err = new Error("Failed to fetch key: " + key + ": Not found");
                err.code = "NoSuchKey";
                return callback( err, null );
            }
            var stream = new BufferStream(buf);
            callback(null, stream);
        } );
    },
    delete: function(key, callback) {
        var self = this;
        key = this.prepKey(key);
        this.logDebug(9, "Deleting KVMongo Object: " + key);
        keyv.delete(key).then((result)=>{
            if(result){
                this.logDebug(9, "Delete complete: " + key);
                callback(null);
            }
        }).catch((err)=>{
            this.logDebug(9, "Failed to delete object: " + key + ": " + err.message);
            callback(err);
        });
    },

    runMaintenance: function(callback) {
        callback();
    },
    shutdown: function(callback) {
        this.logDebug(2, "Shutting down MongoDB");
        callback();
    }
});
var util = require('util');
var stream = require('stream');
var BufferStream = function (object, options) {
    if (object instanceof Buffer || typeof object === 'string') {
        options = options || {};
        stream.Readable.call(this, {
            highWaterMark: options.highWaterMark,
            encoding: options.encoding
        });
    } else {
        stream.Readable.call(this, { objectMode: true });
    }
    this._object = object;
};
util.inherits(BufferStream, stream.Readable);
BufferStream.prototype._read = function () {
    this.push(this._object);
    this._object = null;
};