#!/usr/bin/env node

const { readFileSync } = require('fs');
const { Client } = require('ssh2');
const conn = new Client();
const { EOL } = require('os')
const fs = require('fs')
const { buildConnectionOptions, resolveSshTarget } = require('../lib/ssh-host-policy')

// read job info from stdin (sent by Cronicle engine)
const job = JSON.parse(fs.readFileSync(process.stdin.fd))

let pref = !!job.params.annotate

const debug = parseInt(process.env["JOB_DEBUG"]);

const print = (text) => process.stdout.write((pref ?  `[${new Date().toISOString()}] ` : '') + text + EOL)
const printInfo = (text) => { if(debug) process.stdout.write(`[INFO] \x1b[32m${text}\x1b[0m` + EOL) }
const printWarning = (text) => { if(debug) process.stdout.write(`[WARN] \x1b[33m${text}\x1b[0m` + EOL) }
const printError = (text) => process.stdout.write(`\x1b[31m${text}\x1b[0m` + EOL)

const printComplete = (complete, code, desc, callback) => {
    process.stdout.write(JSON.stringify({ complete: complete, code: code || 0, description: desc || "" }) + EOL, callback)
}

const printCompleteAndExit = (code, desc) => printComplete(1, code, desc, () => process.exit(code ? 1 : 0))

const printJson = (json) => { process.stdout.write(JSON.stringify(json) + EOL) }

let shuttingDown = false

