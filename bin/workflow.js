#!/usr/bin/env node

const rl = require('readline').createInterface({ input: process.stdin });
const PixlRequest = require('pixl-request');
const request = new PixlRequest();
const he = require('he');

if(!process.env['WF_SIGNATURE']) throw new Error('WF Signature is not set')
request.setHeader('x-wf-signature', process.env['WF_SIGNATURE'])
request.setHeader('x-wf-id', process.env['JOB_ID'])

process.stdin.setEncoding('utf8');
process.stdout.setEncoding('utf8');

let baseUrl = process.env['BASE_URL'] || 'http://localhost:3012'

let taskList = []  // todo list
let jobStatus = {}  // a map of launched jobs

let errorCount = 0
let wfStatus = 'running'
let max_errors = parseInt(process.env['WF_MAXERR']);

function niceInterval(s, asLocatTime) {
	let date = new Date(0);
	date.setSeconds(parseInt(s));
	if (asLocatTime) return date.toLocaleTimeString();
	return date.toISOString().substr(11, 8);
}

function getJson(url, data) {
	return new Promise((resolve, reject) => {
		request.json(url, data, function (err, resp, data) {
			if (err) return reject(err);
			if (data.description) return reject(new Error(data.description))
			resolve({ resp: resp, data: data })
		});
	});
}

function sleep(millis) { return new Promise(resolve => setTimeout(resolve, millis)) }

async function abortPending() {
	for (let j in jobStatus) {
		try {
			if (!(jobStatus[j].completed)) {
				let resp = await getJson(baseUrl + '/api/app/abort_job', { id: j})
				console.log('SIGTERM sent to job ' + j);
			}
		}
		catch (e) {
			console.log('Failed to abort job: ' + j + ': ' + e.message);
		}
	}
}


// handle termination
process.on('SIGTERM', async function () {
	console.log("Caught SIGTERM, aborting pending jobs");

	wfStatus = 'abort';
	await abortPending();

});

// -------------------------- MAIN --------------------------------------------------------------//

