#!/usr/bin/env node

// Shell Script Runner for Cronicle
// Invoked via the 'Shell Script' Plugin
// Copyright (c) 2015 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const path = require('path');
const JSONStream = require('pixl-json-stream');
// const Tools = require('pixl-tools');
// const moment = require('moment')
const sqparse = require('shell-quote').parse;

if(process.env['ENV_FILE']) {
 try { 
	 require('dotenv').config({path: process.env['ENV_FILE']})
  } catch { }
}

// let start = moment();

// setup stdin / stdout streams 
process.stdin.setEncoding('utf8');
process.stdout.setEncoding('utf8');

const stream = new JSONStream(process.stdin, process.stdout);

// detect "clear line" like sequences and return string after it.
function trimAnimation(line) {
		if(line.lastIndexOf('\x1b[0K') > -1)  return line.substring(line.lastIndexOf('\x1b[0K') + 4)
	    if(line.lastIndexOf('\x1b[K\r') > -1)   return line.substring(line.lastIndexOf('\x1b[K\r') + 4)
		if(line.trimEnd().lastIndexOf('\r') > -1) return (line.trimEnd().lastIndexOf('\r') + 1)
		return line
}

stream.on('json', function (job) {
	// got job from parent 

	let script_file = path.join(os.tmpdir(), 'cronicle-script-temp-' + job.id + '.sh');	

	// attach "files" as env variables
	if(Array.isArray(job.files)) {
		job.files.forEach((e)=> {
            if(e.name) { 
				process.env['files/' + e.name] = (e.content || '')
				process.env['FILE_' + String(e.name).toUpperCase().replace(/\./g,'_') ] = (e.content || '')
			}
		})
	}

	if(job.chain_data) { // check for args in chain data
		let chainArgs = job.chain_data.args
		if(Array.isArray(chainArgs)) {
			for(let i = 0; i < chainArgs.length; i++) {
				process.env[`ARG${i+1}`] = chainArgs[i]
			}
		}
	}

	if (job.tty) process.env['TERM'] = 'xterm';
	let child_exec = job.tty ? "/usr/bin/script" : script_file;
	let child_args = job.tty ? ["-qec", script_file, "--flush", "/dev/null"] : [];

	let script = (job.params.script || '').trim()

	let childOpts = {stdio: ['pipe', 'pipe', 'pipe']}

	if (os.platform() == 'win32') { // if Windows - try to parse shebang or invoke as bat file
		let fl = script.substring(0, script.indexOf("\n")).trim()
		script_file = path.join(os.tmpdir(), 'cronicle-script-temp-' + job.id + '.ps1')

		// if script contains shebang, resolve interpreter from there
		if (fl.startsWith("#!")) {

			fl = fl.replace('#!/usr/bin/env', '').replace('#!', '').trim()

			child_args = sqparse(fl)

			if(fl.startsWith('/bin/sh') || fl.startsWith('sh')) {
				 script_file += '.cmd'
				 child_exec = 'cmd'
				 child_args = ['/c', script_file]
			}
			else if(fl.startsWith('/bin/bash') || fl.startsWith('bash') || !child_args.length) {
				child_exec = 'powershell'
				child_args = ['-f', script_file]
		    }
			else {
				child_exec = child_args.shift() || 'powershell'
				child_args.push(script_file)
			}			
			script = script.substring(script.indexOf("\n")).trim() // remove shebang			
		}
		else { // if no shebang - just treat it as bat file
			script_file += '.bat'
			child_exec = script_file
			childOpts['shell'] = true // set shell to true to work around CVE-2024-27980 
		}
	}
	
	fs.writeFileSync(script_file, script, { mode: "775" });
	const child = cp.spawn(child_exec, child_args, childOpts);

	let kill_timer = null;
	let stderr_buffer = '';
	let sent_html = false;

	// if tty option is checked do not pass stdin (to avoid it popping up in the log)
	const cstream = job.tty ? new JSONStream(child.stdout) : new JSONStream(child.stdout, child.stdin);

	// TODO: parse animations (progress bars/spinners ) into memo. 
	// if (job.params.animation) {
    // child.stdout.on("data", (data) => {  // data is set to be string by "process.stdout.setEncoding('utf8');"
	//   let ax = indexOfAnimationEnd(data)
    //   if (ax > 0) { stream.write({memo: data.substring(ax)}); }
    //   });
    // }

	cstream.recordRegExp = /^\s*\{.+\}\s*$/;
	cstream.EOL = "\n" // force \n on Windows (default \r\n will cause issues if \n is used by the app (e.g. console.log))

	cstream.on('json', function (data) {
		// received JSON data from child, pass along to Cronicle or log
		if (job.params.json) {
			stream.write(data);
			if (data.html) sent_html = true;
		}
		else cstream.emit('text', JSON.stringify(data) + "\n");
	});

	cstream.on('text', function (line) {

		let l = line.trim()

		// received non-json text from child
		// memo parsing
        if (l.startsWith("#") && l.endsWith("#") && l.length <= 142) {
          stream.write({
            memo: l.substring(1, l.length - 1),
          });
        }
		// parse percentage
        else if (l.endsWith("%") && l.length <= 4) {
          let p = parseInt(l);
          if (p) {
            stream.write({
              progress: Math.max(0, Math.min(100, p)) / 100
            });
          }
        }
        // legacy regex
        // look for plain number from 0 to 100, treat as progress update
        // if (line.match(/^\s*(\d+)\%\s*$/)) {
        // 	let progress = Math.max(0, Math.min(100, parseInt(RegExp.$1))) / 100;
        // 	stream.write({
        // 		progress: progress
        // 	});
        // }
        // else if(line.match(/^\s*\#(.{1,140})\#\s*$/)){
        // 	let memoText = RegExp.$1
        // 	stream.write({
        // 		memo: memoText
        // 	});
        // }
        else {
          // otherwise just log it
		  line = trimAnimation(line)
          if (job.params.annotate) {
            // let dargs = Tools.getDateArgs(new Date());
            // line = '[' + dargs.yyyy_mm_dd + ' ' + dargs.hh_mi_ss + '] ' + line;
            line = `[${new Date().toISOString()}] ${line}`;
          }
          fs.appendFileSync(job.log_file, line.endsWith('\n') ? line : line + "\n");
        }
	});

	cstream.on('error', function (err, text) {
		// Probably a JSON parse error (child emitting garbage)
		if (text) fs.appendFileSync(job.log_file, text + "\n");
	});

	child.on('error', function (err) {
		// child error
		stream.write({
			complete: 1,
			code: 1,
			description: "Script failed: " + err.message // Tools.getErrorDescription(err)
		});

		fs.unlink(script_file, function (err) { ; });
	});

	child.on('exit', function (code, signal) {
		// child exited
		if (kill_timer) clearTimeout(kill_timer);
		code = (code || signal || 0);

		let data = {
			complete: 1,
			code: code,
			description: code ? ("Script exited with code: " + code) : ""
		};

		if (stderr_buffer.length && stderr_buffer.match(/\S/)) {
			// generate an HTML report showing the STDERR, but only if the script hasn't already populated the job `html`
			if (!sent_html) data.html = {
				title: "Error Output",
				content: "<pre>" + stderr_buffer.replace(/</g, '&lt;').trim() + "</pre>"
			};

			if (code) {
				// possibly augment description with first line of stderr, if not too insane
				let stderr_line = stderr_buffer.trim().split(/\n/).shift();
				if (stderr_line.length < 256) data.description += ": " + stderr_line;
			}
		}

		stream.write(data);
		fs.unlink(script_file, function (err) { ; });
	}); // exit

	// silence EPIPE errors on child STDIN
	child.stdin.on('error', function (err) {
		// ignore
	});

	// track stderr separately for display purposes
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', function (data) {
		// keep first 32K in RAM, but log everything
		if (stderr_buffer.length < 32768) stderr_buffer += data;
		else if (!stderr_buffer.match(/\.\.\.$/)) stderr_buffer += '...';

		fs.appendFileSync(job.log_file, data);
	});

	// pass job down to child process (harmless for shell, useful for php/perl/node)
	cstream.write(job);
	child.stdin.end();

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

}); // stream
