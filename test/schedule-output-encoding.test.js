const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const he = require('he');
const htmlParser = require('xss/lib/parser');

const Api = require('../lib/api');
const EventApi = require('../lib/api/event');
const Scheduler = require('../lib/scheduler');

const ROOT = path.resolve(__dirname, '..');
const ATTACK = `x"' onmouseover=x data-pwn=x><svg>`;
const FILE_ATTACK = `file"' onmouseover=x data-pwn=x><svg>`;
const CONTENT_ATTACK = `first\n</textarea><img src=x onerror=x>\n"'`;

const tests = [];

function test(name, callback) {
	const wrapped = function(testHandle) {
		Promise.resolve().then(callback).then(function() {
			testHandle.done();
		}).catch(function(err) {
			testHandle.ok(false, name + ': ' + (err && err.stack || err));
			testHandle.done();
		});
	};
	Object.defineProperty(wrapped, 'name', {
		value: name.replace(/[^A-Za-z0-9]+/g, '_'),
		configurable: true
	});
	tests.push(wrapped);
}

function encodeEntities(text) {
	if (text == null) return '';
	if (text && text.replace) {
		text = text.replace(/\&/g, '&amp;');
		text = text.replace(/</g, '&lt;');
		text = text.replace(/>/g, '&gt;');
	}
	return text;
}

