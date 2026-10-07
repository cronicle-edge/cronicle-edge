'use strict';

const he = require('he');

function toWellFormedString(value) {
	const input = (value == null) ? '' : String(value);
	if (input.toWellFormed) return input.toWellFormed();

	let output = '';
	for (let idx = 0; idx < input.length; idx++) {
		const code = input.charCodeAt(idx);
		if ((code >= 0xD800) && (code <= 0xDBFF)) {
			const next = input.charCodeAt(idx + 1);
			if ((next >= 0xDC00) && (next <= 0xDFFF)) {
				output += input.charAt(idx) + input.charAt(++idx);
			}
			else output += '\uFFFD';
		}
		else if ((code >= 0xDC00) && (code <= 0xDFFF)) output += '\uFFFD';
		else output += input.charAt(idx);
	}
	return output;
}

function encodeHtml(value) {
	return he.encode(toWellFormedString(value));
}

function encodeQueryComponent(value) {
	return encodeURIComponent(toWellFormedString(value));
}

function getLogTitle(job) {
	job = job || {};
	let title = toWellFormedString(job.seq) + ' :: ' + (toWellFormedString(job.title) || 'Unknown');
	if (job.arg) title += '@' + toWellFormedString(job.arg);
	return title;
}

function getNiceStatus(job) {
	return job.code ?
		(job.code == 255 ? '<span style="color:orange"><b>⚠️</b></span>' : '<span style="color:red"><b>✗</b></span>') :
		'<span style="color:green"><b>✔</b></span>';
}

function buildLogControl(job, id) {
	const normalizedId = toWellFormedString(id);
	const logTitle = getLogTitle(job);
	return '<button type="button" class="workflow-log-toggle" aria-expanded="false"' +
		' aria-label="' + encodeHtml('View log: ' + logTitle) + '"' +
		' data-job-id="' + encodeHtml(normalizedId) + '"' +
		' data-log-title="' + encodeHtml(logTitle) + '"' +
		' style="cursor:pointer;border:0;background:transparent;padding:0;color:inherit">' +
		'<i class="fa fa-eye workflow-log-icon" aria-hidden="true"></i></button>';
}

function truncateText(value, maxLength) {
	return Array.from(toWellFormedString(value)).slice(0, maxLength).join('');
}

function textCell(value) {
	// The generic report renderer recognizes strings beginning with "filter:" as commands.
	// Wrapping workflow-controlled text prevents arguments from entering that dispatch path.
	return '<span>' + encodeHtml(value) + '</span>';
}

function buildWorkflowReportTable(jobStatus, niceInterval) {
	jobStatus = jobStatus || {};
	return {
		title: 'Workflow Events',
		header: [
			'#', 'title', 'arg', 'job', 'started at', 'elapsed', 'status', 'view log', 'description'
		],
		rows: Object.keys(jobStatus).map(function(key) {
			const job = jobStatus[key] || {};
			const normalizedKey = toWellFormedString(key);
			const isChildJob = key !== job.event;
			const title = toWellFormedString(job.title) || '[Unknown]';
			const titleStyle = (Number(job.code) % 255) ? 'color:red' : '';
			const jobLink = isChildJob ? '<a href="#JobDetails?id=' + encodeQueryComponent(normalizedKey) +
				'" target="_blank" rel="noopener noreferrer">' + encodeHtml(normalizedKey) + '</a>' : '';

			return [
				textCell(job.seq),
				'<span style="' + titleStyle + '"><b>' + encodeHtml(title) + '</b></span>',
				job.arg ? textCell(job.arg) : '',
				jobLink,
				textCell(job.start),
				textCell(niceInterval(job.elapsed)),
				getNiceStatus(job),
				isChildJob ? buildLogControl(job, normalizedKey) : '',
				textCell(truncateText(job.description, 120))
			];
		}),
		caption: ''
	};
}

module.exports = {
	buildWorkflowReportTable,
	encodeQueryComponent,
	getLogTitle,
	toWellFormedString
};
