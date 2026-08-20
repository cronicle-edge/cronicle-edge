'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const filterXSS = require('xss');
const AnsiUp = require('ansi_up').default;
const { buildWorkflowReportTable, getLogTitle } = require('../lib/workflow_report');

const projectRoot = path.dirname(__dirname);

function loadBrowserClasses() {
	const dom = new JSDOM('<!doctype html><html><body></body></html>', {
		url: 'https://cronicle.example/',
		runScripts: 'outside-only'
	});
	const window = dom.window;

	window.Page = function Page() {};
	window.Class = {
		subclass: function(parent, name, definition) {
			function Subclass() {}
			Subclass.prototype = Object.create((parent && parent.prototype) || {});
			Object.assign(Subclass.prototype, definition);
			Subclass.prototype.constructor = Subclass;

			const parts = name.split('.');
			let target = window;
			for (let idx = 0; idx < parts.length - 1; idx++) target = target[parts[idx]];
			target[parts[parts.length - 1]] = Subclass;
		}
	};
	window.filterXSS = filterXSS;
	window.AnsiUp = AnsiUp;

	const context = dom.getInternalVMContext();
	[
		'node_modules/pixl-webapp/js/tools.js',
		'node_modules/pixl-webapp/js/xml.js',
		'htdocs/js/pages/Base.class.js',
		'htdocs/js/pages/Home.class.js',
		'htdocs/js/pages/JobDetails.class.js'
	].forEach(function(relativePath) {
		vm.runInContext(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'), context, {
			filename: relativePath
		});
	});

	return { dom, window };
}

function renderTableRow(window, row) {
	const table = window.document.createElement('table');
	table.innerHTML = '<tbody><tr>' + row.map(function(cell) { return '<td>' + cell + '</td>'; }).join('') + '</tr></tbody>';
	return table;
}

function createWorkflowView(window, id, job) {
	const jobs = Object.create(null);
	jobs[id] = job;
	const report = buildWorkflowReportTable(jobs, function() { return '00:00:03'; });
	const root = window.document.createElement('div');
	root.appendChild(renderTableRow(window, report.rows[0]));
	const grid = window.document.createElement('div');
	grid.id = 'log_grid';
	root.appendChild(grid);
	return {
		root: root,
		grid: grid,
		control: root.querySelector('.workflow-log-toggle')
	};
}

function makeLog(payload) {
	return ['head1', 'head2', 'head3', 'head4', payload, 'foot1', 'foot2', 'foot3', 'foot4'].join('\n');
}

function installDeferredGet(window) {
	const requests = [];
	window.$ = {
		get: function(url, success) {
			const failureHandlers = [];
			const request = {
				url: url,
				aborted: false,
				fail: function(handler) {
					failureHandlers.push(handler);
					return request;
				},
				abort: function() {
					request.aborted = true;
					failureHandlers.forEach(function(handler) { handler(new Error('aborted')); });
					return request;
				},
				resolve: function(data) { success(data); },
				reject: function() {
					failureHandlers.forEach(function(handler) { handler(new Error('late failure')); });
				}
			};
			requests.push(request);
			return request;
		}
	};
	return requests;
}

function parseHashParams(href) {
	return new URLSearchParams(href.slice(href.indexOf('?') + 1));
}

const tests = [];

function addTest(name, callback) {
	const wrapped = function(test) {
		Promise.resolve().then(callback).then(function() {
			test.done();
		}).catch(function(err) {
			test.ok(false, name + ': ' + (err && err.stack || err));
			test.done();
		});
	};
	Object.defineProperty(wrapped, 'name', {
		value: name.replace(/[^A-Za-z0-9]+/g, '_'),
		configurable: true
	});
	tests.push(wrapped);
}

