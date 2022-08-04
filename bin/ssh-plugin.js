#!/usr/bin/env node

const { readFileSync } = require('fs');
const { Client } = require('ssh2');
const conn = new Client();
const fs =  require('fs')
const { spawn } = require('child_process')

let hostInfo = process.env['SSH_HOST'] || process.env['JOB_ARG'] || ''

let json = parseInt(process.env['JSON'] || '')

let command = process.env['SSH_CMD'] ?? 'ls -lah /'

let script = process.env['SCRIPT']

hostInfo = process.env[hostInfo] || hostInfo

function printJSONmessage(complete, code, desc) {
    console.log(JSON.stringify({ complete: complete, code: code || 0, description: desc || "" }))
}

let kill_timer = null

let stderr_msg = ""

let trapCmd = ""

// ================  Run Locally if no host info provided ====================================== //

if (!hostInfo || hostInfo.toLowerCase() === 'localhost') {

    let shell = fs.existsSync('/bin/bash') ? '/bin/bash' : (process.env.SHELL || 'sh')

    // ----------- START 

    let json = parseInt(process.env['JSON'] || '')

    const child = spawn(shell, ['-c', command])

    child.on('error', (err) => printJSONmessage(1, 1, `Script failed: ${err.message}`))

    child.on('spawn', () => {
        console.log(`[INFO] \x1b[32mRunning locally\x1b[0m\n`)
        console.log(`[INFO] \x1b[32mCMD: ${command}\x1b[0m\n`)
    })

    child.stdout.on('data', (data) => {

        String(data).trim().split('\n').forEach(line => {

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
    })

    child.stderr.on('data', (data) => {
        let d = String(data).trim()
        if (d) {
            console.log(`\x1b[31m${d}\x1b[0m`); // red
            stderr_msg = d.split("\n")[0].substring(0, 128)
        }
    })

    // ------------ Exit

    child.on('exit', function (code, signal) {
        // child exited
        if (kill_timer) clearTimeout(kill_timer)

        code = (code || signal || 0)

        printJSONmessage(1, code, code ? `Script exited with code: ${code}; ${stderr_msg}} ` : "")


    });

    // silence EPIPE errors on child STDIN
    child.stdin.on('error', (err) => { })

    // Handle shutdown
    process.on('SIGTERM', function () {
        console.log("Caught SIGTERM, killing child: " + child.pid);

        kill_timer = setTimeout(function () {
            // child didn't die, kill with prejudice
            console.log("Child did not exit, killing harder: " + child.pid);
            child.kill('SIGKILL');
        }, 9 * 1000);

        // try killing nicely first
        child.kill('SIGTERM');
    });

    child.stdin.write(script)
    child.stdin.end()
}

// ================  RUN OVER SSH ====================================== //

else {

    if (!hostInfo.startsWith('sftp://')) hostInfo = 'sftp://' + hostInfo

    let uri = new URL(hostInfo)

    let conf = {
        host: uri.hostname,
        port: parseInt(uri.port) || 22,
        username: uri.username,
        pty: true
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

    conn.on('error', (err) => {  // handle configuration errors
        console.log(JSON.stringify({
            complete: 1,
            code: 1,
            description: err.message
        }));
    })

    let streamRef = null

    conn.on('ready', () => {
        console.log(`[INFO] \x1b[32mConnected to ${conf.host}\x1b[0m\n`)
        console.log(`[INFO] \x1b[32mCMD: ${command}\x1b[0m\n`)

        conn.exec(command, { env: env }, (err, stream) => {

            if(err) printJSONmessage(1, 1, err.message)

            streamRef = stream

            stream.on('close', (code, signal) => {

                code = (code || signal || 0);

                conn.end();

                printJSONmessage(1, code, code ? `Script exited with code: ${code}; ${stderr_msg}` : "")

            }).on('data', (data) => {

                String(data).trim().split('\n').forEach(line => {

                    if (!trapCmd && line.trim().startsWith('trap:')) {
                        trapCmd = line.trim().substring(5)
                        console.log(`[INFO] \x1b[33mTrap command set to: ${trapCmd}\x1b[0m`)
                    } 

                    else if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
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
                let d = String(data).trim()
                if (d) {
                    console.log(`\x1b[31m${d}\x1b[0m`); // red
                    stderr_msg = d.split("\n")[0].substring(0, 128)
                }
            });

            stream.stdin.write(script)
            stream.stdin.end()
        });
    }).connect(conf)

    process.on('SIGTERM', (signal) => {
        console.log("Caugth SIGTERM")
         if (trapCmd) {
             console.log("Executing trap command:", trapCmd)
             conn.exec(trapCmd, (err, s) => {
                 if (err) {
                     console.log("Failed to abort: ", err.message)
                     conn.end()
                 }
                 s.on('data', (d) => { console.log(String(d)) })
                 s.stderr.on('data', (d) => { console.log(String(d)) }) 
                 s.on('exit', (cd) => {
                     console.log("trap command", cd ? "failed" : "completed")
                     conn.end()
                 })
             })
         }
         else {
             console.log("\x1b[33mTrap command is not detected. You process may still run on remote host\x1b[0m")
             conn.end()
         }
     })
} /// run remote