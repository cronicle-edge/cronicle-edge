
const path = require('path');
const Sftp = require('ssh2-sftp-client')
const Component = require("pixl-server/component");
// const Component = require('pixl-component') <== can use this for dev
const Tools = require("pixl-tools");

module.exports = class SftpEngine extends Component {

    __name = 'Sftp'

    /** @type {Sftp} */
    sftp;

    shuttingDown = false;

    connected = false;

    /** @type {import('ssh2').ConnectConfig} */
    sconf;

    stopHealthCheck = () => { };

    async sleep(ms) {
        const self = this
        return new Promise((resolve, reject) => {
            let t = setTimeout(resolve, ms)
            self.stopHealthCheck = () => {
                clearTimeout(t)
                reject(new Error('Sleep Canceled'))
            }
        })
    }

    async startHealthCheck(heartbitms) {

        while (!this.shuttingDown) {

            try {

                if (!this.connected) {
                    this.logDebug(3, 'Sftp connection lost, reconnecting')
                    await this.connect()
                }
                else {
                    this.logDebug(10, 'Sftp HealthCheck: OK')
                }

                await this.sleep(heartbitms)

            } catch (err) {
                this.logDebug(3, 'Shutting down Healthcheck')
                return
            }
        }
    }

    async connect() {

        const self = this

        self.connected = false

        if (this.sftp) {
            // need to reset client to avoid issues with listeners
            this.sftp.client.removeAllListeners('close')
            this.sftp.client.removeAllListeners('error')
            this.sftp.client.destroy() // not using end() to avoid hanging
        }
        this.sftp = new Sftp()
        // this.sftp.client.setMaxListeners(20)
        this.sftp.client.on('error', (e) => { this.logError('sftp', 'Sftp Connection error:', e.message) })
        this.sftp.client.on('close', () => { self.connected = false; self.logDebug(3, 'Sftp Connection closed') })

        try {
            await this.sftp.connect(this.sconf)
            await this.sftp.mkdir(this.baseDir) // touch base dir
            await this.sftp.mkdir(this.tempDir) // touch temp dir
            this.connected = true
            self.logDebug(3, 'Connected to Sftp', this.sconf.host)
        }
        catch (err) {
            self.logError('sftp', 'Failed to set up connection', err.message)
        }

    }

    loadConfig() {

        let conf = this.config.get('connection')
        conf.keepaliveInterval = conf.keepaliveInterval || 2000
        conf.keepaliveCountMax = conf.keepaliveCountMax || 3
        conf.readyTimeout = conf.readyTimeout || 5000

        this.sconf = conf

        this.baseDir = this.config.get('base_dir') || 'cronicle'
        this.keyNamespaces = this.config.get('key_namespaces') || 0;
        this.pretty = this.config.get('pretty') || 0;
        this.rawFilePaths = this.config.get('raw_file_paths') || 0;

        this.keyPrefix = (this.config.get('key_prefix') || '').replace(/^\//, '');
        if (this.keyPrefix && !this.keyPrefix.match(/\/$/)) this.keyPrefix += '/';

        this.keyTemplate = (this.config.get('key_template') || '').replace(/^\//, '').replace(/\/$/, '');

        // counter so worker temp files don't collide
        this.tempFileCounter = 1;

        // perform some cleanup on baseDir, just in case
        // (baseDir is used as a sentinel for recursive parent dir deletes, so we have to be careful)
        this.baseDir = this.baseDir.replace(/\/$/, '').replace(/\/\//g, '/');
        this.tempDir = this.baseDir + '/_temp'
        this.heartbitms = this.config.get('heartbitms') || 5000

    }

    async startup(callback) {
        // setup storage plugin
        const self = this

        this.loadConfig()

        // config hot reload
        this.config.on('reload', function () {
            self.logDebug(3, 'Reloading config')
            self.loadConfig()
            self.sftp.end() // this will trigger client reconnect
            self.connected = false
        });

        this.logDebug(2, "Setting up Sftp", Tools.copyHashRemoveKeys(this.sconf, { password: 1 }));

        await this.setup();

        callback()

    }

    async setup() {

        await this.connect()

        this.startHealthCheck(this.heartbitms) // start healthcheck on background
    }

    getFilePath(key) {
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
                var temp = this.keyTemplate.replace(/\#/g, function () {
                    return md5.substr(idx++, 1);
                });
                file = dir + '/' + Tools.substitute(temp, { key: key, md5: md5 });
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
    }


    async put(key, value, callback) {
        // store key+value on disk
        const self = this;
        let file = this.getFilePath(key);
        let is_binary = this.storage.isBinaryKey(key);

        // serialize json if needed
        if (is_binary) {
            this.logDebug(9, "Storing Binary Object: " + key, '' + value.length + ' bytes');
        }
        else {
            this.logDebug(9, "Storing JSON Object: " + key, this.debugLevel(10) ? value : file);
            value = Buffer.from(JSON.stringify(value));
        }

        try {
            let temp_file = this.tempDir + '/' + path.basename(file) + '.tmp.' + this.tempFileCounter;
            this.tempFileCounter = (this.tempFileCounter + 1) % 10000000;
            await this.sftp.put(value, temp_file)
            await this.sftp.mkdir(path.dirname(file), true) // make dirs
            await this.sftp.posixRename(temp_file, file)

            self.logDebug(9, "Store operation complete: " + key);
            callback(null, null);
        }
        catch (err) {
            var msg = "Failed to write file: " + key + ": " + ": " + err.message;
            self.logError('sftp', msg);
            return callback(err, null);
        }

    }

    async putStream(key, inp, callback) {

        const self = this;
        let file = this.getFilePath(key);

        try {
            let temp_file = this.tempDir + '/' + path.basename(file) + '.tmp.' + this.tempFileCounter;
            this.tempFileCounter = (this.tempFileCounter + 1) % 10000000;
            await this.sftp.put(inp, temp_file)
            await this.sftp.mkdir(path.dirname(file), true)
            await this.sftp.posixRename(temp_file, file)
            self.logDebug(9, "Store operation complete: " + key);
            callback()
        }
        catch (err) {
            var msg = "Failed to write stream: " + key + ": " + ": " + err.message;
            self.logError('sftp', msg);
            return callback(err, null);
        }

    }


    async head(key, callback) {
        // head value given key
        var self = this;
        var file = this.getFilePath(key);

        this.logDebug(9, "Pinging Object: " + key, file);

        try {
            let stats = await this.sftp.stat(file)
            self.logDebug(9, "Head complete: " + key);
            callback(null, {
                mod: 1,
                len: stats.size
            });
        }
        catch (err) {
            if (err.code == 2) {
                err.message = "File not found";
                err.code = "NoSuchKey";
            }
            else {
                // log fs errors that aren't simple missing files (i.e. I/O errors)
                self.logError('file', "Failed to stat file: " + key + ": " + file + ": " + err.message);
            }

            err.message = "Failed to head key: " + key + ": " + err.message;
            return callback(err, null);
        }

    }

    async get(key, callback) {
        // fetch value given key
        const self = this;
        const file = this.getFilePath(key);

        this.logDebug(9, "Fetching Object: " + key, file);

        try {

            let buff = await this.sftp.get(file)

            if (this.storage.isBinaryKey(key)) {
                self.logDebug(9, "Binary fetch complete: " + key, '' + buff.length + ' bytes')
                callback(null, buff)
            }
            else {
                let data = JSON.parse(buff)
                self.logDebug(9, "JSON fetch complete: " + key, self.debugLevel(10) ? data : null)
                callback(null, data)
            }
        }
        catch (err) {
            if (err.code == 2) {
                err.message = "File not found";
                err.code = "NoSuchKey";
            }
            else {
                err.message = "Failed to fetch key: " + key + ": " + err.message;
                self.logError(err.message + ": " + err);
            }
            return callback(err, null);

        }

    }

    async getStream(key, callback) {
        // get readable stream to record value given key
        const self = this;
        const file = this.getFilePath(key);
        this.logDebug(9, "Fetching Binary Stream: " + key, file);

        try {

            let stats = await this.sftp.stat(file)
            let stream = this.sftp.createReadStream(file)
            callback(null, stream, { mod: 1, len: stats.size })
        }
        catch (err) {
            if (err.code == 2) {
                err.message = "File not found";
                err.code = "NoSuchKey";
            }
            else {
                // log fs errors that aren't simple missing files (i.e. I/O errors)
                self.logError('file', "Failed to fetch file: " + key + ": " + file + ": " + err.message);
            }
            callback(err, null);

        }
    }


    async delete(key, callback) {
        // delete key given key
        const self = this;
        const file = this.getFilePath(key);

        this.logDebug(9, "Deleting Object: " + key, file);

        try {
            await this.sftp.delete(file)
            self.logDebug(9, "Delete complete: " + key);

            // delete empty folder

            let done = false;
            let dir = path.dirname(file);

            if (dir != self.baseDir) {
                while (!done) {
                    try {
                        await self.sftp.rmdir(dir) // will only remove empty folder
                        self.logDebug(9, "Deleted empty parent dir: " + dir);
                        dir = path.dirname(dir);
                        if (dir == self.baseDir) {
                            // cannot go any further
                            done = true;
                        }

                    }
                    catch (err) { // folder is not empty
                        done = true
                    }
                }
            }

            callback()

        }
        catch (err) {
            if (err.code == 2) {
                err.message = "File not found";
                err.code = "NoSuchKey";
            }

            self.logError('sftp', "Failed to delete file: " + key + ": " + file + ": " + err.message);

            err.message = "Failed to delete key: " + key + ": " + err.message;
            return callback(err);

        }
    }


    async runMaintenance(callback) {

        // run daily maintenance - delete old temp files
        var self = this;
        var now = Tools.timeNow(true);

        try {
            self.logDebug(3, 'Running Sftp Maintenance')

            let files = await self.sftp.list(self.tempDir)

            if(files && files.length > 0) {
                
                for(let i = 0; i< files.length; i++) {
                    let f = files[i]
                    if( f.modifyTime / 1000 < now - 60*60*12 && f.type == '-' ) { // file older than 12h
                        self.logDebug(3, 'Deleteing file', f.name)
                        await self.sftp.delete(path.join(self.tempDir, f.name))
                    }
                    
                }
            }

            self.logDebug(3, 'Sftp Maintenance complete')
        }
        catch(err) {
            self.logError('maint', "Failed to cleanup temp dir: " + err);
        }
        finally {
            if(callback) callback()
        }

    }

    async shutdown(callback) {
        // shutdown storage
        this.shuttingDown = true
        this.logDebug(2, "Shutting down sftp storage");
        this.stopHealthCheck()
        this.sftp.client.destroy()
        callback();
    }

}
