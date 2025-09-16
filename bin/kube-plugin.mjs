#!/usr/bin/env node

import { KubeConfig, CoreV1Api, AppsV1Api, BatchV1Api, Watch, Log } from '@kubernetes/client-node';
// import { topNodes, Metrics} from '@kubernetes/client-node';
import { readFileSync } from 'fs'
import { PassThrough } from 'stream';
import { EOL } from 'os'
import { load } from 'js-yaml'

// cronicle should send job json to stdin
let job = {}
try { job = JSON.parse(readFileSync(process.stdin.fd)) } catch { }
const params = job.params || {}


// ------  helpers functions
const VERBOSE = parseInt(process.env['VERBOSE'])
const print = (text) => process.stdout.write(text + EOL)
const printInfo = (text) => { if (VERBOSE) process.stdout.write(`[INFO][${new Date().toISOString()}] \x1b[32m${text}\x1b[0m` + EOL) }
const printWarning = (text) => process.stdout.write(`[WARN][${new Date().toISOString()}] \x1b[33m${text}\x1b[0m` + EOL)
const printError = (text) => process.stdout.write(`\x1b[31m${text}\x1b[0m` + EOL)
const printJSONMessage = (complete, code, description) => {
  let msg = JSON.stringify({ complete: complete, code: code, description: description })
  process.stdout.write(msg + EOL)
}

const exit = (message, code = 1) => {
  printJSONMessage(1, code, message)
  if (process.connected) process.disconnect()
  process.exit(code)
}

function getPrettyAge(startTime, endTime) {
  if (!startTime) return '---'
  let endTs = endTime ? new Date(endTime) : Date.now()
  const { floor } = Math;
  try {
    let seconds = floor((endTs - new Date(startTime)) / 1000);
    if (seconds >= 86400) return `${floor(seconds / 86400)}d ${floor((seconds % 86400) / 3600)}h`;
    if (seconds >= 3600) return `${floor(seconds / 3600)}h ${floor((seconds % 3600) / 60)}m`;
    if (seconds >= 60) return `${floor(seconds / 60)}m`;
    return `${seconds}s`;
  }
  catch { return '---' }
}

// ------------ Resolve job parameters -----------------------

const KUBE_CONFIG = params.config || process.env['KUBE_CONFIG']
let NAMESPACE = process.env['NAMESPACE'] || 'default'
const SCRIPT = process.env['SCRIPT'] || '#!/usr/bin/env sh\necho "Empty script"'
const JOB_ID = job.id || process.pid
const IMAGE = process.env['IMAGE'] || 'alpine:latest';
const json = !!parseInt(process.env['JSON'])
const autoRemove = !parseInt(process.env['KEEP_POD'])
const podPrefix = params.prefix || 'cronicle-'
const logTailSize = process.env['LOG_TAIL'] ? parseInt(process.env['LOG_TAIL']) : 40

let asJob = !!parseInt(process.env['KUBE_JOB'])  // run as job vs pod
const jobTTL = parseInt(process.env['KUBE_JOB_TTL']) || 60 * 60 // keep job record TTL, seconds
const jobRetries = parseInt(process.env['KUBE_JOB_BACKOFF']) || 0 // backoff limit

const listLimit = parseInt(process.env['LIST_LIMIT']) || 50
const listObject = process.env['LIST_OBJECT'] || 'pods'

let volumes = []
let volumeMounts = []

if(typeof params.pvc === 'string' && params.pvc.trim() !== '') {
  let mntPath = params.pvc.split(':')[1] || '/data'
  let pvc = params.pvc.split(':')[0]
  volumes.push({ name: `cronicle-volume`, persistentVolumeClaim: { claimName: pvc } });
  volumeMounts.push({ mountPath: mntPath, name: `cronicle-volume` });
}

// ---------------- KUBERNETES APIs

const kc = new KubeConfig();

if (KUBE_CONFIG && KUBE_CONFIG.trim() !== "") {
  try { kc.loadFromString(KUBE_CONFIG) }
  catch {
    printWarning("Invalid kube config setting. Falling back to default")
    console.log(KUBE_CONFIG)
    kc.loadFromDefault()
  }
}
else { kc.loadFromDefault() }

