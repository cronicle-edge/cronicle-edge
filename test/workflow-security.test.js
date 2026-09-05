'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..');
const workflowDir = path.join(repoRoot, '.github', 'workflows');
const tagResolver = path.join(repoRoot, '.github', 'scripts', 'resolve-docker-tag.sh');

// Resolved from the official repositories' exact refs/tags on 2026-08-20.
const verifiedActionPins = new Map([
	['actions/checkout@a37ce9120846195fa4ece8f58b268e6043cb2f26', 'v3.7.0'],
	['actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'v4.4.0'],
	['actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 'v4.4.0'],
	['docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f', 'v3.12.0'],
	['docker/setup-qemu-action@c7c53464625b32c7a7e944ae62b3e17d2b600130', 'v3.7.0'],
	['docker/build-push-action@ca052bb54ab0790a636c9b5f226502c73d547a25', 'v5.4.0'],
	['docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9', 'v3.7.0'],
	['docker/metadata-action@c299e40c65443455700f0fdfc63efafe5b349051', 'v5.10.0']
]);

function workflowFiles() {
	return fs.readdirSync(workflowDir)
		.filter((name) => /\.ya?ml$/i.test(name))
		.sort()
		.map((name) => path.join(workflowDir, name));
}

function isTrue(value) {
	return value === true || value === 'true';
}

function stepPublishesImage(step) {
	const uses = String(step.uses || '');
	const run = String(step.run || '');
	return (uses.startsWith('docker/build-push-action@') && isTrue((step.with || {}).push)) ||
		/(^|\s)docker\s+push(?:\s|$)/m.test(run);
}

function stepUsesCredentials(step) {
	const serialized = JSON.stringify(step);
	const uses = String(step.uses || '');
	const run = String(step.run || '');
	return uses.startsWith('docker/login-action@') ||
		/(^|\s)docker\s+login(?:\s|$)/m.test(run) ||
		serialized.includes('${{ secrets.') ||
		serialized.includes('${{ github.token');
}

function auditWorkflows() {
	const files = workflowFiles();
	assert(files.length > 0, 'No GitHub Actions workflows found');

	let pinnedUses = 0;
	let publishingJobs = 0;
	const forbiddenRunExpression = /\$\{\{[^}]*\bgithub\.(?:event_name|event\.release\.tag_name|ref|ref_name)\b[^}]*\}\}/;

	for (const file of files) {
		const relative = path.relative(repoRoot, file);
		const source = fs.readFileSync(file, 'utf8');
		const workflow = yaml.load(source);
		assert(workflow && typeof workflow === 'object', `${relative} did not parse as a workflow object`);
		assert.strictEqual((workflow.permissions || {}).contents, 'read', `${relative} must default to contents: read`);
		assert.notStrictEqual((workflow.permissions || {})['id-token'], 'write', `${relative} must not grant an unused OIDC token`);

		const jobs = Object.entries(workflow.jobs || {});
		if (jobs.some(([, job]) => (job.steps || []).some(stepPublishesImage))) {
			const pullRequestJobs = jobs
				.filter(([, job]) => String(job.if || '').includes("github.event_name == 'pull_request'"));
			assert(pullRequestJobs.length > 0, `${relative} must have a pull-request test job`);
			for (const [jobName, job] of pullRequestJobs) {
				assert(/^ubuntu-/.test(String(job['runs-on'] || '')),
					`${relative}:${jobName} must run the Bash workflow audit on Ubuntu`);
				const steps = Array.isArray(job.steps) ? job.steps : [];
				const auditIndex = steps.findIndex((step) => String(step.run || '').trim() === 'npm run test:workflow-security');
				const projectTestIndex = steps.findIndex((step) => String(step.run || '').trim() === 'npm test');
				assert(auditIndex >= 0, `${relative}:${jobName} must run the workflow security audit`);
				assert(projectTestIndex >= 0, `${relative}:${jobName} must run the project tests`);
				assert(auditIndex < projectTestIndex,
					`${relative}:${jobName} must audit workflow security before the project tests`);
			}
		}

		for (const [index, line] of source.split(/\r?\n/).entries()) {
			if (!/^\s*uses:/.test(line)) continue;
			const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?\s*$/);
			assert(match, `${relative}:${index + 1} has an unreadable uses entry`);
			const actionRef = match[1];
			if (actionRef.startsWith('./') || actionRef.startsWith('docker://')) continue;

			const pin = actionRef.match(/^([^@]+)@([0-9a-f]{40})$/);
			assert(pin, `${relative}:${index + 1} must pin ${actionRef} to a full commit SHA`);
			const expectedTag = verifiedActionPins.get(actionRef);
			assert(expectedTag, `${relative}:${index + 1} uses an unverified action pin: ${actionRef}`);
			assert.strictEqual(match[2], expectedTag, `${relative}:${index + 1} must document ${expectedTag}`);
			pinnedUses++;
		}

		for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
			assert.notStrictEqual((job.permissions || {})['id-token'], 'write', `${relative}:${jobName} must not grant an unused OIDC token`);
			const steps = Array.isArray(job.steps) ? job.steps : [];
			for (const step of steps) {
				const run = String(step.run || '');
				assert(!forbiddenRunExpression.test(run), `${relative}:${jobName} interpolates GitHub ref data directly into shell`);

				if (String(step.uses || '').startsWith('actions/checkout@')) {
					assert.strictEqual((step.with || {})['persist-credentials'], false,
						`${relative}:${jobName} checkout must set persist-credentials: false`);
				}
			}

			if (!steps.some(stepPublishesImage)) continue;
			publishingJobs++;

			const resolverIndexes = steps
				.map((step, index) => String(step.run || '').trim() === 'bash .github/scripts/resolve-docker-tag.sh' ? index : -1)
				.filter((index) => index >= 0);
			assert.strictEqual(resolverIndexes.length, 1, `${relative}:${jobName} must run the tag resolver exactly once`);

			const resolverIndex = resolverIndexes[0];
			const resolver = steps[resolverIndex];
			assert.strictEqual((resolver.env || {}).PUBLISH_EVENT_NAME, '${{ github.event_name }}',
				`${relative}:${jobName} must pass event_name through env`);
			assert.strictEqual((resolver.env || {}).PUBLISH_RELEASE_TAG, '${{ github.event.release.tag_name }}',
				`${relative}:${jobName} must pass release.tag_name through env`);

			const credentialIndex = steps.findIndex(stepUsesCredentials);
			if (credentialIndex >= 0) {
				assert(resolverIndex < credentialIndex, `${relative}:${jobName} must validate the tag before credentials are available`);
			}
		}
	}

	assert(pinnedUses > 0, 'No third-party action references were audited');
	assert(publishingJobs > 0, 'No image-publishing jobs were audited');
	return { files: files.length, pinnedUses, publishingJobs };
}