addTest('workflow report emits passive controls and preserves encoded values', function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'job\'\"><img src=x onerror="globalThis.pwned=1">/${template}`';
	const title = 'Title ` ${globalThis.pwned=2} </button><script>globalThis.pwned=3</script>';
	const arg = 'filter:eval(globalThis.pwned=4/* \" onerror=<script> */)';
	const jobs = Object.create(null);
	jobs[id] = {
		seq: 7,
		title: title,
		arg: arg,
		event: 'different-event',
		start: '10:00:00',
		elapsed: 2,
		code: 1,
		description: '<img src=x onerror="globalThis.pwned=5"> failed'
	};

	const report = buildWorkflowReportTable(jobs, function() { return '00:00:02'; });
	const table = renderTableRow(window, report.rows[0]);
	window.document.body.appendChild(table);
	const cells = table.querySelectorAll('td');
	const control = table.querySelector('.workflow-log-toggle');
	const link = table.querySelector('a[href^="#JobDetails?"]');

	assert.ok(control);
	assert.equal(table.querySelectorAll('[onclick],[onerror],script,svg,img').length, 0);
	assert.equal(control.getAttribute('data-job-id'), id);
	assert.equal(control.getAttribute('data-log-title'), getLogTitle(jobs[id]));
	assert.equal(cells[1].textContent, title);
	assert.equal(cells[2].textContent, arg);
	assert.doesNotMatch(report.rows[0][2], /^filter:(\w+)\((.+)\)$/);
	assert.equal(parseHashParams(link.getAttribute('href')).get('id'), id);
	assert.equal(window.globalThis.pwned, undefined);

	assert.doesNotThrow(function() {
		buildWorkflowReportTable({ child: {
			seq: 1, title: 'bad\uD800title', event: 'parent', elapsed: 0
		} }, function() { return ''; });
	});
	dom.window.close();
});

addTest('failed-job badge keeps trusted tooltip markup without attribute injection', function() {
	const { dom, window } = loadBrowserClasses();
	const eventTitle = 'Broken\" onmouseover="globalThis.pwned=1"><img src=x onerror="globalThis.pwned=2"><script>globalThis.pwned=3</script>';
	const errorLog = Object.create(null);
	errorLog[eventTitle] = 2;
	const home = window.Page.Home.prototype;
	const html = home.get_failed_job_badge({ jobs_completed: 10, jobs_failed: 3, errorLog: errorLog }, { err_rate: 0.1 });
	const host = window.document.createElement('div');
	host.innerHTML = html;
	const badge = host.querySelector('a.color_label');

	assert.ok(badge);
	assert.equal(host.querySelectorAll('[onclick],[onmouseover],[onerror],script,img').length, 0);
	assert.equal(badge.textContent, '3');
	assert.equal(parseHashParams(badge.getAttribute('href')).get('max'), '3');
	assert.match(badge.getAttribute('title'), /<u>Failed to start: <b>1<\/b><\/u>/);
	assert.match(badge.getAttribute('title'), /&lt;img/);

	const tooltip = window.document.createElement('div');
	tooltip.innerHTML = filterXSS(badge.getAttribute('title'));
	assert.equal(tooltip.querySelectorAll('[onerror],script,img').length, 0);
	assert.ok(tooltip.querySelector('b'));
	assert.match(tooltip.textContent, /<img src=x onerror=/);
	assert.equal(window.globalThis.pwned, undefined);
	dom.window.close();
});

addTest('history argument encodes context id and round-trips query values', function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'event\" onmouseover="globalThis.pwned=1"><svg onload="globalThis.pwned=2">/😀';
	const arg = '\"><img src=x onerror="globalThis.pwned=3"> argument & value';
	const base = window.Page.Base.prototype;
	const host = window.document.createElement('div');
	host.innerHTML = base.getNiceArgument(arg, 500, { id: id, error: true });
	const link = host.querySelector('a');
	const params = parseHashParams(link.getAttribute('href'));

	assert.equal(host.querySelectorAll('[onmouseover],[onerror],svg,img').length, 0);
	assert.equal(params.get('id'), id);
	assert.equal(params.get('arg'), arg);
	assert.equal(link.textContent, arg);
	assert.equal(params.get('error'), '1');
	assert.equal(window.globalThis.pwned, undefined);

	assert.doesNotThrow(function() {
		const malformed = base.getNiceArgument('arg\uDFFF', 50, { id: 'id\uD800' });
		const malformedHost = window.document.createElement('div');
		malformedHost.innerHTML = malformed;
		const malformedParams = parseHashParams(malformedHost.querySelector('a').getAttribute('href'));
		assert.equal(malformedParams.get('id'), 'id\uFFFD');
		assert.equal(malformedParams.get('arg'), 'arg\uFFFD');
	});
	dom.window.close();
});