const k8sApi = kc.makeApiClient(CoreV1Api);
const watch = new Watch(kc);
const batchV1Api = kc.makeApiClient(BatchV1Api);
const appsV1Api = kc.makeApiClient(AppsV1Api)
const log = new Log(kc);
// let metricsClient = new Metrics(kc)

// ------ ABORT/SHUTDOWN ------

let EXIT_CODE = 0
let eventWatch;
let isReady = false;
let objDeletionRequestSent = false;
let shuttingDown = false;
let failedToStart = false;

let kubeShutDown = async function () {
  printWarning("Kube shut down is not defined for this task")
}

let sig = process.connected ? 'disconnect' : 'SIGTERM'
process.on(sig, async (message) => {
  printWarning('Caught SIGTERM')
  await kubeShutDown()
})


// --------- Resolve ENV Variables (to pass to pod) -------------------------//
let exclude = ['KUBE_CONFIG']
let include = ['BASE_URL', 'BASE_APP_URL', 'NAMESPACE', 'KEEP_POD', 'IMAGE']
let truncVar = parseInt(process.env['TRUNC_VAR'])
let envVars = Object.entries(process.env)
  .filter(([k, v]) => ((k.startsWith('JOB_') || k.startsWith('KUBE_') || k.startsWith('ARG') || include.indexOf(k) > -1) && exclude.indexOf(k) === -1))
  .map(([k, v]) => { return { name: (truncVar ? k.replace(/^KUBE_/, '') : k), value: v } })


// ------------------------ POD/JOB Manifest for Kube-Run --------------------------------

let cpu_limit = (job.params.cpu_limit || '').trim() || '1000m'
let mem_limit = (job.params.mem_limit || '').trim() || '512Mi'

let objName = podPrefix + JOB_ID
let SCRIPT_BASE64 = Buffer.from(SCRIPT).toString('base64')
let podLabels = {
  category: process.env['JOB_CATEGORY_TITLE'] || 'General',
  app: 'cronicle-job',
  event_title: process.env['JOB_EVENT_TITLE'] || 'unknown',
  event: process.env['JOB_EVENT'] || 'unknown'
}

let podManifest = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: objName,
    namespace: NAMESPACE,
    labels: podLabels
  },
  spec: {
    serviceAccountName: (job.params.svc_account || '').trim() || 'default',
    volumes: volumes,
    containers: [
      {
        name: objName,
        image: IMAGE,
        imagePullPolicy: process.env['IMAGE_PULL_POLICY'] || 'Always',
        terminationGracePeriodSeconds: 10, // vs 30 default, to be inline with cronicle
        resources: {
          limits: {
            cpu: cpu_limit,
            memory: mem_limit
          }
        },
        command: [
          'sh',
          '-c',
          `echo "${SCRIPT_BASE64}" | base64 -di > ./tmp-script.sh && chmod +x ./tmp-script.sh && ./tmp-script.sh`
        ],
        env: envVars,
        volumeMounts: volumeMounts
      },
    ],
    restartPolicy: process.env['RESTART_POLICY'] || 'Never',
  },
};

// ----

let jobManifest = {
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: {
    name: objName,
    namespace: NAMESPACE,
    labels: podLabels
  },
  spec: {
    backoffLimit: jobRetries,
    ttlSecondsAfterFinished: jobTTL,
    template: {
      metadata: {
        name: objName,
        labels: podLabels
      },
      spec: {
        serviceAccountName: (job.params.svc_account || '').trim() || 'default',
        volumes: volumes,
        containers: [
          {
            name: objName,
            image: IMAGE,
            imagePullPolicy: process.env['IMAGE_PULL_POLICY'] || 'Always',
            terminationGracePeriodSeconds: 10, // vs 30 default, to be inline with cronicle
            resources: {
              limits: {
                cpu: cpu_limit,
                memory: mem_limit
              }
            },
            command: [
              'sh',
              '-c',
              `echo "${SCRIPT_BASE64}" | base64 -di > ./tmp-script.sh && chmod +x ./tmp-script.sh && ./tmp-script.sh`
            ],
            env: envVars,
            volumeMounts: volumeMounts
          },
        ],
        restartPolicy: process.env['RESTART_POLICY'] || 'Never',
      },
    },
  },
};