function encodeAttribEntities(text) {
	text = encodeEntities(text);
	if (text && text.replace) {
		text = text.replace(/"/g, '&quot;');
		text = text.replace(/'/g, '&apos;');
	}
	return text;
}

function escapeTextFieldValue(text) {
	if ((text === undefined) || (text === null)) text = '';
	return encodeAttribEntities(String(text));
}

function parseTags(html) {
	const tags = [];
	htmlParser.parseTag(html, function(sourcePosition, position, tag, raw, closing) {
		if (!closing && tag) {
			const attrSource = raw
				.replace(/^<\s*[^\s/>]+/, '')
				.replace(/\/?>$/, '');
			const attrs = Object.create(null);
			htmlParser.parseAttr(attrSource, function(name, value) {
				attrs[name] = he.decode(value || '', { isAttributeValue: true });
				return name + '="' + value + '"';
			});
			tags.push({ tag, attrs, raw });
		}
		return raw;
	}, function(text) { return text; });
	return tags;
}

function assertNoInjectedMarkup(html) {
	const tags = parseTags(html);
	assert.equal(tags.some((item) => item.tag === 'svg' || item.tag === 'img'), false, html);
	assert.equal(tags.some((item) => Object.prototype.hasOwnProperty.call(item.attrs, 'onmouseover')), false, html);
	assert.equal(tags.some((item) => Object.prototype.hasOwnProperty.call(item.attrs, 'data-pwn')), false, html);
	return tags;
}

function loadPage(relativePath) {
	let methods;
	const context = {
		console,
		Page: { Base: {} },
		Class: {
			subclass: function(base, name, definition) { methods = definition; }
		},
		encode_entities: encodeEntities,
		encode_attrib_entities: encodeAttribEntities,
		escape_text_field_value: escapeTextFieldValue
	};
	vm.runInNewContext(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'), context, {
		filename: relativePath
	});
	return { methods, context };
}

function getTag(tags, name, predicate) {
	const tag = tags.find((item) => item.tag === name && (!predicate || predicate(item)));
	assert.ok(tag, 'Expected <' + name + '> in rendered HTML');
	return tag;
}

function makeSchedulePage() {
	return loadPage('htdocs/js/pages/Schedule.class.js');
}

function renderScheduleView(mode, ticks, inactive) {
	const loaded = makeSchedulePage();
	const methods = loaded.methods;
	const context = loaded.context;
	const event = {
		id: 'safe_event', title: 'Safe Event', enabled: 1,
		category: 'cat', plugin: 'plug', target: 'group',
		modified: 1, timing: null, ticks: ticks
	};
	if (inactive) event.start_time = Date.now() + 3600000;

	let rendered = '';
	context.get_inner_window_size = () => ({ width: 1200, height: 800 });
	context.graphlib = {
		Graph: function() { this.setNode = function() {}; this.setEdge = function() {}; },
		alg: { findCycles: () => [] }
	};
	context.find_object = (items, criteria) => (items || []).find((item) => {
		return Object.keys(criteria).every((key) => item[key] == criteria[key]);
	}) || null;
	context.copy_object = (object) => Object.assign({}, object);
	context.render_menu_options = () => '';
	context.summarize_event_timing = () => 'On demand';
	context.summarize_event_timing_short = () => 'On demand';
	context.summarize_event_interval = () => 'Interval';
	context.summarize_repeat_interval = () => 'Repeat';
	context.get_text_from_seconds = () => 'now';
	context.moment = { tz: () => ({ format: () => 'time' }) };
	context.setTimeout = () => {};
	context.$ = () => ({ keypress: () => {} });
	context.app = {
		schedule: [event],
		categories: [{ id: 'cat', title: 'Category', enabled: 1 }],
		plugins: [{ id: 'plug', title: 'Plugin', enabled: 1 }],
		server_groups: [{ id: 'group', title: 'Group' }],
		filter: { schedule: {} },
		state: { jobCodes: {} },
		activeJobs: {},
		tz: 'UTC', hh24: true,
		getPref: (key) => key === 'event_view' ? mode : '',
		hasPrivilege: () => false,
		isAdmin: () => false,
		setWindowTitle: () => {}
	};

	const page = {
		alt_sort: 1,
		get_safe_text_value: methods.get_safe_text_value,
		div: {
			removeClass: () => {},
			html: (html) => { rendered = html; }
		},
		render_target_menu_options: () => '',
		getNiceEvent: () => 'Safe Event',
		getNiceCategory: () => 'Category',
		getNicePlugin: () => 'Plugin',
		getNiceGroup: () => 'Group',
		getBasicTable2: function(events, cols, type, rowRenderer) {
			return '<table>' + events.map((item, idx) => {
				const row = rowRenderer(item, idx);
				return row ? '<tr><td>' + row[5] + '</td></tr>' : '';
			}).join('') + '</table>';
		},
		update_job_last_runs: () => {}
	};

	methods.gosub_events.call(page, {});
	return rendered;
}

function makeApiValidationHarness() {
	const api = Object.create(Api.prototype);
	api.validateOptionalParams = () => true;
	api.doError = function(code, description, callback) {
		api.lastError = description;
		if (callback) callback({ code: 1, description });
	};
	return api;
}

function makeEventApiHarness() {
	const api = Object.create(EventApi.prototype);
	api.requiremanager = () => true;
	api.requireParams = () => true;
	api.requireValidEventData = () => true;
	api.requireValidUser = () => true;
	api.requirePrivilege = () => true;
	api.requireCategoryPrivilege = () => true;
	api.requireGroupPrivilege = () => true;
	api.validateUnique = async () => 0;
	api.loadSession = (args, callback) => callback(null, {}, { username: 'admin' });
	api.getUniqueID = () => 'new_event';
	api.encryptObject = (value) => ({ encrypted: value });
	api.getClientInfo = () => ({});
	api.logDebug = () => {};
	api.logTransaction = () => {};
	api.logActivity = () => {};
	api.updateClientData = () => {};
	api.authSocketEmit = () => {};
	api.getAllActiveJobs = () => ({});
	api.eventQueue = {};
	api.state = { cursors: {} };
	api.tz = 'UTC';
	return api;
}

function createEvent(api, params) {
	return new Promise((resolve, reject) => {
		api.storage = {
			listFind: (path, criteria, callback) => callback(null, { id: 'general' }),
			listUnshift: (path, event, callback) => {
				api.savedEvent = Object.assign({}, event);
				callback(null);
			}
		};
		api.api_create_event({ params }, (response) => {
			if (response.code) reject(new Error(response.description || 'create failed'));
			else resolve(response);
		});
	});
}

function updateEvent(api, params) {
	return new Promise((resolve, reject) => {
		const stored = {
			id: params.id, title: params.title, category: 'general', target: 'group',
			enabled: 1, secret_preview: 'EXISTING'
		};
		api.storage = {
			listFind: (path, criteria, callback) => {
				if (path === 'global/schedule') callback(null, stored);
				else callback(null, { id: 'general' });
			},
			listFindUpdate: (path, criteria, patch, callback) => {
				api.savedPatch = Object.assign({}, patch);
				callback(null);
			}
		};
		api.api_update_event({ params }, (response) => {
			if (response.code) reject(new Error(response.description || 'update failed'));
			else resolve(response);
		});
	});
}

test('Workflow list, options and edit dialog keep hostile metadata inside its original DOM nodes', () => {
	const loaded = makeSchedulePage();
	const methods = loaded.methods;
	const context = loaded.context;
	const sink = { innerHTML: '' };
	context.document = { getElementById: () => sink };
	context.$ = () => ({ val: () => '1' });
	context.app = {
		schedule: [{ id: ATTACK, title: ATTACK }],
		confirm: function() {
			context.dialogHtml = Array.from(arguments).find((value) => typeof value === 'string' && value.indexOf('<table>') >= 0);
		},
		clearError: () => {}
	};
	context.get_form_table_row = (label, value) => value;
	context.get_form_table_spacer = () => '';
	context.Dialog = { hide: () => {} };

	const page = {
		event: { workflow: [{ id: ATTACK, title: ATTACK, arg: ATTACK, disabled: false }] },
		get_safe_text_value: methods.get_safe_text_value,
		render_wf_event_options: methods.render_wf_event_options,
		render_wf_event_list: methods.render_wf_event_list
	};
	methods.render_wf_event_list.call(page);
	let tags = assertNoInjectedMarkup(sink.innerHTML);
	const anchor = getTag(tags, 'a');
	assert.equal(anchor.attrs.href, '#Schedule?sub=edit_event&id=' + encodeURIComponent(ATTACK));
	assert.equal((sink.innerHTML.match(/<a\b/g) || []).length, 1);
	assert.equal((sink.innerHTML.match(/<tr\b/g) || []).length, 2);

	const options = methods.render_wf_event_options.call(page, page.event.workflow, ATTACK);
	tags = assertNoInjectedMarkup(options);
	const option = getTag(tags, 'option');
	assert.equal(option.attrs.value, ATTACK);
	assert.equal(he.decode(options.match(/>([\s\S]*)<\/option>/)[1]), ATTACK);
	assert.equal((options.match(/<option\b/g) || []).length, 1);

	methods.wf_event_edit.call(page, 0);
	tags = assertNoInjectedMarkup(context.dialogHtml);
	const input = getTag(tags, 'input', (item) => item.attrs.id === 'fe_ee_pp_wf_evt_arg');
	assert.equal(input.attrs.value, ATTACK);
	assert.equal(getTag(tags, 'option').attrs.value, ATTACK);
});

test('Event file editor preserves hostile filename and textarea content without creating attributes or nodes', () => {
	const loaded = makeSchedulePage();
	const methods = loaded.methods;
	const context = loaded.context;
	context.get_form_table_row = (label, value) => value;
	context.get_form_table_spacer = () => '';
	context.setTimeout = () => {};
	context.app = {
		confirm: function() {
			context.dialogHtml = Array.from(arguments).find((value) => typeof value === 'string' && value.indexOf('<table>') >= 0);
		},
		clearError: () => {}
	};
	context.Dialog = { hide: () => {} };
	const page = {
		event: { files: [{ name: FILE_ATTACK, content: CONTENT_ATTACK }] },
		get_safe_text_value: methods.get_safe_text_value,
		setFileEditor: () => {}, render_file_list: () => {}
	};

	methods.file_edit.call(page, 0);
	const tags = assertNoInjectedMarkup(context.dialogHtml);
	const input = getTag(tags, 'input', (item) => item.attrs.id === 'fe_ee_pp_file_name');
	assert.equal(input.attrs.value, FILE_ATTACK);
	assert.equal((context.dialogHtml.match(/<textarea\b/g) || []).length, 1);
	const textareaText = context.dialogHtml.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/)[1];
	assert.equal(he.decode(textareaText), CONTENT_ATTACK);
});

