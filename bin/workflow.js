#!/usr/bin/env node

const rl = require('readline').createInterface({ input: process.stdin });
const PixlRequest = require('pixl-request');
const request = new PixlRequest();

process.stdin.setEncoding('utf8');
process.stdout.setEncoding('utf8');

let apikey = process.env['TEMP_KEY']
let baseUrl = process.env['BASE_URL'] || 'http://localhost:3012'

let taskList = []  // todo list
let jobStatus = {}  // a map of launched jobs

let errorCount = 0
let wfStatus = 'running'
let max_errors = parseInt(process.env['WF_MAXERR']);

//console.log(process.env)

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
	for (j in jobStatus) {
		try {
			let title = jobStatus[j].title;
			if (!(jobStatus[j].completed)) {
				let resp = await getJson(baseUrl + '/api/app/abort_job', { id: j, api_key: apikey })
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

	let wf_type = process.env['WF_TYPE'] || 'category'  // cat or event
	let wf_strict = parseInt(process.env['WF_STRICT']) // report error on child failure (warning is default)
	let eventid = process.env['WF_EVENT']  // target event
	let event_params = (process.env['ARGS'] || '').trim();
	if(eventid == process.env['JOB_EVENT']) throw new Error("Event Workflow is not allowed to run itself!");
	//let pendingJobs = 0;

	async function poll() {

		// get a list of tasks (either events of category or same job with different parameters)

		if (wf_type == 'event') {  // run event N times
			
			if(!event_params) throw new Error('Event Workflow requires at least 1 argument');

			let evt = await getJson(baseUrl + '/api/app/get_event', { api_key: apikey, id: eventid })
			if (evt.data.plugin == 'workflow') throw new Error('Workflow events are not allowed for this action')
			console.log(`Running event: \u001b[1m${evt.data.event.title}\u001b[22m  `)

			let concur_info = concur > evt.data.event.max_children ? '(reset to event concurrency)' : '';
            concur = Math.min(concur, evt.data.event.max_children) || 1
			console.log(`Concurrency level: ${concur} ${concur_info}`);
			
			taskList = event_params.split(',')
			    .map(e=>e.trim())
				.filter(e => e.match(/^[\w\.\@\-\s]+$/g))
				.map(arg => {
				return {
					id: evt.data.event.id,
					title: evt.data.event.title + `@${arg}`,
					plugin: evt.data.event.plugin,
					arg: arg,
				}
			});
			if(taskList.length == 0) throw new Error('Event Workflow has no valid arguments')
		}
		else { // run all jobs in category
			let sched = await getJson(baseUrl + '/api/app/get_schedule', { api_key: apikey })
			console.log(`Running category: \u001b[1m${input.category_title}\u001b[22m  `)
			taskList = sched.data.rows
				.filter(t => t.category == input.category && t.id !== input.event && t.plugin != 'workflow')
				.sort((a, b) => a.title.localeCompare(b.title))
			if (concur > taskList.length || !concur) concur = taskList.length
		}

		// -----------------
		// get list of running events (prior to wf). This also asserts api endpoint
		let r = await getJson(baseUrl + '/api/app/get_active_jobs', { api_key: apikey })
		let currActive = []
		for (let id in r.data.jobs) { currActive.push(r.data.jobs[id].event) }

		console.log('Job Schedule:');
		let s = 1;
		let lineLen = 0;
		taskList.forEach(e => {
			msg = ` ${s})  ${e.title} (${e.id}), plugin: ${e.plugin} `
			//if (wf_type == 'event') msg += '| ARG = ' + e.arg + '  ';
			if (wf_type == 'category' && currActive.includes(e.id)) msg += `⚠️ already in progress  `
			lineLen = lineLen > msg.length ? lineLen : msg.length
			console.log(msg);
			s += 1;
		});
		console.log('-'.repeat(lineLen));
		console.log(`\n\n\u001b[1m\u001b[32mWorkflow Started\u001b[39m\u001b[22m @ ${(new Date()).toLocaleString()}\n |  `)

		let pendingJobs = taskList.length

		// launch first batch of jobs
		for (q = 0; q < concur; q++) {
			let task = taskList[q];
			console.log(` | 🚀 --> starting ${task.title}  `);

			try {
				let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, api_key: apikey, arg: task.arg || 0 });
				if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
				jobStatus[job.data.ids[0]] = { event: task.id, title: task.title, arg: task.arg, completed: false, code: 0 }

			}
			catch (e) {
				errorCount += 1;
				jobStatus[task.id] = {
					event: task.id,
					title: task.title,
					arg: task.arg,
					completed: false,
					code: 1,
					description: e.message,
					elapsed: 0
				}
				continue;
			}
		}

		console.log(' |  ');

		let next = concur;
		// begin polling
		while (pendingJobs) {

			await sleep(1000);

			let resp = await getJson(baseUrl + '/api/app/get_active_jobs', { api_key: apikey })
			let activeJobs = resp.data.jobs

			let rerunList = {};
			for (r in activeJobs) { if (activeJobs[r].when) { rerunList[activeJobs[r].id] = activeJobs[r].when } }

			for (j in jobStatus) {

				if (jobStatus[j].completed) continue // do nothing if completed

				if (!(resp.data.jobs[j])) {  // if job is not in active job list mark as completed
					jobStatus[j].completed = true
					pendingJobs -= 1

					let msg = '';

					// in case job is waiting to rerun on failure, just report error and release it from WF
					if (rerunList[j]) {
						errorCount += 1
						msg = ` | ❌ ${jobStatus[j].title} failed, but scheduled to rerun at ${niceInterval(rerunList[j], true)}. Releasing job ${j} from workflow`
					}
					// if job failed to start
					else if (jobStatus[j].code) { msg = ` | 💥 ${jobStatus[j].title}: ${jobStatus[j].description}` }
					// normal handling - look up job stats in history
					else {
						// check job status
						let jstat = "";
						let desc = "  ";
						await sleep(30); // a little lag to avoid "job not found" error
						let jd = await getJson(baseUrl + '/api/app/get_job_details', { id: j, api_key: apikey })
						let compl = jd.data.job;
						if (compl) {
							if (compl.code == 0) { jstat = '✔️' }
							else if (compl.code == 255) { jstat = '⚠️'; desc = `\n |    warn: \u001b[33m${compl.description}\u001b[39m  ` }
							else {
								errorCount += 1;
								jstat = '❌';
								desc = `\n |    err: \u001b[31m${compl.description}\u001b[39m  `
								if (max_errors && errorCount >= max_errors) wfStatus = 'abort'; // prevent launching new jobs

							}
							jobStatus[j].elapsed = compl.elapsed
						}
						msg = ` | ${jstat} ${jobStatus[j].title} (job ${j}) completed at ${(new Date()).toLocaleTimeString()}\n |      \u001b[33melapsed in ${niceInterval(jobStatus[j].elapsed)}\u001b[39m  ${desc}`
					}

					msg += (pendingJobs ? `\n |    [ ${pendingJobs} more job(s) to go ]  ` : '  ')

					// starting next job in queue
					if (next < taskList.length && wfStatus != 'abort') {

						let task = taskList[next];

						msg += `--> starting \u001b[1m${task.title}\u001b[22m 🚀  `;
						//if (taskList[next].arg) msg += `[ARG=${taskList[next].arg}]  `;
						try {
							let job = await getJson(baseUrl + '/api/app/run_event', { id: task.id, api_key: apikey, arg: task.arg || 0 });
							if (job.data.queue) throw new Error("Event has beed added to internal queue and will run independently from this WF")
							jobStatus[job.data.ids[0]] = { event: task.id, arg: task.arg, title: task.title, completed: false, code: 0 }
						}
						catch (e) {
							errorCount += 1;
							jobStatus[task.id] = {
								event: task.id,
								arg: task.arg,
								title: task.title, completed: false,
								code: 1, description: e.message, elapsed: 0
							}
						}
						next += 1
					}

					console.log(msg);

					if (max_errors && errorCount >= max_errors) {
						console.log(" |\n ⚠️ Error count exceeded maximum, aborting workflow...")
						wfStatus = 'abort';
						await abortPending();
						throw new Error("WF Error count exceeded maximum");

					}

					console.log(' |');
					console.log(JSON.stringify({ progress: (1 - pendingJobs / taskList.length) }))
				}
			}
		}

		console.log(`\n\u001b[1m\u001b[32mWorkflow Completed\u001b[39m\u001b[22m @${(new Date()).toLocaleString()}  `)

		// print performance
		let perf = {}
		Object.keys(jobStatus).forEach(key => {
			let perf_key = jobStatus[key].arg ? 'arg: ' + jobStatus[key].arg : jobStatus[key].title
			perf[perf_key] = jobStatus[key].elapsed || 0
		})
		console.log(JSON.stringify({ perf: perf }))

		let result = { complete: 1, code: 0 }
		if (errorCount > 0) result = { complete: 1, code: (wf_strict ? 1 : 255), description: `WF - ${errorCount} out of ${taskList.length} jobs reported error` }
		if (errorCount == taskList.length) result = { complete: 1, code: 1, description: "WF - All jobs failed" }
		console.log(JSON.stringify(result))


	};

	poll().catch(e => console.log(JSON.stringify({ complete: 1, code: 1, description: e.message })));
	rl.close();

});