// -------- Kube-Yaml plugin prep -------------------------
if (process.argv[2] === "manifest") {
  let manifest
  
  // parse manifest yaml
  try {
    manifest = load(job.params.manifest);
  } catch {
    exit("Failed to parse manifest (invalid yaml)");
  }


  // make sure manifest is Pod or Job
  if(manifest.kind === "Job") {
    asJob = true;
    jobManifest = manifest;
  }
  else if(manifest.kind === "Pod") {
    asJob = false
    podManifest = manifest;
  }
  else { exit("Invalid manifest kind: " + manifest.kind + " ( expected Pod or Job)") }


  // massage manifest structure
  manifest.metadata = manifest.metadata || {}
  NAMESPACE = manifest.metadata.namespace || NAMESPACE;
  manifest.spec = manifest.spec || {}
  manifest.metadata.labels = manifest.metadata.labels || {}
  if (manifest.metadata.name) objName = manifest.metadata.name + "-" + JOB_ID; // default is cronicle-jobid
  manifest.metadata.name = objName;
  manifest.metadata.labels = {...(manifest.metadata.labels), ...podLabels} // merge labels

  if(asJob) {
    manifest.spec.template = manifest.spec.template || {}
    manifest.spec.template.spec = manifest.spec.template.spec || {}
    manifest.spec.template.metadata = manifest.spec.template.metadata || {}
    manifest.spec.template.metadata.labels = {...(manifest.spec.template.metadata.labels || {}), ...podLabels}
    manifest.spec.template.metadata.name = objName;
    
  }

  let spec = (asJob ? manifest.spec.template.spec : manifest.spec) || {};
  if(!spec.restartPolicy) spec.restartPolicy = 'Never'; // prevent job/pod restart unless user wants it.

  let container = (spec.containers || [])[0]
  if(!container) exit(`Cannot locate container definition (${asJob ? '.spec.template.spec.containers[0]' : '.spec.containers[0]'})`)   

  container.name = objName;
  container.env = [...envVars, ...(container.env || []) ] // merge env vars
  
  if (!job.params.custom_cmd) {
    container.command = [
      "sh",
      "-c",
      `echo "${SCRIPT_BASE64}" | base64 -di > ./tmp-script.sh && chmod +x ./tmp-script.sh && ./tmp-script.sh`,
    ];
  }
  
}

// ==========================================================================================

async function listPods(namespace = 'default') {

  const res = await k8sApi.listNamespacedPod({ namespace: namespace }); // to do wrap it in try/catch
  const limit = listLimit || 50;
  let pods = res.items;
  let podNote = ''

  if (pods.length > limit) {
    podNote = `(listing ${limit} of ${pods.length})`
    // pods = pods.slice(0, limit)
  }


  // Transform the pod list into table metadata
  const tableMetadata = {
    title: `Pod list on [${namespace}] @ ${kc.getCurrentCluster().name} ${podNote}`,
    header: ["#", "Name", "Labels", "Status", "Image", "Ready", "Node", "Age"],
    rows: pods.slice(0, limit).map((pod, index) => {
      const containerStatuses = pod.status.containerStatuses || [];
      const readyContainers = containerStatuses.filter(c => c.ready).length;
      const totalContainers = containerStatuses.length;
      let labels = pod.metadata?.labels || {}   

      return [
        index + 1,
        pod.metadata.name,
        labels['event_title'] ? labels['category'] + '/' + labels['event_title'] : '', // cron labels
        pod.status.phase,
        containerStatuses.map(c => c.image).join(', ').split('/').pop(),
        `${readyContainers}/${totalContainers}`,
        // containerStatuses.reduce((sum, c) => sum + c.restartCount, 0), // restarts
        pod.spec.nodeName || '(unknown)',
        getPrettyAge(pod.metadata.creationTimestamp) // age
      ];
    }),
    caption: "List of PODS"
  };
  // console.log(kc)
  print(JSON.stringify({ table: tableMetadata }))
  print(JSON.stringify({memo: 'pods: ' + pods.length || 0}))
  print(JSON.stringify({chain_data: pods}))
  printJSONMessage(1, 0, null)
  if (process.connected) process.disconnect()
  process.exit(0)

}