test('History error and warning tooltips encode both quote types after ANSI removal', () => {
	const loaded = loadPage('htdocs/js/pages/History.class.js');
	const methods = loaded.methods;
	for (const code of [1, 255]) {
		const html = methods.render_job_status({ code, description: '\u001b[31m' + ATTACK + '\u001b[0m' });
		const tags = assertNoInjectedMarkup(html);
		const outer = getTag(tags, 'span', (item) => item.attrs.title !== undefined);
		assert.equal(outer.attrs.title, ATTACK);
	}
	assert.match(methods.receive_history.toString(), /render_job_status\(job\)/);
	assert.match(methods.receive_event_history.toString(), /render_job_status\(job\)/);
});

test('On-demand and timed extra-tick summaries encode hostile tooltip text', () => {
	const source = fs.readFileSync(path.join(ROOT, 'htdocs/js/app.js'), 'utf8');
	const start = source.indexOf('function summarize_event_timing(');
	const end = source.indexOf('\nfunction detect_num_interval', start);
	assert.ok(start >= 0 && end > start);
	const context = {
		encode_attrib_entities: encodeAttribEntities,
		app: { tz: 'UTC', hh24: true }
	};
	vm.runInNewContext(source.slice(start, end), context, { filename: 'summarize_event_timing.js' });

	for (const timing of [null, {}]) {
		const html = context.summarize_event_timing(timing, null, ATTACK);
		const tags = assertNoInjectedMarkup(html);
		assert.equal(getTag(tags, 'span').attrs.title, 'Extra Ticks: ' + ATTACK);
	}
	assert.equal(context.summarize_event_timing(null, null, { toString: null }), 'On demand');
});

