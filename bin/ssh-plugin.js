#!/usr/bin/env node

const { readFileSync } = require('fs');
const { Client } = require('ssh2');
const conn = new Client();

let hostInfo = process.env['SSH_HOST'] || process.env['JOB_ARG'] || ''

let json = parseInt( process.env['JSON'] || '' )

hostInfo = process.env[hostInfo] || hostInfo

if (!hostInfo) {
    console.log(JSON.stringify({
        complete: 1,
        code: 1,
        description: 'Missing host info'
    }));
    process.exit(1)
}

if (!hostInfo.startsWith('sftp://')) hostInfo = 'sftp://' + hostInfo

let uri = new URL(hostInfo)

let conf = {
    host: uri.hostname,
    port: parseInt(uri.port) || 22,
    username: uri.username
}

if (uri.password) conf.password = decodeURIComponent(uri.password)
if (process.env['SSH_KEY']) conf.privateKey = Buffer.from(process.env['SSH_KEY'])
if (uri.searchParams.get('privateKey')) conf.privateKey = readFileSync(String(uri.searchParams.get('privateKey')))
if (uri.searchParams.get('passphrase')) conf.passphrase = uri.searchParams.get('passphrase')


let tmpFile = `/tmp/cronicle-${process.env['JOB_ID']}`

// some variables to send to SSH session
// will only work if AcceptEnv setting is set (usually LC_* by default)
let env = {
      LC_TMP_FILE: tmpFile
    , LC_JOB_ID: process.env['JOB_ID']
    , LC_BASE_URL: process.env['BASE_URL']
}

let command = process.env['SSH_CMD'] ?? 'ls -lah /'

conn.on('error', (err) => {  // handle configuration errors
    console.log(JSON.stringify({
        complete: 1,
        code: 1,
        description: err.message
    }));
})

conn.on('ready', () => {
    console.log(`\x1b[32mConnected to ${conf.host}\x1b[0m\n`)
    console.log(`\x1b[32mCMD: ${command}\x1b[0m\n`)

    conn.exec(command, { env: env }, (err, stream) => {

        if (err) { // handle ssh command errors
            console.log(JSON.stringify({
                complete: 1,
                code: 1,
                description: err.message
            }));
        }


        stream.on('close', (code, signal) => {

            code = (code || signal || 0);

            conn.end();

            console.log(JSON.stringify({
                complete: 1,
                code: code,
                description: code ? ("Script exited with code: " + code) : ""
            }));


        }).on('data', (data) => {

            String(data).trim().split('\n').forEach(line => {

                //console.log(line, line.length, `--${line}--`)

            if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
                    let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
                    console.log(JSON.stringify({
                        progress: progress
                    }))
                }
                else if (line.match(/^\s*\#(.{1,60})\#\s*$/)) { // handle memo
                    let memoText = RegExp.$1
                    console.log(JSON.stringify({
                        memo: memoText
                    }))
                }
                else {
                    // adding ANSI sequence (grey-ish color) to prevent JSON interpretation
                    console.log(json ? line : `\x1b[109m${line}\x1b[0m`)        
                }
            }) // foreach

        }).stderr.on('data', (data) => {

            if (data) console.log(`\x1b[31m${String(data)}\x1b[0m`); // red
            

        });

        stream.stdin.write(process.env['SCRIPT'])
        stream.stdin.end()
    });
}).connect(conf);