/// ---------------- LIST JOBS

async function listJobs(namespace = 'default') {
  const res = await batchV1Api.listNamespacedJob({namespace:namespace});
  const limit = listLimit || 50;
  let jobs = res.items;
  let jobNote = '';

  if (jobs.length > limit) {
    jobNote = `(listing ${limit} of ${jobs.length})`;
    // jobs = jobs.slice(0, limit);
  }

  // Transform the job list into table metadata
  const tableMetadata = {
    title: `Job list on [${namespace}] @ ${kc.getCurrentCluster().name} ${jobNote}`,
    header: ["#", "State", "Name", "Labels", "Image", "Completions",  "Duration", "Age"],
    rows: jobs.slice(0, limit).map((job, index) => {
      let completionTime = job.status.completionTime || job.status?.conditions[0].lastTransitionTime
      let labels = job.metadata?.labels || {}   
     
      return [
        index + 1,
        job.status.succeeded > 0 ? 'Active' : (job.status.failed > 0 ? 'Failed' : 'Unknown'), // State
        job.metadata.name,
        labels['event_title'] ? labels['category'] + '|' + labels['event_title'] : '', // labels
        job.spec?.template?.spec?.containers[0].image,
        `${job.status.succeeded || 0}/${job.spec.completions || 1}`, // Completions
        getPrettyAge(job.status.startTime, completionTime ), // duraiton
        getPrettyAge(job.metadata.creationTimestamp) // age
      ];
    }),
    caption: "List of Jobs"
  };

  print(JSON.stringify({ table: tableMetadata }));
  print(JSON.stringify({memo: 'jobs: ' + jobs.length || 0})) // print memo
  print(JSON.stringify({chain_data: jobs})) // forward pods to chain data
  printJSONMessage(1, 0, null);
  if (process.connected) process.disconnect();
  process.exit(0);
}

/// ----------------  LIST DEPLOY -----
async function listApps(namespace = 'default', kind = 'Deployments') {
  
  let res;
  if(kind === 'StatefulSets') res = await appsV1Api.listNamespacedStatefulSet({namespace: namespace})
  else if(kind === 'DaemonSets') res = await appsV1Api.listNamespacedDaemonSet({namespace: namespace})
  else res = await appsV1Api.listNamespacedDeployment({namespace: namespace})

  const limit = listLimit || 50;
  let deployments = res.items || [];  
  let deploymentNote = '';

  if (deployments.length > limit) {
    deploymentNote = `(listing ${limit} of ${deployments.length})`;
    // deployments = deployments.slice(0, limit);
  }

  // Transform the deployment list into table metadata
  const tableMetadata = {
    title: `${kind} list on [${namespace}] @ ${kc.getCurrentCluster().name} ${deploymentNote}`,
    header: ["#", "Name", "Type", "App", "Ready", "Age"],
    rows: deployments.slice(0, limit).map((deployment, index) => {
      let labels = deployment.metadata?.labels || {};   

      return [
        index + 1,
        deployment.metadata.name,
        kind, //Object.keys(res).join('|'),
        labels['app'] || '', // labels
        `${deployment.status.readyReplicas || 0}/${deployment.spec.replicas}`,
        getPrettyAge(deployment.metadata.creationTimestamp) // age
      ];
    }),
    caption: "List of Deployments"
  };

  print(JSON.stringify({ table: tableMetadata }));
  print(JSON.stringify({ memo: kind + ': ' + deployments.length || 0 })); // print memo
  print(JSON.stringify({ chain_data: deployments })); // forward deployments to chain data
  printJSONMessage(1, 0, null);
  if (process.connected) process.disconnect();
  process.exit(0);
}


