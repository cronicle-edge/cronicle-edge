#!/usr/bin/env node

// const rl = require('readline').createInterface({ input: process.stdin });
const PixlRequest = require('pixl-request');
const request = new PixlRequest();
const he = require('he');
const {EOL} = require('os')
const JSONStream = require('pixl-json-stream');

let bullet = '>' // '⬤'

if (!process.env['WF_SIGNATURE']) throw new Error('WF Signature is not set')
request.setHeader('x-wf-signature', process.env['WF_SIGNATURE'])
request.setHeader('x-wf-id', process.env['JOB_ID'])

process.stdin.setEncoding('utf8');
process.stdout.setEncoding('utf8');

let baseUrl = process.env['BASE_URL'] || 'http://localhost:3012'

let taskList = []  // todo list
let jobStatus = {}  // a map of launched jobs
let finishingJobs = {} // a map for 

let errorCount = 0
let shuttingDown = false
let aborting = false
let normalShutDown = false
let exceededMaxErrors = false
let max_errors = parseInt(process.env['WF_MAXERR']);

const print = (text) => {
	process.stdout.write(text + EOL);
}

function niceInterval(s, asLocatTime) {
	let date = new Date(s * 1000);
	//date.setSeconds(parseInt(s));
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

	if(normalShutDown) return 
	if(aborting) return

	aborting = true
	shuttingDown = true
    
	print(' │')
	print('Caught SIGTERM/Disconnect, aborting pending jobs');

	for (let j in jobStatus) {
		try {
			if (!(jobStatus[j].completed)) {
				let resp = await getJson(baseUrl + '/api/app/abort_job', { id: j })
				print('SIGTERM sent to job ' + j);
			}
		}
		catch (e) {
			print('Failed to abort job: ' + j + ': ' + e.message);
		}
	}
	print(' │')
}

// handle termination
process.on('SIGTERM', abortPending)
process.on('disconnect', abortPending)

function hasActiveJob(jobs) {
	for(j in jobs) {
		if(!jobs[j].completed) return true		
	}
	return false
}

// -------------------------- MAIN --------------------------------------------------------------//

