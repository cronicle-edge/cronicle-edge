#!/usr/bin/env node

// See README.md for documentation, parameters, and job protocol.
// https://github.com/mariovalney/cronicle-easypanel-deploy

'use strict';

const https = require('https');
const http = require('http');

// ─── Configuration ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 24 * 60 * 60 * 1000;

const STATUS_SUCCESS = ['done', 'success', 'completed'];
const STATUS_FAILURE = ['error', 'failed', 'cancelled'];

// ─── Logging (Cronicle protocol) ──────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[INFO] ${msg}\n`);
}

function formatTs(nsTimestamp) {
  const date = new Date(parseInt(nsTimestamp) / 1_000_000);
  return date.toTimeString().slice(0, 8);
}

function progress(value) {
  const p = Math.min(Math.max(value, 0), 1);
  process.stdout.write(JSON.stringify({ progress: p }) + '\n');
  log(`${Math.round(p * 100)}% complete`);
}

function complete(description) {
  process.stdout.write(JSON.stringify({ complete: 1, code: 0, description }) + '\n');
  process.exit(0);
}

function fail(description) {
  process.stdout.write(JSON.stringify({ complete: 1, code: 1, description }) + '\n');
  process.exit(1);
}

// ─── HTTP utilities ───────────────────────────────────────────────────────────

function request(options) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const lib = url.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const body = options.body ? JSON.stringify(options.body) : null;
    if (body) {
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Easypanel API (tRPC) ─────────────────────────────────────────────────────

function makeHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function trpcMutation(baseUrl, token, procedure, body) {
  const url = `${baseUrl}/api/trpc/${procedure}`;
  const res = await request({
    method: 'POST',
    url,
    headers: makeHeaders(token),
    body,
  });
  return res;
}

async function trpcQuery(baseUrl, token, procedure, input) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const url = `${baseUrl}/api/trpc/${procedure}?input=${encoded}`;
  const res = await request({
    method: 'GET',
    url,
    headers: makeHeaders(token),
  });
  return res;
}

async function inspectService(baseUrl, token, projectName, serviceName) {
  const res = await trpcQuery(baseUrl, token, 'services.app.inspectService', {
    projectName,
    serviceName,
  });
  if (res.status === 200 && res.body?.result?.data?.json) {
    return res.body.result.data.json;
  }
  return null;
}

async function destroyService(baseUrl, token, projectName, serviceName) {
  const res = await trpcMutation(baseUrl, token, 'services.app.destroyService', {
    json: { projectName, serviceName },
  });
  if (res.status !== 200) {
    throw new Error(`Failed to destroy service: HTTP ${res.status}`);
  }
}

async function createService(baseUrl, token, params) {
  const body = {
    json: {
      projectName: params.projectName,
      serviceName: params.serviceName,
      source: {
        type: 'github',
        owner: params.githubOwner,
        repo: params.githubRepo,
        ref: params.githubBranch,
        path: params.githubBuildPath || '/',
        autoDeploy: false,
      },
      build: {
        type: 'dockerfile',
        file: params.dockerfile || 'Dockerfile',
      },
      env: params.envString || '',
      deploy: {
        command: params.runCommand || null,
      },
    },
  };

  const res = await trpcMutation(baseUrl, token, 'services.app.createService', body);
  if (res.status !== 200) {
    const msg = res.body?.error?.message || JSON.stringify(res.body);
    throw new Error(`Failed to create service: HTTP ${res.status} - ${msg}`);
  }
}

async function deployService(baseUrl, token, projectName, serviceName) {
  const res = await trpcMutation(baseUrl, token, 'services.app.deployService', {
    json: { projectName, serviceName, forceRebuild: true },
  });
  if (res.status !== 200) {
    const msg = res.body?.error?.message || JSON.stringify(res.body);
    throw new Error(`Failed to start deploy: HTTP ${res.status} - ${msg}`);
  }
}

async function getLatestDeployAction(baseUrl, token, projectName, serviceName) {
  const res = await trpcQuery(baseUrl, token, 'actions.listActions', {
    projectName,
    serviceName,
    type: 'deployment',
    limit: 1,
  });

  if (res.status !== 200) return null;

  const items = res.body?.result?.data?.json;
  if (!Array.isArray(items) || items.length === 0) return null;

  return items[0];
}