// --------------------------- HELPERS ------

async function getJobPod(namespace, objName) {
  const pods = await k8sApi.listNamespacedPod({ namespace: namespace, labelSelector: `job-name=${objName}` });
  const sortedPods = pods.items.sort((a, b) => new Date(b.metadata.creationTimestamp) - new Date(a.metadata.creationTimestamp));
  return sortedPods[0];
}

let onContainerReady = async function(){
//   printWarning("Container ready")
}

// ---------- this is meant to watch Pod events
async function startEventWatch(namespace, objName) {
  let eventWatch = await watch.watch(`/api/v1/namespaces/${namespace}/events`, { fieldSelector: `involvedObject.name=${objName}` }
    , async (type, obj) => {
      printInfo('Event: ' + [obj.type, obj.reason, obj.message].join(' | ')) // obj.reportingComponent,

      if(obj.reason === 'Started') {
        isReady = true 
        if(onContainerReady) onContainerReady()
      }

      if(obj.reason === 'Completed') isReady = false
      
      if (obj.reason === 'Failed' && obj.count > 1) {
        failedToStart = true
        // printWarning("Failed to start container, shutting down")
        eventWatch.abort()
        kubeShutDown()
      }
      return
    }, (err) => { printInfo("Shutting down event watch") })

    return eventWatch
}

// ---- This will watch Job and it's related pod events
async function startJobEventWatch(namespace, objName) {
  let eventWatch = await watch.watch(`/api/v1/namespaces/${namespace}/events`, { fieldSelector: `involvedObject.name=${objName}` }
    , async (type, obj) => {
      printInfo('Event: ' + [obj.type, obj.reason, obj.message].join(' | '))
      if (obj.reason === 'Failed' && obj.count > 1) {
        failedToStart = true
        // printWarning("Failed to start container, shutting down")
        eventWatch.abort()
        kubeShutDown()
      }
      else if (obj.reason === 'SuccessfulCreate') { // pod created
        try {
          let currPod = await getJobPod(namespace, objName)
          printInfo(`Begin watch for ${currPod.metadata.name}`)
          await startEventWatch(currPod.metadata.namespace, currPod.metadata.name)
        }
        catch (e) {
          printInfo("Failed to fetch job's pod info")
        }


      }
      return
    }, (err) => { printInfo("Shutting down job event watch") })

    return eventWatch;

}

// ---------------------------- RUN POD -------------------------------------------------------