test('Inactive and grid schedule tooltips encode extra ticks at their final attribute sinks', () => {
	const inactiveHtml = renderScheduleView('details', ATTACK, true);
	let tags = assertNoInjectedMarkup(inactiveHtml);
	assert.ok(tags.some((item) => item.tag === 'span' && item.attrs.title === 'Extra Ticks: ' + ATTACK));

	const gridHtml = renderScheduleView('grid', ATTACK, false);
	tags = assertNoInjectedMarkup(gridHtml);
	assert.ok(tags.some((item) => item.tag === 'span' && item.attrs.title === 'On demand<br><br>Extra ticks: ' + ATTACK));

	const corruptHtml = renderScheduleView('grid', { toString: null }, false);
	tags = assertNoInjectedMarkup(corruptHtml);
	assert.equal(tags.some((item) => item.attrs.title && item.attrs.title.includes('Extra ticks:')), false);
});

test('Extra-tick value and secret-preview placeholder round-trip without new DOM structure', () => {
	const methods = makeSchedulePage().methods;
	let html = methods.render_event_ticks_input({ ticks: ATTACK });
	let tags = assertNoInjectedMarkup(html);
	assert.equal(tags.length, 1);
	assert.equal(getTag(tags, 'input').attrs.value, ATTACK);

	html = methods.render_event_secret_input({ secret_preview: ATTACK });
	tags = assertNoInjectedMarkup(html);
	assert.equal(tags.length, 1);
	assert.equal(getTag(tags, 'textarea').attrs.placeholder, '[' + ATTACK + ']');
});

