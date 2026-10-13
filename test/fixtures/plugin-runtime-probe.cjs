const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const originalLoad = Module._load;

class DockerProbe {
	constructor() {
		this.modem = {
			host: null,
			protocol: null,
			demuxStream: function() {},
			followProgress: function(stream, callback) { callback(); }
		};
	}

	getImage() { return {}; }
	getVolume() { return { remove: async function() {} }; }
	async pull() { return new PassThrough(); }

	async createContainer(options) {
		process.stdout.write('DOCKER_ENV_PROBE=' + JSON.stringify(options.Env) + '\n');
		return {
			modem: this.modem,
			putArchive: async function() {},
			attach: async function() { return new PassThrough(); },
			inspect: async function() { return { Mounts: [] }; },
			start: async function() {},
			wait: async function() { return { StatusCode: 0 }; }
		};
	}
}

class SSHProbeClient extends EventEmitter {
	connect() {
		process.nextTick(() => this.emit('ready'));
		return this;
	}

	exec(command, options, callback) {
		if (typeof options === 'function') {
			callback = options;
		}
		const stream = new EventEmitter();
		stream.stderr = new EventEmitter();
		let input = '';
		stream.stdin = {
			write: function(chunk) { input += String(chunk); },
			end: function() {
				process.stdout.write(
					'SSHX_SCRIPT_PROBE=' + Buffer.from(input).toString('base64') + '\n'
				);
				process.nextTick(() => stream.emit('close', 0, null));
			}
		};
		callback(null, stream);
	}

	end() {}
}

Module._load = function(request, parent, isMain) {
	if (request === 'dockerode') return DockerProbe;
	if (request === 'ssh2') return { Client: SSHProbeClient };
	return originalLoad.call(this, request, parent, isMain);
};