async function runPod(namespace = 'default') {

  const logStream = new PassThrough();

  logStream.on('data', (chunk) => {
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
  });

  let pod;
  let logReq;

    pod = await k8sApi.createNamespacedPod({
      namespace: namespace,
      body: podManifest,
    });

    let podWatchRequest;

    // ------ shutdown logic -------
    kubeShutDown = async function () {  // this will run on job Abort      
      shuttingDown = true
      if (eventWatch) eventWatch.abort()
      if (podWatchRequest) podWatchRequest.abort() // --- > this will initiate      

    }

    // ----------  print pod metadata
    try {
      let podInfo = await k8sApi.readNamespacedPod({ namespace: namespace, name: objName });
      printInfo(`Pod ${objName} scheduled to run on: ${podInfo?.spec?.nodeName || '(unknown node)'}`)
    }
    catch { printInfo("Failed to fetch pod info") }

    // --- start tracking container scheduling errors 
    try { eventWatch = await startEventWatch(namespace, objName) }
    catch (err) { printWarning("Failed to start event watch") }

    // ----- POD WATCH 

    podWatchRequest = await watch.watch(`/api/v1/namespaces/${namespace}/pods`, {}, async (type, obj) => {
      if (obj.metadata.name !== objName) return
      let containers = obj.status?.containerStatuses || []

      if (!logReq && containers.some(c => c.name === objName && c.ready)) {
        isReady = true
        if (params.detach) {
          printInfo("Pod container started")
          printWarning(`Container started, detaching pod from cronicle job`)
          podWatchRequest.abort()
        }
        else {
          printInfo('Pod is ready, setting up logger')
          try { logReq = await log.log(namespace, objName, objName, logStream, { follow: true, pretty: false, timestamps: false }) }  // , tailLines: 200
          catch { printWarning('failed to init log') }
        }

      }

      printInfo('Pod State: ' + type + '/' + obj.status.phase)

      if (obj.status.phase === 'Succeeded' || obj.status.phase === 'Failed') {

        EXIT_CODE = obj.status.containerStatuses[0].state.terminated.exitCode;
        printInfo('Pod Completed with exit code:' + EXIT_CODE)

        podWatchRequest.abort()

      }
    }, async (err) => { // POD WATCH FINAL CALLBACK

      printInfo("Pod Watch completed")
      if (eventWatch) eventWatch.abort()
      if (logReq) logReq.abort() // sanity check

      // If job exits too fast, logger likely wont'be set. In this case just pull log tail from completed pod
      // No need to do it if container never started or we are in detach mode
      if (!logReq && isReady && !params.detach && logTailSize > 0) {
        printInfo('Pod completed before setting up logger. Pulling log tail')
        try {
          let logTail = await k8sApi.readNamespacedPodLog({
            name: objName, namespace: namespace, container: objName, tailLines: logTailSize
          });
          print(logTail)
        }
        catch { printInfo('Failed to pull log tail') }
      }

      // ---- delete pod if needed 
      if (pod && autoRemove && !objDeletionRequestSent && !params.detach) {

        try {
          objDeletionRequestSent = true
          await k8sApi.deleteNamespacedPod({ namespace: namespace, name: objName });
          printInfo('Pod Deletion request sent')
        }
        catch (e) { printWarning("Pod deletion request failed:" + e.body) }
      }
      else if (params.detach) { printWarning(`Cronicle no longer controls ${objName} pod. Use kubectl or other tool to monitor/delete it as needed`) }
      else { printWarning(`Job is set to keep pod ${objName}. Please remove it manually later from the cluster`) }


      if (err && err.type !== 'aborted') { // unexpected error
        printError(err)
        printJSONMessage(1, 1, 'Pod crashed')
      }
      else { // normal shutdown
        let errDescription = `Pod script failed`
        if (failedToStart) {
          EXIT_CODE = 1
          errDescription = 'Failed to start container'

        }
        printJSONMessage(1, EXIT_CODE, EXIT_CODE ? errDescription : null)
      }
      process.exit(EXIT_CODE)
    });  // POD WATCH FINAL CALLBACK END

    printInfo('Pod Watch started')
} // end of runPod

// ---------------------------- RUN JOB -------------------------------------------------------