const stream = new JSONStream( process.stdin, process.stdout );
stream.on('json', function (job) {

	stream.write({ progress: 0.01 })

	let concur = parseInt(process.env['WF_CONCUR']) || 1

	let wf_strict = parseInt(process.env['WF_STRICT']) || 0 // report error on any job failure (warning is default)

	let workflow = Array.isArray(job.workflow) ? job.workflow : []

	let chainArgs = (job.chain_data || {}).args
	if(Array.isArray(chainArgs)) {
		let newWorkflow = []
		workflow.forEach(e => {
			if(!e.arg) {
				chainArgs.forEach(arg => { // generate new task for each chain arg
					if(typeof arg !== 'string') return
					let newStep = Object.assign({}, e)
					newStep.arg = arg
					newWorkflow.push(newStep)
				})
			}
			else {
				newWorkflow.push(e)
			}
		})

		workflow = newWorkflow

	}



	taskList = workflow.map((e, i) => { 
		e.stepId = i + 1;
		e.arg = e.arg || process.env['JOB_ARG'] || 0 ; // use WFs arg as the default for child's args
		return e 
	})


	let opts = job.options || {}

	let startFrom = opts.wf_start_from_step || 1
	if (startFrom > taskList.length) stream.write({complete: 1, code: 1, description: '"Start From" parameter cannot exceed event list length'})
	// throw new Error('"Start From" parameter cannot exceed event list length')

	let skip = taskList
		.filter((e, i) => (i + 1 < startFrom) || !!e.disabled)
		.map(e => `[${e.stepId}] ${e.title} ${e.arg ? '@' + e.arg : ''}`)

	// exclude disabled/skipped jobs, form final task list
	taskList = taskList.filter((e, i) => i + 1 >= startFrom && !e.disabled)
	// adjust concurrency level if needed
	if (concur > taskList.length) concur = taskList.length

	/// sanity check
	if (taskList.length == 0) stream.write({complete: 1, code: 1, description: 'At least one workflow event is required'})
	 // throw new Error('At least one workflow event is required');
	if (taskList.filter(e => e.id == process.env['JOB_EVENT']).length > 0) throw new Error("Workflow refers to itself");

	async function poll() {

		// get a list of all scheduled jobs to look up event title
		let sched = await getJson(baseUrl + '/api/app/get_schedule') //api_key: apikey,
		let schedTitles = {};
		(sched.data.rows || []).forEach(e => {
			schedTitles[e.id] = e.title
		});
		taskList.forEach(e => { e.title = schedTitles[e.id] || '[Unknown]' })

		let r = await getJson(baseUrl + '/api/app/get_active_jobs')
		let currActive = []
		for (let id in r.data.jobs) { currActive.push(r.data.jobs[id].event) }

		print(`	\u001b[1mJob Schedule [Concurrency: ${concur}, From Step: ${startFrom}]\u001b[22m`);
		print(`${EOL} RUNNING(${taskList.length}): `)

		let lineLen = 0;
		taskList.forEach(e => {
			let msg = ` [${e.stepId}] ${e.title} (${e.id}) ${e.arg ? ('@' + e.arg) : ''}`
			if (currActive.includes(e.id)) msg += `⚠️ already in progress  `
			lineLen = lineLen > msg.length ? lineLen : msg.length
			print(msg)
		});

		print(' ' + '─'.repeat(lineLen))

		if (skip.length > 0) {
			print(` SKIPPING(${skip.length}):\n` + skip.map(e => " " + e).join("\n"))
			print(' ' + '─'.repeat(lineLen))
		}

		print(`\n\n\u001b[1m\u001b[32mWorkflow Started\u001b[39m\u001b[22m @ ${(new Date()).toLocaleString()}\n │  `)

		let pendingJobs = taskList.length

		// launch first batch of jobs
		for (let q = 0; q < concur; q++) {
			let task = taskList[q];
			print(` ${EOL} ├───────> starting \u001b[1m${task.title}\u001b[22m${task.arg ? ': ' + task.arg : ''}`);

			try {
				let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, arg: task.arg || 0, args: task.arg || 0  });
				if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
				jobStatus[job.data.ids[0]] = {
					event: task.id
					, title: task.title
					, arg: task.arg
					, completed: false
					, code: 0
					, seq: q + 1
					, start: (new Date()).toLocaleTimeString()
					, rerunid: ' '
				}

			}
			catch (e) {
				errorCount += 1;
				jobStatus[task.id] = {
					event: task.id,
					title: task.title,
					arg: task.arg,
					completed: false,
					code: 1,
					seq: q + 1,
					start: (new Date()).toLocaleTimeString(),
					description: e.message,
					elapsed: 0
				}
				continue;
			}
		}

		print(' │  ');

		let next = concur;
		// begin polling
		while (pendingJobs > 0 && hasActiveJob(jobStatus)) {

			await sleep(1000);

			let resp = await getJson(baseUrl + '/api/app/get_active_jobs')
			let activeJobs = resp.data.jobs

			let rerunList = {};
			for (r in activeJobs) {
				if (activeJobs[r].when) {
					rerunList[activeJobs[r].id] = { id: r, when: activeJobs[r].when, retries: activeJobs[r].retries }
				}
			}

			for (let j in jobStatus) {

				if (jobStatus[j].completed) continue // do nothing if completed

				// in case job is waiting to rerun on failure, just report error and release it from WF
				if (rerunList[j] && jobStatus[j].rerunid !== rerunList[j].id) {
					jobStatus[j].rerunid = rerunList[j].id
					let attLeft = rerunList[j].retries ? `retries left: ${rerunList[j].retries}` : 'last attempt'
					print(` ├───── ⚠️ ${jobStatus[j].title} failed, will retry at ${niceInterval(rerunList[j].when, true)} [${attLeft}] ${EOL} │`)  //${niceInterval(rerunList[j].when, true)}
					continue
				}

				if (!(resp.data.jobs[j]) && !(rerunList[j])) {  // if job is not in active job list or rerun queue - mark as completed
                    
					// this should be at the top of "if", to avoid infinite loop (bug on early 1.7.x)
					jobStatus[j].completed = true 
					pendingJobs -= 1

					//if(rerunList[j]) print(`job ${j} is still running on background`)

					let msg = '';


					// if job failed to start

					if (jobStatus[j].code) { msg = ` │ \u001b[31m${bullet}\u001b[39m ${jobStatus[j].title}: \u001b[31m${jobStatus[j].description}\u001b[39m` }
					// normal handling - look up job stats in history
					else {
						// check job status
						let jstat = "";
						let desc = "  ";

						// retrieve completed job details. API call may fail due to network lag/error, WF will try it few more times before crashing.
						let lag = 30
						let jd = {}

						try {
							await sleep(lag);
							jd = await getJson(baseUrl + '/api/app/get_job_details', { id: j })
							// emulate random error
							// if (parseInt(Math.random()*5 + 1) > 3) throw new Error("get_job api is not available (emulating error)")
						}
						catch (e) {
							// you get here if job is no longer active, but still has no log stored. 
							// in this case just indicate that ob is finishing up and keep waiting for log info.
							if (finishingJobs[j]) { 
								finishingJobs[j] += 1							
							}
							else {
								finishingJobs[j] = 1
								print(` ├───────> ${jobStatus[j].title} (${j}): faild to fetch status due to [${e.message}]. Will retry few more times`)
								stream.write({memo: `API error: ${j}`})
							}
                            
							// if cannot retreive job detail, mark job as "incomplete" and retry on the few next cycles before reporting an error
							if(finishingJobs[j] < 5) {
								jobStatus[j].completed = false 
								pendingJobs += 1
								// print(` │ ⚠️ ${j}: ${finishingJobs[j]}`) // debug
								continue
							}
							else {
								print(` │ ⚠️ Failed to fetch ${j} status after multiple attempts, marking job as failed`)
								jd = {
									data: {
										job: {
											code: 1,
											description: "failed to retreive job state (check job logs)",
											elapsed: 0
										}
									}
								}
							}

							// print(" │  ---- DEBUG: ----:", e.message) // just for testing
							// if(finishingJobs[j] >)
							// continue
						}

						let compl = jd.data.job;
						if (compl) {
							if (compl.code == 0) { jstat = `\u001b[32m${bullet}\u001b[39m` }
							else if (compl.code == 255) { jstat = `\u001b[33m${bullet}\u001b[39m`; desc = `${EOL} │    warn: \u001b[33m${compl.description}\u001b[39m  ` }
							else {
								errorCount += 1;
								jstat = `\u001b[31m${bullet}\u001b[39m`;
								desc = `${EOL} │    Error: \u001b[31m${compl.description}\u001b[39m  `
								if (max_errors && errorCount >= max_errors) shuttingDown = true; // prevent launching new jobs

							}
							jobStatus[j].elapsed = compl.elapsed
							jobStatus[j].description = compl.description || compl.memo || ''
							jobStatus[j].code = compl.code
						}
						let prog = `[${taskList.length - pendingJobs}/${taskList.length}]`
						let arg = jobStatus[j].arg ? ': ' + jobStatus[j].arg : ''
						let memo = compl.memo ? ', memo: ' + compl.memo : ''
						msg = ` │ ${jstat} ${jobStatus[j].title + arg} (job ${j}) completed ${prog} at ${(new Date()).toLocaleTimeString()}${EOL} │      \u001b[33melapsed in ${niceInterval(jobStatus[j].elapsed)}${memo}\u001b[39m  ${desc}`
					}

					msg += EOL + ' │'

					// starting next job in queue
					if (next < taskList.length && !shuttingDown) {

						let task = taskList[next]

						msg += `${EOL} ├───────> starting \u001b[1m${task.title}\u001b[22m${task.arg ? ': ' + task.arg : ''}`;

						try {
							let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, arg: task.arg, args: task.arg });
							if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
							jobStatus[job.data.ids[0]] = {
								event: task.id
								, arg: task.arg
								, title: task.title
								, completed: false
								, code: 0
								, seq: next + 1
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
								, seq: next + 1
								, start: (new Date()).toLocaleTimeString()
								, description: e.message
								, elapsed: 0
							}
						}
						next += 1
					}

					print(msg);

					if (max_errors && errorCount >= max_errors && !aborting) {
						print(` │${EOL} │ ⚠️ Error count exceeded maximum, aborting workflow...`)
						exceededMaxErrors = true;
						await abortPending();
					}

					print(' │');
					stream.write({ progress: (1 - pendingJobs / taskList.length) })
				}
			} // for each job
            
		} // while
        
		if(shuttingDown || aborting) print(`${EOL}\u001b[1m\u001b[31mWorkflow Aborted\u001b[39m\u001b[22m @${(new Date()).toLocaleString()}  `)
		else print(`${EOL}\u001b[1m\u001b[32mWorkflow Completed\u001b[39m\u001b[22m @${(new Date()).toLocaleString()}  `)

		// print performance
		let perf = {}
		Object.keys(jobStatus).forEach(key => {
			let arg = jobStatus[key].arg ? '@' + jobStatus[key].arg : ''
			let perf_key = `${jobStatus[key].seq}.` + (jobStatus[key].title || '[Unknown]') + arg
			perf[perf_key] = jobStatus[key].elapsed || 0
		})

		function getNiceTitle(job, id) {
			if(!job) return ''
			let title = '<b> ' + job.seq + ' :: ' + (job.title || 'Unknown') + '</b>'
			// if(id) title = `${id} :: ${title} `
			// if(job.arg) title = title + ' :: ' + job.arg
			if(job.arg) title = title + '@' + job.arg
			return he.encode(title)
		}

		function getNiceStatus(job) {
			return job.code ? (job.code == 255 ? '<span style="color:orange"><b>⚠️</b></span>' : '<span style="color:red"><b>✗</b></span>') : '<span style="color:green"><b>✔</b></span>'
		}

		var table = {
			title: "Workflow Events",
			header: [
				"#", "title", "arg", "job", "started at", "elapsed", "status", "view log",  "description"
			],
			rows: Object.keys(jobStatus).map(key => [
				jobStatus[key].seq,
				
				`<span style="${jobStatus[key].code % 255 ? 'color:red' : ''}"><b>${he.encode(jobStatus[key].title) || '[Unknown]'}</b></span>`,  //title
				(jobStatus[key].arg ? he.encode(jobStatus[key].arg) : ''),  // arg			
				key === jobStatus[key].event ? '' : `<a href="/#JobDetails?id=${key}" target="_blank">${key}</a>`,  // joblink
				jobStatus[key].start,
				niceInterval(jobStatus[key].elapsed),
				getNiceStatus(jobStatus[key]), // status
				key === jobStatus[key].event ? '' : `<i id="view_${key}" onclick="this.className = this.className == 'fa fa-eye' ? 'fa fa-eye-slash' : 'fa fa-eye'; $P().get_log_to_grid(filterXSS(\`${getNiceTitle(jobStatus[key], key)}\`), '${key}')" style="cursor:pointer" class="fa fa-eye"></i>`,
				//jobStatus[key].code ? `${he.encode(jobStatus[key].description)}`.substring(0,120) : ''
				`${he.encode(jobStatus[key].description)}`.substring(0, 120)

			]),
			caption: ""
		};

		stream.write({ perf: perf, table: table })

		let result = { complete: 1, code: 0 }
		if (errorCount > 0) result = { complete: 1, code: (wf_strict ? 1 : 255), description: `WF - ${errorCount} out of ${taskList.length} jobs reported error` }
		if (exceededMaxErrors) result = { complete: 1, code: 1, description: "WF Error count exceeded maximum" }
		if (errorCount == taskList.length) result = { complete: 1, code: 1, description: "WF - All jobs failed" }
		stream.write(result)

		shuttingDown = true
		normalShutDown = true // block abortPending on normal exit
		if(process.connected) process.disconnect()

	};

	poll().catch(e => {
		stream.write({ complete: 1, code: 1, description: 'Plugin crashed: ' + e.message })
		//if(process.connected) process.disconnect()
		process.exit(1)
	});

});