addTest('workflow view-log click and close use DOM-safe title id and ANSI output', function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'child\'\"><img src=x onerror="globalThis.pwned=1">/😀';
	const job = {
		seq: 8,
		title: 'Job </b><script>globalThis.pwned=2</script>',
		arg: '\" onerror="globalThis.pwned=3',
		event: 'parent',
		start: '10:00:00',
		elapsed: 3,
		code: 0,
		description: 'ok'
	};
	const jobs = Object.create(null);
	jobs[id] = job;
	const report = buildWorkflowReportTable(jobs, function() { return '00:00:03'; });
	const root = window.document.createElement('div');
	const table = renderTableRow(window, report.rows[0]);
	root.appendChild(table);
	const grid = window.document.createElement('div');
	grid.id = 'log_grid';
	root.appendChild(grid);
	window.document.body.appendChild(root);

	window.localStorage.session_id = 'session\"&/😀';
	const logPayload = '\u001b[31mred\u001b[0m <img src=x onerror="globalThis.pwned=4"><script>globalThis.pwned=5</script>';
	const log = ['head1', 'head2', 'head3', 'head4', logPayload, 'foot1', 'foot2', 'foot3', 'foot4'].join('\n');
	const requests = [];
	window.$ = {
		get: function(url, callback) {
			requests.push(url);
			callback(log);
			return { fail: function() { return this; } };
		}
	};

	const page = Object.create(window.Page.JobDetails.prototype);
	page.args = { tail: 25 };
	page.bind_workflow_log_controls(root);
	const control = root.querySelector('.workflow-log-toggle');
	const icon = control.querySelector('.workflow-log-icon');
	icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

	let preview = grid.querySelector('.workflow-log-preview');
	assert.ok(preview);
	assert.equal(preview.getAttribute('data-job-id'), id);
	assert.equal(preview.querySelector('.grid-title b').textContent, getLogTitle(job));
	assert.equal(preview.querySelectorAll('script,img,[onerror],[onclick]').length, 0);
	assert.ok(preview.querySelector('pre span[style]'));
	assert.match(preview.querySelector('pre').textContent, /<img src=x onerror=/);
	assert.equal(control.getAttribute('aria-expanded'), 'true');
	assert.ok(icon.classList.contains('fa-eye-slash'));
	assert.equal(window.globalThis.pwned, undefined);

	const requestUrl = new URL(requests[0], window.location.href);
	assert.equal(requestUrl.searchParams.get('id'), id);
	assert.equal(requestUrl.searchParams.get('session_id'), window.localStorage.session_id);

	control.click();
	assert.equal(grid.querySelector('.workflow-log-preview'), null);
	assert.equal(requests.length, 1);
	assert.ok(icon.classList.contains('fa-eye'));

	control.click();
	preview = grid.querySelector('.workflow-log-preview');
	assert.ok(preview);
	preview.querySelector('.workflow-log-close').click();
	assert.equal(grid.querySelector('.workflow-log-preview'), null);
	assert.equal(control.getAttribute('aria-expanded'), 'false');
	assert.ok(icon.classList.contains('fa-eye'));

	page.unbind_workflow_log_controls();
	dom.window.close();
});