rl.on('line', function (line) {
	// got line from stdin, parse JSON
	console.log(JSON.stringify({ progress: 0.01 }))

	const input = JSON.parse(line);

	let concur = parseInt(process.env['WF_CONCUR']) || 1

	let wf_strict = parseInt(process.env['WF_STRICT']) || 0 // report error on any job failure (warning is default)

	taskList = (input.workflow || []).map((e, i) => { e.stepId = i + 1; return e})

	let opts = input.options || {}

	let startFrom = opts.wf_start_from_step || 1
	if ( startFrom > taskList.length) throw new Error('"Start From" parameter cannot exceed event list length')

	let skip = taskList
	    .filter((e, i) => (i + 1 < startFrom ) || !!e.disabled)
	    .map(e => `[${e.stepId}] ${e.title} ${e.arg ? '@' + e.arg : ''}`)
    
    // exclude disabled/skipped jobs, form final task list
	taskList = taskList.filter((e, i) => i + 1 >= startFrom && !e.disabled)
    // adjust concurrency level if needed
	if(concur > taskList.length) concur = taskList.length

	/// sanity check
	if (taskList.length == 0) throw new Error('At least one workflow event is required');
	if (taskList.filter(e => e.id == process.env['JOB_EVENT']).length > 0) throw new Error("Workflow refers to itself");

	async function poll() {
        
		// get a list of all scheduled jobs to look up event title
		let sched = await getJson(baseUrl + '/api/app/get_schedule') //api_key: apikey,
		let schedTitles = {};
		(sched.data.rows || []).forEach(e => {
			schedTitles[e.id] = e.title 
		});
		taskList.forEach(e => {e.title = schedTitles[e.id] || '[Unknown]' })

		let r = await getJson(baseUrl + '/api/app/get_active_jobs')
		let currActive = []
		for (let id in r.data.jobs) { currActive.push(r.data.jobs[id].event) }

		console.log(`	\u001b[1mJob Schedule [Concurrency: ${concur}, From Step: ${startFrom}]\u001b[22m`);
		console.log(`\n RUNNING(${taskList.length}): `)

		let lineLen = 0;
		taskList.forEach(e => {
			let msg = ` [${e.stepId}] ${e.title} (${e.id}) ${e.arg ? ('@' + e.arg) : ''}` 
			if ( currActive.includes(e.id)) msg += `⚠️ already in progress  `
			lineLen = lineLen > msg.length ? lineLen : msg.length
			console.log(msg)
		});

		console.log(' ' + '─'.repeat(lineLen))

		if (skip.length > 0) {
			console.log(` SKIPPING(${skip.length}):\n` + skip.map(e => " " + e).join("\n"))
			console.log(' ' + '─'.repeat(lineLen))
		} 

		console.log(`\n\n\u001b[1m\u001b[32mWorkflow Started\u001b[39m\u001b[22m @ ${(new Date()).toLocaleString()}\n │  `)

		let pendingJobs = taskList.length

		// launch first batch of jobs
		for (let q = 0; q < concur; q++) {
			let task = taskList[q];
			console.log(` \n ├───────> starting \u001b[1m${task.title}\u001b[22m${task.arg ? ': '+task.arg : ''}`);

			try {
				let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, arg: task.arg || 0 });
				if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
				jobStatus[job.data.ids[0]] = { 
					  event: task.id
					, title: task.title
					, arg: task.arg
					, completed: false
					, code: 0
					, seq: q+1
					, start: (new Date()).toLocaleTimeString() }

			}
			catch (e) {
				errorCount += 1;
				jobStatus[task.id] = {
					event: task.id,
					title: task.title,
					arg: task.arg,
					completed: false,
					code: 1,
					seq: q+1,
					start: (new Date()).toLocaleTimeString(),
					description: e.message,
					elapsed: 0
				}
				continue;
			}
		}

		console.log(' │  ');

		let next = concur;
		// begin polling
		while (pendingJobs) {

			await sleep(1000);

			let resp = await getJson(baseUrl + '/api/app/get_active_jobs')
			let activeJobs = resp.data.jobs

			let rerunList = {};
			for (r in activeJobs) { if (activeJobs[r].when) { rerunList[activeJobs[r].id] = activeJobs[r].when } }

			for (let j in jobStatus) {

				if (jobStatus[j].completed) continue // do nothing if completed

				if (!(resp.data.jobs[j])) {  // if job is not in active job list mark as completed
					jobStatus[j].completed = true
					pendingJobs -= 1

					let msg = '';

					// in case job is waiting to rerun on failure, just report error and release it from WF
					if (rerunList[j]) {
						errorCount += 1
						msg = `  \u001b[31m⬤\u001b[39m ${jobStatus[j].title} failed, but scheduled to rerun at ${niceInterval(rerunList[j], true)}. Releasing job ${j} from workflow`
					}
					// if job failed to start
					else if (jobStatus[j].code) { msg = ` │ \u001b[31m⬤\u001b[39m ${jobStatus[j].title}: \u001b[31m${jobStatus[j].description}\u001b[39m` }
					// normal handling - look up job stats in history
					else {
						// check job status
						let jstat = "";
						let desc = "  ";
						
						// retrieve completed job details. API call may fail due to network lag/error, WF will try it few more times before crashing.
						let lag = 30
						let jd = {}
						while (!jd.data) {
							try {
								await sleep(lag);
								jd = await getJson(baseUrl + '/api/app/get_job_details', { id: j })
							}
							catch {
								if (lag > 500) {
									console.log(" │ ⚠️ Failed to retreive data from get_job_details")
									jd = {
										data: {
											job: {
												code: 1,
												description: "failed to retreive job state (check job logs)",
												elapsed: 0
											}
										}
									}
									break

								}
								lag = lag*3								
							}
						}	
						
						let compl = jd.data.job;
						if (compl) {
							if (compl.code == 0) { jstat = '\u001b[32m⬤\u001b[39m' }
							else if (compl.code == 255) { jstat = '\u001b[33m⬤\u001b[39m'; desc = `\n │    warn: \u001b[33m${compl.description}\u001b[39m  ` }
							else {
								errorCount += 1;
								jstat = '\u001b[31m⬤\u001b[39m' ;
								desc = `\n │    Error: \u001b[31m${compl.description}\u001b[39m  `
								if (max_errors && errorCount >= max_errors) wfStatus = 'abort'; // prevent launching new jobs

							}
							jobStatus[j].elapsed = compl.elapsed
							jobStatus[j].description = compl.description
							jobStatus[j].code = compl.code
						}
						let prog = `[${taskList.length - pendingJobs}/${taskList.length}]`
						let arg = jobStatus[j].arg ? ': '+ jobStatus[j].arg : ''
						msg = ` │ ${jstat} ${jobStatus[j].title + arg} (job ${j}) completed ${prog} at ${(new Date()).toLocaleTimeString()}\n │      \u001b[33melapsed in ${niceInterval(jobStatus[j].elapsed)}\u001b[39m  ${desc}`
					}

					msg += '\n │'				

					// starting next job in queue
					if (next < taskList.length && wfStatus != 'abort') {

						let task = taskList[next]

						msg += `\n ├───────> starting \u001b[1m${task.title}\u001b[22m${task.arg ? ': '+task.arg : ''}`;
				
						try {
							let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, arg: task.arg || 0 });
							if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
							jobStatus[job.data.ids[0]] = { 
								  event: task.id
								, arg: task.arg
								, title: task.title
								, completed: false
								, code: 0
								, seq: next+1
								, start: (new Date()).toLocaleTimeString()
							 }
						}
						catch (e) {
							errorCount += 1;
							jobStatus[task.id] = {
								  event: task.id
								, arg: task.arg
								, title: task.title
								, completed: false
								, code: 1
								, seq: next+1
								, start: (new Date()).toLocaleTimeString()
								, description: e.message
								, elapsed: 0
							}
						}
						next += 1
					}

					console.log(msg);

					if (max_errors && errorCount >= max_errors) {
						console.log(" │\n ⚠️ Error count exceeded maximum, aborting workflow...")
						wfStatus = 'abort';
						await abortPending();
						throw new Error("WF Error count exceeded maximum");

					}

					console.log(' │');
					console.log(JSON.stringify({ progress: (1 - pendingJobs / taskList.length) }))
				}
			}
		}

		console.log(`\n\u001b[1m\u001b[32mWorkflow Completed\u001b[39m\u001b[22m @${(new Date()).toLocaleString()}  `)

		// print performance
		let perf = {}
		Object.keys(jobStatus).forEach(key => {
			let arg = jobStatus[key].arg ? '@' + jobStatus[key].arg : ''
			let perf_key = `${jobStatus[key].seq}.` + (jobStatus[key].title || '[Unknown]') + arg
			perf[perf_key] = jobStatus[key].elapsed || 0
		})

		var table = {
			title: "Workflow Events",
			header: [
				"#", "title", "job", "started at", "elapsed", "status", "description"
			],
			rows: Object.keys(jobStatus).map(key=> [
				jobStatus[key].seq,
				`<span style="${jobStatus[key].code % 255 ? 'color:red' : ''}"><b>${he.encode(jobStatus[key].title) || '[Unknown]'}</b></span>` + (jobStatus[key].arg ? ': ' + he.encode(jobStatus[key].arg) : ''),
				key === jobStatus[key].event ? '' : `<a href="/#JobDetails?id=${key}" target="_blank">${key}</a>`,
				jobStatus[key].start,
				niceInterval(jobStatus[key].elapsed),
				jobStatus[key].code ? (jobStatus[key].code == 255 ? '<span style="color:orange"><b>⚠️</b></span>' : '<span style="color:red"><b>✗</b></span>') : '<span style="color:green"><b>✔</b></span>',
				jobStatus[key].code ? `${he.encode(jobStatus[key].description)}`.substring(0,120) : ''

			]),
			caption: ""
		};

		console.log(JSON.stringify({ perf: perf, table: table }))

		let result = { complete: 1, code: 0 }
		if (errorCount > 0) result = { complete: 1, code: (wf_strict ? 1 : 255), description: `WF - ${errorCount} out of ${taskList.length} jobs reported error` }
		if (errorCount == taskList.length) result = { complete: 1, code: 1, description: "WF - All jobs failed" }
		console.log(JSON.stringify(result))

	};

	poll().catch(e => console.log(JSON.stringify({ complete: 1, code: 1, description: e.message })));
	rl.close();

});