test('Workflow API validation accepts compatible values and rejects malformed structure', () => {
	let api = makeApiValidationHarness();
	const workflow = [
		{ id: 'step_one', title: ATTACK, arg: ATTACK, wait: true, disabled: 0 },
		{ id: 'step2', arg: 42, wait: 1, disabled: false },
		{ id: 'step3', arg: null, wait: false, disabled: 1 }
	];
	assert.equal(api.requireValidEventData({ workflow }, () => {}), true);
	assert.equal(workflow[0].arg, ATTACK);
	assert.equal(workflow[1].arg, 42);

	const invalid = [
		{ workflow: {} },
		{ workflow: { length: 0 } },
		{ workflow: [[]] },
		{ workflow: [new Date(0)] },
		{ workflow: [{ id: ATTACK }] },
		{ workflow: [{ id: 'step', wait: 2 }] },
		{ workflow: [{ id: 'step', disabled: '0' }] },
		{ workflow: [{ id: 'step', arg: {} }] }
	];
	for (const event of invalid) {
		api = makeApiValidationHarness();
		assert.equal(api.requireValidEventData(event, () => {}), false, JSON.stringify(event));
		assert.ok(api.lastError);
	}
});

test('Event API rejects non-string ticks and malformed file entries', () => {
	let api = makeApiValidationHarness();
	const valid = {
		ticks: ATTACK,
		files: [{ name: FILE_ATTACK, content: CONTENT_ATTACK }]
	};
	assert.equal(api.requireValidEventData(valid, () => {}), true);
	assert.equal(valid.ticks, ATTACK);
	assert.equal(valid.files[0].name, FILE_ATTACK);
	assert.equal(valid.files[0].content, CONTENT_ATTACK);

	const invalid = [
		{ ticks: { toString: null } },
		{ files: 'not-an-array' },
		{ files: [{ name: {}, content: 'safe' }] },
		{ files: [{ name: 'safe', content: {} }] },
		{ files: [{ name: 'legacy-without-content' }] },
		{ files: [new Date(0)] }
	];
	for (const event of invalid) {
		api = makeApiValidationHarness();
		assert.equal(api.requireValidEventData(event, () => {}), false);
		assert.ok(api.lastError);
	}
});

test('Renderers fail safe for malformed persisted ticks and file values', () => {
	const loaded = makeSchedulePage();
	const methods = loaded.methods;
	const context = loaded.context;
	const malformed = { toString: null };

	let html = methods.render_event_ticks_input({ ticks: malformed });
	let tags = assertNoInjectedMarkup(html);
	assert.equal(getTag(tags, 'input').attrs.value, '');

	context.get_form_table_row = (label, value) => value;
	context.get_form_table_spacer = () => '';
	context.setTimeout = () => {};
	context.app = {
		confirm: function() {
			context.dialogHtml = Array.from(arguments).find((value) => typeof value === 'string' && value.indexOf('<table>') >= 0);
		},
		clearError: () => {}
	};
	context.Dialog = { hide: () => {} };
	const page = {
		event: { files: [{ name: malformed, content: malformed }] },
		get_safe_text_value: methods.get_safe_text_value,
		setFileEditor: () => {}, render_file_list: () => {}
	};
	methods.file_edit.call(page, 0);
	tags = assertNoInjectedMarkup(context.dialogHtml);
	assert.equal(getTag(tags, 'input').attrs.value, '');
	const textareaText = context.dialogHtml.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/)[1];
	assert.equal(textareaText, '');

	const fileList = { innerHTML: 'not-cleared' };
	context.document = { getElementById: () => fileList };
	page.event.files = 'malformed-list';
	methods.render_file_list.call(page);
	assert.equal(fileList.innerHTML, '');

	page.event.files = [{ name: malformed, content: malformed }];
	methods.render_file_list.call(page);
	assertNoInjectedMarkup(fileList.innerHTML);

	const scheduler = Object.create(Scheduler.prototype);
	assert.equal(scheduler.checkEventTicks(malformed, 0, 'UTC'), false);
});

test('Home worker onmessage ignores malformed legacy ticks without aborting prediction', () => {
	let posted;
	const context = {
		console,
		Date,
		Intl,
		postMessage: (events) => { posted = events; }
	};
	vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'htdocs/js/home-worker.js'), 'utf8'), context, {
		filename: 'htdocs/js/home-worker.js'
	});

	context.onmessage({
		data: {
			default_tz: 'UTC',
			schedule: [{
				id: 'legacy_ticks', enabled: 1, catch_up: 0,
				timezone: 'UTC', ticks: { toString: null }, timing: false
			}],
			state: { cursors: {} },
			categories: [],
			plugins: []
		}
	});

	assert.ok(Array.isArray(posted));
	assert.equal(posted.length, 0);
});

