const fs = require('fs');
const os = require('os');
const path = require('path');

const printComplete = (complete, code, desc) => {
    process.stdout.write(JSON.stringify({ complete: complete, code: code || 0, description: desc || "" }) + os.EOL)
}

const debug = parseInt(process.env["JOB_DEBUG"]);
const printDebug = (message) => { if(debug) process.stdout.write('[DEBUG] ' + message + os.EOL)}

// try resolve pty
let pty;

try { pty = require('node-pty') }
catch { 
    process.stdout.write(`
        node-pty module is not installed. Run command below in your dist folder to install (will build from source):
        
        \x1b[1;3mnpm install node-pty\x1b[0m
        
         or use @lydell/node-pty fork as alias to get this module with pre-built binaries

        \x1b[1;3mnpm install node-pty@npm:@lydell/node-pty\x1b[0m        
    ` + os.EOL)
    printComplete(1, 1, "node-pty is not installed")
    process.exit(1)    
}

let script = process.env["SCRIPT"]
let child_opts = {cols: parseInt(process.env['COLS']) || 80, rows: parseInt(process.env['ROWS']) || 80 }
let child_args = []
let script_file = path.join(os.tmpdir(), 'cronicle-script-temp-' + process.env['JOB_ID'] + '.sh');	
let child_exec = script_file
let cmdInfo = `executing ${script_file}`

	if (os.platform() == 'win32') { // if Windows - try to parse shebang or invoke as bat file
        
		let fl = script.substring(0, script.indexOf("\n")).trim()
		script_file = path.join(os.tmpdir(), 'cronicle-script-temp-' + process.env['JOB_ID'] + '.ps1')        

		// if script contains shebang, resolve interpreter from there
		if (fl.startsWith("#!")) {
			fl = fl.replace('#!/usr/bin/env', '').replace('#!', '').trim()		
			script = script.substring(script.indexOf("\n")).trim() // remove shebang		
            child_exec = "powershell.exe"
            child_args = ["-c", `${fl} ${script_file}`]
            cmdInfo = `executing: ${fl} ${script_file}`
		}
		else { // if no shebang - just treat it as bat file
			script_file += '.bat'
			child_exec = script_file
			child_opts['shell'] = true // inherited from cp.spawn, likely not needed here
            cmdInfo = `executing bat file: ${script_file}`
		}
	}

fs.writeFileSync(script_file, script, { mode: "775" });

const child = pty.spawn(child_exec, child_args, child_opts)
printDebug(cmdInfo + ` (pid: ${child.pid})`)

child.on('data', (d)=>{    
   fs.appendFileSync(process.env["JOB_LOG_FILE"], d)
}) 

// child.on('exit', (code, signal)=>{
child.onExit(({ exitCode, signal }) => {
  printComplete(1, exitCode, exitCode ? 'terminal crashed' : '')
  printDebug("child process completed, removing script file")
  fs.unlink(script_file, function (err) {
    if(err) {
      printDebug("failed to remove script file")
    }
    else {
      printDebug("script file has been removed");
    }
    process.exit();
  });
})

// handle abortion
let sig = process.connected ? "disconnect" : "SIGTERM";
process.on(sig, (signal) => {
  printDebug(`Caught sigterm, terminating child process ${child.pid}`);
  child.kill();
});