addTest('workflow view-log deduplicates rapid clicks while a request is pending', async function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'pending-job\"/><script>globalThis.pwned=1</script>';
	const job = {
		seq: 9, title: 'Pending <img src=x onerror="globalThis.pwned=2">', arg: 'arg',
		event: 'parent', start: '10:00:00', elapsed: 3, code: 0, description: 'ok'
	};
	const view = createWorkflowView(window, id, job);
	window.document.body.appendChild(view.root);
	const requests = installDeferredGet(window);
	const page = Object.create(window.Page.JobDetails.prototype);
	page.args = { tail: 25 };
	page.bind_workflow_log_controls(view.root);

	view.control.click();
	view.control.click();
	assert.equal(requests.length, 1);
	assert.equal(view.grid.querySelectorAll('.workflow-log-preview').length, 0);
	assert.equal(view.control.getAttribute('aria-expanded'), 'true');

	requests[0].resolve(makeLog('\u001b[32mready\u001b[0m'));
	await Promise.resolve();
	assert.equal(view.grid.querySelectorAll('.workflow-log-preview').length, 1);
	assert.equal(requests.length, 1);

	page.unbind_workflow_log_controls();
	dom.window.close();
});

addTest('workflow view-log ignores a stale response after unbind and reactivation', async function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'same-job\" onerror="globalThis.pwned=1';
	const oldJob = {
		seq: 10, title: 'Old <script>globalThis.pwned=2</script>', event: 'parent',
		start: '10:00:00', elapsed: 3, code: 0, description: 'old'
	};
	const newJob = Object.assign({}, oldJob, { title: 'New safe generation' });
	const oldView = createWorkflowView(window, id, oldJob);
	window.document.body.appendChild(oldView.root);
	const requests = installDeferredGet(window);
	const page = Object.create(window.Page.JobDetails.prototype);
	page.args = { tail: 25 };
	page.bind_workflow_log_controls(oldView.root);
	oldView.control.click();
	assert.equal(requests.length, 1);

	page.unbind_workflow_log_controls();
	assert.equal(requests[0].aborted, true);
	const newView = createWorkflowView(window, id, newJob);
	window.document.body.appendChild(newView.root);
	page.bind_workflow_log_controls(newView.root);
	newView.control.click();
	assert.equal(requests.length, 2);

	requests[0].resolve(makeLog('stale response <img src=x onerror="globalThis.pwned=3">'));
	requests[0].reject();
	await Promise.resolve();
	assert.equal(oldView.grid.querySelectorAll('.workflow-log-preview').length, 0);
	assert.equal(newView.grid.querySelectorAll('.workflow-log-preview').length, 0);
	assert.equal(newView.control.getAttribute('aria-expanded'), 'true');

	requests[1].resolve(makeLog('\u001b[34mcurrent response\u001b[0m'));
	await Promise.resolve();
	const currentPreview = newView.grid.querySelector('.workflow-log-preview');
	assert.ok(currentPreview);
	assert.equal(currentPreview.querySelector('.grid-title b').textContent, getLogTitle(newJob));
	assert.equal(window.globalThis.pwned, undefined);

	page.unbind_workflow_log_controls();
	dom.window.close();
});

addTest('workflow view-log ignores a failure delivered after a successful preview', async function() {
	const { dom, window } = loadBrowserClasses();
	const id = 'late-failure-job';
	const job = {
		seq: 11, title: 'Late failure', event: 'parent', start: '10:00:00',
		elapsed: 3, code: 0, description: 'ok'
	};
	const view = createWorkflowView(window, id, job);
	window.document.body.appendChild(view.root);
	const requests = installDeferredGet(window);
	const page = Object.create(window.Page.JobDetails.prototype);
	page.args = { tail: 25 };
	page.bind_workflow_log_controls(view.root);
	view.control.click();

	requests[0].resolve(makeLog('\u001b[35mcomplete\u001b[0m'));
	await Promise.resolve();
	assert.equal(view.grid.querySelectorAll('.workflow-log-preview').length, 1);
	assert.equal(view.control.getAttribute('aria-expanded'), 'true');

	requests[0].reject();
	await Promise.resolve();
	assert.equal(view.grid.querySelectorAll('.workflow-log-preview').length, 1);
	assert.equal(view.control.getAttribute('aria-expanded'), 'true');
	assert.ok(view.control.querySelector('.workflow-log-icon').classList.contains('fa-eye-slash'));

	page.unbind_workflow_log_controls();
	dom.window.close();
});

module.exports = {
	setUp: function(callback) { callback(); },
	tests: tests,
	tearDown: function(callback) { callback(); }
};
