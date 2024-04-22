#!/usr/bin/env node

const Docker = require('dockerode');
const tar = require('tar-stream')
const { Writable } = require('stream');
const { EOL } = require('os');
const path = require('path')
const fs = require('fs')

// cronicle should send job json to stdin
let job = {}
try { job = JSON.parse(fs.readFileSync(process.stdin.fd)) } catch { }

// helpers functions
const print = (text) => process.stdout.write(text + EOL)
const printInfo = (text) => process.stdout.write(`[INFO] \x1b[32m${text}\x1b[0m` + EOL)
const printWarning = (text) => process.stdout.write(`[INFO] \x1b[33m${text}\x1b[0m` + EOL)
const printError = (text) => process.stdout.write(`\x1b[31m${text}\x1b[0m` + EOL)
const printJSONMessage = (complete, code, description) => {
    let msg = JSON.stringify({ complete: complete, code: code, description: description })
    process.stdout.write(msg + EOL)
}

const exit = (message) => {
    printJSONMessage(1, 1, message)
    if (process.connected) process.disconnect()
    process.exit(1)
}

let dockerOpts = {}

let registryAuth = {
    username: process.env['DOCKER_USER'],
    password: process.env['DOCKER_PASSWORD'] 
}

// check if user specified DOCKER_HOST. If not just user socket default connection
let dh = process.env['DOCKER_HOST']

if (dh) { 
    try { // resolve password/user from uri        
        let uri = new URL(process.env[dh] || dh) // uri could be passed as a reference to env var
        if(uri.password) dockerOpts.password = decodeURIComponent(uri.password)
        if(uri.username) dockerOpts.username = uri.username
        
        // for ssh:// also check env variables for auth
        if(process.env['SSH_PASSWORD'] && uri.protocol.startsWith('ssh')) dockerOpts.password = process.env['SSH_PASSWORD']
        if(process.env['SSH_KEY'] && uri.protocol.startsWith('ssh')) dockerOpts.sshOptions = { privateKey: process.env['SSH_KEY'] }

    } catch (e) {
        printError('Invalid DOCKER HOST format, use ssh://user:password@host:port or http://host:2375')
        exit(e.message)
    }
}


// DOCKER CLIENT 

const docker = new Docker(dockerOpts)

// CONTAINER PARAMETERS 
const ENTRYPOINT_PATH = process.env['ENTRYPOINT_PATH'] || '/cronicle.sh'
const cname = 'cronicle-' + (process.env['JOB_ID'] || process.pid)
let imageName = process.env['IMAGE'] || 'alpine'
let network = process.env['NETWORK']
let script = process.env['SCRIPT'] ?? "#!/bin/sh\necho 'No script specified'"
const autoPull = !!parseInt(process.env['PULL_IMAGE'])
const autoRemove = !parseInt(process.env['KEEP_CONTAINER'])
const keepEntrypoint = !!parseInt(process.env['KEEP_ENTRYPOINT'])
const json = !!parseInt(process.env['JSON'])
let stderr_msg