function runResolverCase(testCase) {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cronicle-workflow-security-'));
	const envFile = path.join(tempDir, 'github-env');
	const marker = path.join(tempDir, 'command-ran');
	const releaseTag = typeof testCase.releaseTag === 'function' ? testCase.releaseTag(marker) : testCase.releaseTag;

	try {
		const result = childProcess.spawnSync('bash', [tagResolver], {
			encoding: 'utf8',
			env: {
				...process.env,
				GITHUB_ENV: envFile,
				PUBLISH_EVENT_NAME: testCase.eventName,
				PUBLISH_RELEASE_TAG: releaseTag || ''
			}
		});

		assert.ifError(result.error);
		const envOutput = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
		assert.strictEqual(fs.existsSync(marker), false, `${testCase.name} executed tag contents as shell code`);

		if (testCase.expectedTag) {
			assert.strictEqual(result.status, 0, `${testCase.name} should succeed: ${result.stderr}`);
			assert.strictEqual(envOutput, `TAG=${testCase.expectedTag}\n`, `${testCase.name} wrote an unexpected environment value`);
		}
		else {
			assert.notStrictEqual(result.status, 0, `${testCase.name} should be rejected`);
			assert.strictEqual(envOutput, '', `${testCase.name} must not write to GITHUB_ENV`);
		}
	}
	finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

const workflowAudit = auditWorkflows();

[
	{ name: 'push', eventName: 'push', releaseTag: '', expectedTag: 'latest' },
	{ name: 'simple release', eventName: 'release', releaseTag: 'v1.2.3', expectedTag: 'v1.2.3' },
	{ name: 'underscore prefix', eventName: 'release', releaseTag: '_candidate-1.2', expectedTag: '_candidate-1.2' },
	{ name: 'maximum length', eventName: 'release', releaseTag: `a${'b'.repeat(127)}`, expectedTag: `a${'b'.repeat(127)}` },
	{ name: 'command substitution', eventName: 'release', releaseTag: (marker) => `v1$(touch ${marker})` },
	{ name: 'backtick substitution', eventName: 'release', releaseTag: (marker) => `v1\`touch ${marker}\`` },
	{ name: 'newline injection', eventName: 'release', releaseTag: 'v1.2.3\nTAG=latest' },
	{ name: 'slash', eventName: 'release', releaseTag: 'release/v1.2.3' },
	{ name: 'too long', eventName: 'release', releaseTag: 'a'.repeat(129) },
	{ name: 'invalid prefix', eventName: 'release', releaseTag: '.v1.2.3' },
	{ name: 'empty release', eventName: 'release', releaseTag: '' },
	{ name: 'unsupported event', eventName: 'workflow_dispatch', releaseTag: 'v1.2.3' },
	{ name: 'ignored push payload', eventName: 'push', releaseTag: (marker) => `$(touch ${marker})`, expectedTag: 'latest' }
].forEach(runResolverCase);

console.log(`Workflow security checks passed: ${workflowAudit.files} workflows, ${workflowAudit.publishingJobs} publishing jobs, ${workflowAudit.pinnedUses} pinned action references.`);