test('File Add Save callback normalizes non-arrays and tolerates null or malformed legacy entries', () => {
	const loaded = makeSchedulePage();
	const methods = loaded.methods;
	const context = loaded.context;
	let dialogCallback;
	let nextName = 'safe.txt';
	let nextContent = 'safe content';
	let renderCount = 0;
	let errors = 0;

	context.get_form_table_row = (label, value) => value;
	context.get_form_table_spacer = () => '';
	context.setTimeout = () => {};
	context.$ = (selector) => ({
		val: () => selector === '#fe_ee_pp_file_name' ? nextName : nextContent
	});
	context.Dialog = { hide: () => {} };
	context.app = {
		confirm: (html, title, button, callback) => { dialogCallback = callback; },
		clearError: () => {},
		showMessage: () => { errors++; }
	};

	let page = {
		event: { files: { malformed: true } },
		get_safe_text_value: methods.get_safe_text_value,
		setFileEditor: () => {},
		render_file_list: () => { renderCount++; }
	};
	methods.file_add.call(page);
	assert.ok(Array.isArray(page.event.files));
	dialogCallback(true);
	assert.equal(page.event.files.length, 1);
	assert.equal(page.event.files[0].name, nextName);
	assert.equal(page.event.files[0].content, nextContent);

	nextName = 'second.txt';
	nextContent = 'second content';
	page = {
		event: { files: [null, { name: { toString: null }, content: '' }] },
		get_safe_text_value: methods.get_safe_text_value,
		setFileEditor: () => {},
		render_file_list: () => { renderCount++; }
	};
	methods.file_add.call(page);
	dialogCallback(true);
	assert.equal(page.event.files.length, 3);
	assert.equal(page.event.files[2].name, nextName);
	assert.equal(page.event.files[2].content, nextContent);
	assert.equal(errors, 0);
	assert.equal(renderCount, 2);
});

test('Create and update APIs discard caller-controlled secret previews', async () => {
	let api = makeEventApiHarness();
	await createEvent(api, {
		title: 'Create', enabled: 1, category: 'general', target: 'group', plugin: 'testplug',
		secret_preview: ATTACK
	});
	assert.equal(Object.prototype.hasOwnProperty.call(api.savedEvent, 'secret_preview'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(api.savedEvent, 'secret'), false);

	api = makeEventApiHarness();
	await updateEvent(api, { id: 'existing', title: 'Existing', secret_preview: ATTACK });
	assert.equal(Object.prototype.hasOwnProperty.call(api.savedPatch, 'secret_preview'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(api.savedPatch, 'secret'), false);

	const derived = { secret_preview: ATTACK, secret_value: 'FIRST=1\nSECOND=2' };
	api.prepareEventSecret(derived, true);
	assert.equal(derived.secret_preview, 'FIRST|SECOND');
	assert.deepEqual(derived.secret, { encrypted: 'FIRST=1\nSECOND=2' });
	assert.equal(derived.encrypted, true);
	assert.equal(Object.prototype.hasOwnProperty.call(derived, 'secret_value'), false);

	const emptyCreate = { secret_preview: ATTACK, secret_value: '' };
	api.prepareEventSecret(emptyCreate, false);
	assert.equal(Object.prototype.hasOwnProperty.call(emptyCreate, 'secret_preview'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(emptyCreate, 'secret'), false);

	const emptyUpdate = { secret_preview: ATTACK, secret_value: '' };
	api.prepareEventSecret(emptyUpdate, true);
	assert.equal(Object.prototype.hasOwnProperty.call(emptyUpdate, 'secret_preview'), true);
	assert.equal(emptyUpdate.secret_preview, undefined);
	assert.equal(emptyUpdate.secret, undefined);
});

module.exports = {
	setUp: function(callback) { callback(); },
	tests,
	tearDown: function(callback) { callback(); }
};
