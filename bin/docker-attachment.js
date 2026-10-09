const path = require('path');

function normalizeDockerAttachmentName(name, reservedNames) {
	if (typeof name !== 'string') throw new Error('Attachment filename must be a string');

	const normalized = path.posix.normalize(name);
	const unsafe = !normalized || (normalized === '.') || path.posix.isAbsolute(normalized) ||
		name.includes('\\') || name.split('/').includes('..') || /[\0\r\n]/.test(name) ||
		reservedNames.has(normalized);

	if (unsafe) throw new Error('Invalid Docker attachment filename: ' + name);
	return normalized;
}

module.exports = { normalizeDockerAttachmentName };