let command = []
if ((process.env['COMMAND'] || '').trim()) {
    command = process.env['COMMAND'].trim().match(/(?:[^\s"]+|"[^"]*")+/g).map(e => e.replace(/["]+/g, ''))
}

sig = process.connected ? 'disconnect' : 'SIGTERM'
process.on(sig, async (message) => {
    printInfo('Caught SIGTERM')
    await docker.getContainer(cname).stop()
    exit('Container stopped')
})

// streams 

const stdout = new Writable({
    write(chunk, encoding, callback) {

        String(chunk).trim().split('\n').forEach(line => {

            if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
                let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
                print(JSON.stringify({ progress: progress }))
            }
            else if (line.match(/^\s*\#(.{1,60})\#\s*$/)) { // handle memo
                let memoText = RegExp.$1
                print(JSON.stringify({ memo: memoText }))
            }
            else {
                // hack: wrap line with ANSI color to prevent JSON interpretation (default Cronicle behavior)
                print(json ? line : `\x1b[109m${line}\x1b[0m`)
            }
        }) // foreach

        callback();
    },
})

const stderr = new Writable({
    write(chunk, encoding, callback) {
        let d = String(chunk).trim()
        printError(d);
        stderr_msg = d.split("\n")[0].substring(0, 128)
        callback();
    },
})

// env variables
let exclude = ['SSH_HOST', 'SSH_KEY', 'SSH_PASSWORD', 'DOCKER_PASSWORD']
let include = ['BASE_URL', 'BASE_APP_URL', 'DOCKER_HOST', 'PULL_IMAGE', 'KEEP_CONTAINER', 'IMAGE', 'ENTRYPOINT_PATH']
let vars = Object.entries(process.env)
    .filter(([k, v]) => ((k.startsWith('JOB_') || k.startsWith('DOCKER_') || k.startsWith('ARG') || include.indexOf(k) > -1) && exclude.indexOf(k) === -1))
    .map(([k, v]) => `${k}=${v}`)

// CONTAINER SETTING
const createOptions = {
    Image: imageName,
    name: cname,
    Env: vars,
    // Entrypoint: entrypoint,
    Cmd: command,
    Tty: false,
    HostConfig: {
        AutoRemove: autoRemove
    },
};

if (!keepEntrypoint) {
    createOptions.Entrypoint = [ENTRYPOINT_PATH]
    createOptions.WorkingDir = path.dirname(ENTRYPOINT_PATH)
}

if(network) createOptions.HostConfig['NetworkMode'] = network


// ----------------RUNNING CONTAINER -------- //

const dockerRun = async () => {

    // create tar archive for entrypoint script
    const pack = tar.pack()

    pack.entry({ name: path.basename(ENTRYPOINT_PATH), mode: 0o755 }, script)

    if (job.chain_data) {
        pack.entry({ name: 'chain_data'}, JSON.stringify(job.chain_data))
    }
    
    // attach file
	if(Array.isArray(job.files)) {
		job.files.forEach((e)=> {
            if(e.name) { 
                pack.entry({  name: e.name }, e.content || '')
			}
		})
	}

    pack.finalize()
    let chunks = []
    for await (const data of pack) chunks.push(data)
    let arch = Buffer.concat(chunks)

    try {
        container = await docker.createContainer(createOptions)
        // copy entrypoint file to root directory
        container.putArchive(arch, { path: path.dirname(ENTRYPOINT_PATH) })
        if(docker.modem.host) printInfo('docker host: ' + docker.modem.protocol + '://' + docker.modem.host)
        printInfo(`Container ready: name: [${createOptions.name}], image: [${imageName}], keep: ${!autoRemove}`)

        let stream = await container.attach({ stream: true, stdout: true, stderr: true })
        container.modem.demuxStream(stream, stdout, stderr);

        await container.start()
        let exit = await container.wait()

        // normal shutdown    
        printJSONMessage(1, exit.StatusCode, exit.StatusCode ? `code: ${exit.StatusCode}; ${stderr_msg} ` : null)
        process.exit(exit.StatusCode)
    }
    catch (e) {
        exit(e.message)
    }
}

// ----------- MAIN -----------------------//

async function main(image, onFinish) {

    const imageInfo = docker.getImage(image);

    let layerCount = 0 // to limit image layer download info
    const maxCount = 30

    const onProgress = (evt) => {

        let pg = evt.progressDetail || {}
        if (pg.current - pg.total === 0) {
            if (layerCount < maxCount) printInfo(evt.id + ': ' + evt.progress)
            layerCount += 1
        }
        if (String(evt.status).includes('Status')) printInfo(evt.status) // print final notes
    }

    try {
        await imageInfo.inspect();
        onFinish() // if image exists just run container
    }
    catch (e) {

        if (autoPull) { //
            printWarning(`Image not found, pulling from registry`)
            try {
                let pullStream = await docker.pull(image, {'authconfig': registryAuth})
                docker.modem.followProgress(pullStream, onFinish, onProgress)
            }
            catch (e) { exit(e.message) }
        }
        else {
            printError(`No such image [${image}], pull it manually or check "Pull Image" option`)
            exit(`No such image [${image}]`)
        }
    }
}

// ------ MAIN -----

main(imageName, dockerRun)