async function getServiceLogs(baseUrl, token, projectName, serviceName, startNs) {
  const res = await trpcQuery(baseUrl, token, 'logs.queryServiceLogs', {
    projectName,
    serviceName,
    limit: 100,
    stream: 'stdout',
    start: startNs,
  });

  if (res.status === 500) {
    throw new Error(
      'Could not read service logs. Make sure "Advanced Logs" is enabled in Easypanel (requires Loki).'
    );
  }

  if (res.status !== 200) {
    throw new Error(`Failed to fetch logs: HTTP ${res.status}`);
  }

  return res.body?.result?.data?.json?.entries || [];
}

function parseJobResult(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  for (const entry of entries) {
    for (const [_timestamp, line] of entry.values) {
      try {
        const jsonStart = line.indexOf('{');
        if (jsonStart === -1) continue;
        const parsed = JSON.parse(line.slice(jsonStart));
        if (parsed.complete === 1) return parsed;
      } catch {
        // free-form text line, ignore
      }
    }
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function envJsonToString(jsonStr) {
  if (!jsonStr || !jsonStr.trim() || jsonStr.trim() === '{}') return '';
  const obj = JSON.parse(jsonStr);
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function sanitizeServiceName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
}

// ─── Polling loops ────────────────────────────────────────────────────────────

async function waitForDeploy(baseUrl, token, projectName, serviceName) {
  const startTime = Date.now();

  log(`Monitoring deploy of "${serviceName}"...`);

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > TIMEOUT_MS) {
      throw new Error('24-hour timeout reached waiting for deploy.');
    }

    const estimatedProgress = Math.min(0.95, (elapsed / TIMEOUT_MS) * 0.95);
    progress(estimatedProgress);

    const action = await getLatestDeployAction(baseUrl, token, projectName, serviceName);

    if (!action) {
      log('Waiting for deploy action to appear...');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const status = (action.status || '').toLowerCase();
    log(`Deploy status: "${status}"`);

    if (STATUS_SUCCESS.includes(status)) {
      log('Deploy completed successfully.');
      return true;
    }

    if (STATUS_FAILURE.includes(status)) {
      const reason = action.error || action.message || status;
      throw new Error(`Deploy failed with status "${status}": ${reason}`);
    }

    log(`Status "${status}" is not terminal, continuing to poll...`);
    await sleep(POLL_INTERVAL_MS);
  }
}

async function getServiceStats(baseUrl, token, projectName, serviceName) {
  try {
    const res = await trpcQuery(baseUrl, token, 'monitorOld.getServiceStats', {
      projectName,
      serviceName,
    });
    if (res.status === 200 && res.body?.result?.data?.json) {
      return res.body.result.data.json;
    }
  } catch {
    // stats are informational, not critical
  }
  return null;
}

function logServiceStats(stats) {
  if (!stats) return;

  const cpu = stats.cpu?.percent != null
    ? `CPU: ${stats.cpu.percent.toFixed(2)}%`
    : null;

  const memMB = stats.memory?.usage != null
    ? (stats.memory.usage / 1024 / 1024).toFixed(1)
    : null;
  const memPct = stats.memory?.percent != null
    ? stats.memory.percent.toFixed(2)
    : null;
  const mem = memMB && memPct ? `Memory: ${memMB} MB (${memPct}%)` : null;

  const netInMB = stats.network?.in != null
    ? (stats.network.in / 1024 / 1024).toFixed(2)
    : null;
  const netOutMB = stats.network?.out != null
    ? (stats.network.out / 1024 / 1024).toFixed(2)
    : null;
  const net = netInMB && netOutMB ? `Network: ↓${netInMB} MB  ↑${netOutMB} MB` : null;

  const parts = [cpu, mem, net].filter(Boolean);
  if (parts.length > 0) {
    process.stdout.write(`[PERF] ${parts.join('  |  ')}\n`);
  }
}

async function waitForJobComplete(baseUrl, token, projectName, serviceName) {
  const startTime = Date.now();
  const startNs = String(startTime * 1_000_000);
  let lastSeenTs = startNs;
  const collectedLogs = [];

  log('Waiting for job result in logs...');

  await sleep(POLL_INTERVAL_MS);

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error('24-hour timeout reached waiting for job result.');
    }

    const entries = await getServiceLogs(baseUrl, token, projectName, serviceName, startNs);

    if (entries && entries.length > 0) {
      const newLines = [];
      for (const entry of entries) {
        for (const [ts, line] of entry.values) {
          if (ts > lastSeenTs) newLines.push([ts, line]);
        }
      }

      newLines.sort((a, b) => (a[0] < b[0] ? -1 : 1));

      for (const [ts, line] of newLines) {
        if (ts > lastSeenTs) lastSeenTs = ts;

        collectedLogs.push([ts, line]);

        try {
          const jsonStart = line.indexOf('{');
          if (jsonStart === -1) continue;
          const parsed = JSON.parse(line.slice(jsonStart));

          if (parsed.complete === 1) return { result: parsed, logs: collectedLogs };

          if (typeof parsed.progress === 'number') {
            progress(parsed.progress);
          }
        } catch {
          // free-form text line, ignore
        }
      }
    }

    const stats = await getServiceStats(baseUrl, token, projectName, serviceName);
    logServiceStats(stats);

    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let job, params;
  try {
    job = JSON.parse(input);
    params = job.params || {};
  } catch {
    fail('Failed to parse stdin JSON input.');
  }

  const required = ['project_name', 'service_name', 'github_owner', 'github_repo', 'github_branch', 'easypanel_url'];
  for (const key of required) {
    if (!params[key] || !String(params[key]).trim()) {
      fail(`Missing required parameter: "${key}"`);
    }
  }

  const token = (params.easypanel_token || '').trim();
  if (!token) {
    fail('Easypanel token not set. Configure the "easypanel_token" parameter on the plugin.');
  }

  const baseUrl = params.easypanel_url.trim().replace(/\/+$/, '');
  const projectName = params.project_name.trim();

  const usePrefix = params.service_name_as_prefix == 1 || params.service_name_as_prefix === true;
  const rawName = usePrefix
    ? `${params.service_name}-${job.id}`
    : params.service_name;
  const serviceName = sanitizeServiceName(rawName);

  log(`Starting deploy of service "${serviceName}" in project "${projectName}"`);
  log(`Repository: ${params.github_owner}/${params.github_repo}@${params.github_branch}`);

  log('Checking if service already exists...');
  const existing = await inspectService(baseUrl, token, projectName, serviceName);

  if (existing) {
    fail(`Service "${serviceName}" already exists in project "${projectName}". Remove it before running the job.`);
  } else {
    log('No existing service found. Proceeding with creation.');
  }

  let envString = '';
  if (params.env_vars && params.env_vars.trim() && params.env_vars.trim() !== '{}') {
    try {
      envString = envJsonToString(params.env_vars);
    } catch {
      fail('The "env_vars" field is not valid JSON. Example: {"KEY": "value"}');
    }
  }

  log('Creating service in Easypanel...');
  await createService(baseUrl, token, {
    projectName,
    serviceName,
    githubOwner: params.github_owner.trim(),
    githubRepo: params.github_repo.trim(),
    githubBranch: params.github_branch.trim(),
    githubBuildPath: (params.github_build_path || '/').trim(),
    dockerfile: (params.dockerfile || 'Dockerfile').trim(),
    runCommand: (params.run_command || '').trim() || null,
    envString,
  });
  log('Service created successfully.');

  await waitForDeploy(baseUrl, token, projectName, serviceName);

  const { result, logs } = await waitForJobComplete(baseUrl, token, projectName, serviceName);

  log('Destroying service...');
  await destroyService(baseUrl, token, projectName, serviceName);
  log('Service destroyed.');

  process.stdout.write('----------------------------------------------------------------------------\n');
  process.stdout.write('----------------------------------- LOGS -----------------------------------\n');
  process.stdout.write('----------------------------------------------------------------------------\n');
  for (const [ts, line] of logs) {
    process.stdout.write(`${formatTs(ts)} | ${line}\n`);
  }

  if (!result) {
    fail('Job did not report a status. The container script must write {"complete":1,"code":0} before exiting.');
  }

  if (result.code !== 0) {
    fail(result.description || `Job exited with code ${result.code}.`);
  }

  complete(result.label || `Job "${serviceName}" completed successfully.`);
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
});