async function runJob(namespace = 'default') { 

    let job = await batchV1Api.createNamespacedJob({ namespace: namespace, body: jobManifest });
    printInfo(`Job ${objName} created`)

    let jobWatchRequest;

    kubeShutDown = async function () {  // this will run on job Abort      
      shuttingDown = true
      printInfo("Shutting down job")
      if (eventWatch) eventWatch.abort()
      if (jobWatchRequest) jobWatchRequest.abort()
    }

    // --- start tracking container scheduling errors 
    try { eventWatch = await startJobEventWatch(namespace, objName) }
    catch (err) { printWarning("Failed to start event watch") }

    let jobActive = false

    jobWatchRequest = await watch.watch(`/apis/batch/v1/namespaces/${namespace}/jobs`, {}
      , async (type, obj) => { // watch Process       

        if (obj.metadata.name !== objName) return

        // Check if job really started (not stuck in pending status), so we know when to detach job (if it's needed)

        // Basic scenario - "Ready" status will be emitted once per attempt
        if (obj.status.ready > 0 ) { 
          isReady = true
          if(params.detach) { // it safe to detach job now, our script should be running
            printWarning(`Job container has been started, detaching job from cronicle job`)
            jobWatchRequest.abort()
          }
          else { printWarning(`Job ready (attempt: ${1 + (parseInt(obj.status.failed) || 0)}/${jobRetries + 1})`) }
        }

        // In some Kubes "ready" is not emitted. Instead "Active" is emitted 1 or multiple times when pod is scheduled (or both events emitted)
        // in this case detach should be handled by pod watcher. We need to set onContainerReady callback on first "active" occurance
        if (obj.status.active > 0 && !jobActive && params.detach) { 
             jobActive = true 
             onContainerReady = function() {
                printWarning(`Job container has been started, detaching job from cronicle`)
                jobWatchRequest.abort()               
               }   
            }


        if (obj.status?.conditions) { // condition prop indicates job completion

        
          if (obj.status.conditions.some(e => e.type === 'Complete')) {
            printWarning('Job Completed Successfully')
            EXIT_CODE = 0
          }
          else if (obj.status.conditions.some(e => e.type === 'Failed')) {
            printWarning("Job Completed with errors")
            EXIT_CODE = 1
          }

          // Get the pods created by the job
          try {
            printInfo("Pulling last pod for the job")

            let lastPod = await getJobPod(namespace, objName)

            if (lastPod) {
              const podName = lastPod.metadata.name;
              const containerStatuses = lastPod.status.containerStatuses || [];
              containerStatuses.forEach(status => {
                let podExitCode = parseInt(status.state.terminated.exitCode)
                printInfo(`Pod ${podName} exited with code ${status.state.terminated.exitCode}`);
                EXIT_CODE = podExitCode >= 0 ? podExitCode : EXIT_CODE
              });

              if (logTailSize > 0) {
                printInfo(`Fetching logs for pod ${podName}`)
                print(`#### Logs for pod ${podName}:`)
                const podLogs = await k8sApi.readNamespacedPodLog({ namespace: namespace, name: lastPod.metadata.name, tailLines: logTailSize })
                print(podLogs);
              }
            }
          } catch (e) { printWarning("Failed to fetch pod logs:\n" + e.message) }

          jobWatchRequest.abort()
        }

      }
      , async (err) => { // watch Done
        if (eventWatch) eventWatch.abort()

        if (job && shuttingDown) { // if cronicle job get aborted, also delete kube job
          try {
            await batchV1Api.deleteNamespacedJob({ namespace: namespace, name: objName, propagationPolicy: 'Foreground' })
            printWarning("Job deletion request sent")

          }
          catch (err) { printWarning(`Job deletion request failed, delete ${objName} job manually using kubectl or other tool`) }
        }

        if (err && err.type !== 'aborted') { // unexpected error
          printError(err)
          printJSONMessage(1, 1, 'Job/Pod crashed')
        }
        else { // normal shutdown
          let errDescription = `Job/Pod script failed`
          if (failedToStart) { // if Pod cannot start (e.g. due to image pull error)
            EXIT_CODE = 1
            errDescription = 'Failed to start container'
  
          }
          printJSONMessage(1, EXIT_CODE, EXIT_CODE ? errDescription : null)
        }

        process.exit(EXIT_CODE)

      }
    )
} // end of runJob

// ===================== MAIN =========================

async function main() {
  try {     
    if (process.argv[2] === 'list') {
      if (listObject === 'Jobs') await listJobs(NAMESPACE)
      else if (listObject === 'Deployments') await listApps(NAMESPACE, listObject)
      else if (listObject === 'StatefulSets') await listApps(NAMESPACE, listObject)
      else if (listObject === 'DaemonSets') await listApps(NAMESPACE, listObject)
      else await listPods(NAMESPACE)
    }
    else if (asJob) await runJob(NAMESPACE)
    else await runPod(NAMESPACE)
  }
  catch (err) {
    if (err.body && err.code) { // error coming from kubernetes
      printError('ERROR CODE: ' + err.code)
      try {err.body = JSON.parse(err.body)} catch { }
      printError(err.body.message || err.body)    
      printJSONMessage(1, parseInt(err.code) || 1, 'Kubernetes API error: ' + (err.body.reason || ''))
      process.exit(parseInt(err.code) || 1)
    }
    else {  // run time errors
      printError(`Error: ${err}`)
      printError(err.stack)
      exit('Plugin runtime error')
    }
  }
}

main();