function main() {
let target
try {
    target = resolveSshTarget(process.env, { allowConfiguredLocal: false, defaultProtocol: 'ssh' })
}
catch (err) {
    printCompleteAndExit(1, err.message)
    return
}

let killCmd = (process.env['KILL_CMD'] || '').trim() || 'pkill -s $$' // $$ will be resolved in bootstrap script

let json = parseInt(process.env['JSON'])

let truncVar = parseInt(process.env['TRUNC_VAR']) // optionally remove SSH_ prefix from passed vars

let ext = { powershell: 'ps1', csharp: 'cs', java: 'java', python: 'py', javascript: 'js' } // might be useful in Windows (TODO)
let tmpDir = process.env['SSH_TMPDIR'] || '/tmp'
let tmpFile = tmpDir + '/cronicle-' + process.env['JOB_ID'] + '.' + (ext[process.env['LANG']] || 'sh')

// set interpreter for stdin script
let command = 'sh -'  // process.env['SSH_CMD'] ?? 'ls -lah /'

let SCRIPT_BASE64 = Buffer.from(process.env['SCRIPT'] ?? '#!/usr/bin/env sh\necho "Empty script"').toString('base64')

let prefix = process.env['PREFIX'] || ''

// generate stdin script to pass variables and user script in base64 format
let exclude = [
    'SSH_HOST', 'SSH_KEY', 'SSH_PASSWORD', 'SSH_PASSPHRASE',
    'SSH_HOST_FINGERPRINT', 'SSH_HOST_FINGERPRINT_MAP', 'SSH_HOST_KEY_STRICT'
]
if (target.source === 'job_arg') exclude.push('JOB_ARG')
if (Object.prototype.hasOwnProperty.call(process.env, target.selected)) exclude.push(target.selected)
let include = ['BASE_URL', 'BASE_APP_URL']
process.env['JOB_CHAIN_DATA'] = JSON.stringify(job.chain_data) || 'has no data'

let vars = Object.entries(process.env)
    .filter(([k, v]) => ((k.startsWith('JOB_') || k.startsWith('SSH_') || k.startsWith('ARG') || include.indexOf(k) > -1) && exclude.indexOf(k) === -1))
    .map(([key, value]) => `export ${truncVar ? key.replace(/^SSH_/, '') : key}=$(printf "${Buffer.from(value).toString('base64')}" | base64 -di)`)
    .join('\n')

let script = `
temp_file="${tmpFile}"

cleanup(){
  rm -f $temp_file
}

trap cleanup EXIT

${vars}

export SCRIPT_FILE=$temp_file

printf "${SCRIPT_BASE64}" | base64 -di > "$temp_file"
chmod +x $temp_file

# set default trap command
echo "trap:${killCmd}"

${prefix} $temp_file
`

if(process.env['TARGET_OS'] === 'darwin') {
    script = script.replace(/base64 -di/g, "base64 -D");
}

let stderr_msg = ""

let kill_timer = null;  // SIGKILL timer reference

let trapCmd = ""

// -------------------------- MAIN --------------------------------------------------------------//


try {
let uri = target.uri
let conf = buildConnectionOptions(target)

if (target.warning) process.stdout.write(`[WARN] ${target.warning}` + EOL)

// Resolve credential
// can be passed via secret
if(process.env['SSH_PASSWORD']) conf.password = process.env['SSH_PASSWORD'] 
if(process.env['SSH_KEY']) conf.privateKey = Buffer.from(process.env['SSH_KEY'])
if(process.env['SSH_PASSPHRASE']) conf.passphrase = process.env['SSH_PASSPHRASE']
// from URI
if(uri.password) conf.password = decodeURIComponent(uri.password) 
if (uri.searchParams.get('privateKey')) conf.privateKey = readFileSync(String(uri.searchParams.get('privateKey')))
if (uri.searchParams.get('passphrase')) conf.passphrase = uri.searchParams.get('passphrase')

if (!conf.password && !conf.privateKey ) {
    printCompleteAndExit(1, "No password or key specified. Use SSH_PASSWORD/SSH_KEY env vars, or set via URI (ssh://user:[pass]@host?privateKey=/path/to/key")
    return
}

    conn.on('error', (err) => {  // handle configuration errors
        printJson({
            complete: 1,
            code: 1,
            description: err.message
        });
        shuttingDown = true
        if (process.connected) process.disconnect()
    })

    conn.on('ready', () => {
        printInfo(`Connected to ${conf.host}`)

        conn.exec(command, (err, stream) => {

            if (err) printComplete(1, 1, err.message)

            stream.on('close', (code, signal) => {

                shuttingDown = true

                if (kill_timer) clearTimeout(kill_timer);

                code = (code || signal || 0);

                conn.end()
                if (process.connected) process.disconnect()

                printComplete(1, code, code ? `Script exited with code: ${code}; ${stderr_msg}` : "")

            }).on('data', (data) => {

                String(data).trim().split('\n').forEach(line => {

                    let l = line.trim()

                    if (line.trim().startsWith("trap:")) {
                      trapCmd = line.trim().substring(5);
                      printInfo(`Kill command set to: ${trapCmd}\x1b[0m`);
                    } 
                    else if (l.startsWith("#") && l.endsWith("#") && l.length <= 142 ) {
                      printJson({ memo: l.substring(1, l.length - 1) });
                    }
                    // parse percentage
                    else if (l.endsWith("%") && l.length <= 4) {
                      let p = parseInt(l);
                      if (p) printJson({ progress: Math.max(0, Math.min(100, p)) / 100 })
                    }
                    // legacy memo/progress calc 
                    // else if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
                    //     let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
                    //     printJson({ progress: progress })
                    // }
                    // else if (line.match(/^\s*\#(.{1,140})\#\s*$/)) { // handle memo
                    //     let memoText = RegExp.$1
                    //     printJson({ memo: memoText })
                    // }
                    else {
                      // adding ANSI sequence (grey-ish color) to prevent JSON interpretation
                      print(json ? line : `\x1b[109m${line}\x1b[0m`);
                    }
                }) // foreach

            }).stderr.on('data', (data) => {
                let d = String(data).trim()
                if (d) {
                    printError(d); // red
                    stderr_msg = d.split("\n")[0].substring(0, 128)
                }
            });

            stream.stdin.write(script + "\n")
            stream.stdin.end()

        }) // ------- exec
    }).connect(conf)
// process should be connected for Windows compat
let sig = process.connected ? 'disconnect' : 'SIGTERM'

process.on(sig, (signal) => {

    if (shuttingDown) return // if normal shutdown in progress - ignore

    printWarning(`Caugth ${sig}`)
    if (trapCmd) {
        printWarning(`Executing KILL command: ${trapCmd}`)
        conn.exec(trapCmd, (err, trapStream) => {
            if (err) {
                printError("Failed to abort: ", err.message)
                conn.end()
                if (process.connected) process.disconnect()
            }
            trapStream.on('data', (d) => { print(String(d)) })
            trapStream.stderr.on('data', (d) => { print(String(d)) })
            trapStream.on('exit', (cd) => {
                if (cd) printError("! Kill command failed, you script may still run on remote host")
                else printWarning("Kill command completed sucessfully")
                conn.end()
                if (process.connected) process.disconnect()
            })
        })
    }
    else {
        printError("! Kill command is not detected.")
        printError("You process may still run on remote host")
        conn.end()
        if (process.connected) process.disconnect()
    }
})
}
catch (err) {
    if (process.connected) process.disconnect()
    printCompleteAndExit(1, err.message)
}

}

main()
