#!/usr/bin/env node

const { readFileSync } = require('fs');
const { Client } = require('ssh2');
const conn = new Client();
const {EOL} = require('os')
const JSONStream = require('pixl-json-stream');
const { spawn } = require('child_process')

const print = (text) => {
	process.stdout.write(text + EOL);
}

let hostInfo = process.env['JOB_ARG'] || process.env['SSH_HOST'] || ''

let json = parseInt(process.env['JSON'] || '')

let command = process.env['SSH_CMD'] ?? 'ls -lah /'

let script = process.env['SCRIPT']

hostInfo = process.env[hostInfo] || hostInfo

let kill_timer = null

let stderr_msg = ""

let trapCmd = ""

// -------------------------- MAIN --------------------------------------------------------------//

const stream = new JSONStream(process.stdin, process.stdout);

function printJSONmessage(complete, code, desc) {
    stream.write({ complete: complete, code: code || 0, description: desc || "" })
}

    // ================  Run Locally if no host info provided ====================================== //
    // ================ this would emulate: echo "some command" | sh - =============================//

    if (!hostInfo || hostInfo.toLowerCase() === 'localhost') {

        // ----------- START 

        let json = parseInt(process.env['JSON'] || '')

        const child = process.platform == 'win32' ?  spawn('cmd', ['/c', command]) : spawn('sh', ['-c', command])

        child.on('error', (err) => printJSONmessage(1, 1, `Script failed: ${err.message}`))

        child.on('spawn', () => {
            print(`[INFO] \x1b[32mRunning locally\x1b[0m\n`)
            print(`[INFO] \x1b[32mCMD: ${command}\x1b[0m\n`)
        })

        child.stdout.on('data', (data) => {

            String(data).trim().split('\n').forEach(line => {

                if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
                    let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
                    stream.write({progress: progress})
                }
                else if (line.match(/^\s*\#(.{1,140})\#\s*$/)) { // handle memo
                    let memoText = RegExp.$1
                    stream.write({
                        memo: memoText
                    })
                }
                else {
                    // adding ANSI sequence (grey-ish color) to prevent JSON interpretation
                    print(json ? line : `\x1b[109m${line}\x1b[0m` + "\r")
                }
            }) // foreach    
        })

        child.stderr.on('data', (data) => {
            let d = String(data).trim()
            if (d) {
                print(`\x1b[31m${d}\x1b[0m`); // red
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
            print("Caught SIGTERM, killing child: " + child.pid);

            kill_timer = setTimeout(function () {
                // child didn't die, kill with prejudice
                print("Child did not exit, killing harder: " + child.pid);
                child.kill('SIGKILL');
            }, 9 * 1000);

            // try killing nicely first
            child.kill('SIGTERM');
        });

        child.stdin.write(script + "\n")
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
            stream.write({
                complete: 1,
                code: 1,
                description: err.message
            });
        })

        let streamRef = null

        conn.on('ready', () => {
            print(`[INFO] \x1b[32mConnected to ${conf.host}\x1b[0m\n`)
            print(`[INFO] \x1b[32mCMD: ${command}\x1b[0m\n`)

            conn.exec(command, { env: env }, (err, stream) => {

                if (err) printJSONmessage(1, 1, err.message)

                streamRef = stream

                stream.on('close', (code, signal) => {

                    code = (code || signal || 0);

                    conn.end();

                    printJSONmessage(1, code, code ? `Script exited with code: ${code}; ${stderr_msg}` : "")

                }).on('data', (data) => {

                    String(data).trim().split('\n').forEach(line => {

                        if (!trapCmd && line.trim().startsWith('trap:')) {
                            trapCmd = line.trim().substring(5)
                            print(`[INFO] \x1b[33mTrap command set to: ${trapCmd}\x1b[0m \n`)
                        }

                        else if (line.match(/^\s*(\d+)\%\s*$/)) { // handle progress
                            let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
                            stream.write({
                                progress: progress
                            })
                        }
                        else if (line.match(/^\s*\#(.{1,60})\#\s*$/)) { // handle memo
                            let memoText = RegExp.$1
                            stream.write({
                                memo: memoText
                            })
                        }
                        else {
                            // adding ANSI sequence (grey-ish color) to prevent JSON interpretation
                            print(json ? line : `\x1b[109m${line}\x1b[0m`)
                        }
                    }) // foreach

                }).stderr.on('data', (data) => {
                    let d = String(data).trim()
                    if (d) {
                        print(`\x1b[31m${d}\x1b[0m`); // red
                        stderr_msg = d.split("\n")[0].substring(0, 128)
                    }
                });

                stream.stdin.write(script + "\n")
                stream.stdin.end()
            });
        }).connect(conf)

        process.on('SIGTERM', (signal) => {
            print("Caugth SIGTERM")
            if (trapCmd) {
                print("Executing trap command:", trapCmd)
                conn.exec(trapCmd, (err, s) => {
                    if (err) {
                        print("Failed to abort: ", err.message)
                        conn.end()
                    }
                    s.on('data', (d) => { print(String(d)) })
                    s.stderr.on('data', (d) => { print(String(d)) })
                    s.on('exit', (cd) => {
                        print("trap command", cd ? "failed" : "completed")
                        conn.end()
                    })
                })
            }
            else {
                print("\x1b[33mTrap command is not detected. You process may still run on remote host\x1b[0m")
                conn.end()
            }
        })
    } /// run remote
