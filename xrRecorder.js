
'use strict';
const fs = require('fs').promises;
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const settings = require('./settings.json');


/**
 * Log a message, optionally as an error, optionally sending on a websocket
 * @param {Error || String} errOrMsg - an error Object or a message to log
 * @param {String} [level="warn"] - the log level ("log", "info", "error", "debug", "warn", etc.)
 * @param {Object} [ws] - the websocket object. If specified, the message will also be sent on the websocket; otherwise it will only be logged on the server
 * @param {boolean} [logStack=false] - if true, the complete call stack will be logged to the console; by default only the message will be logged
 */
function logMsg(errOrMsg, reject, linksStatElmnt, ws, level, logStack) {
	if (!level) level = (typeof errOrMsg === 'string') ? 'info' : 'error';										// if level wasn't supplied, set to info unless the message is of type error, in which case, set to type error
	if (typeof errOrMsg === 'string' && level === 'error') errOrMsg = new Error(errOrMsg);						// if a string was supplied, but level was specified to be type error, convert the message to type error
	const baseMsg = errOrMsg.message || errOrMsg;
	const logDateString = new Date().toLocaleString();
	if (constants.log.levels[level].levelNum >= constants.log.levels[settings.logging.level].levelNum) {		// only display in console if settings allow for the appropriate log level
		let consoleMsg = constants.log.text.reset;
		if (settings.logging.timeStamp) consoleMsg += '[' + constants.log.text.fgColor[settings.logging.timeStamp] + logDateString + constants.log.text.reset + '] ';
		consoleMsg += constants.log.text.fgColor[constants.log.levels[level].color];
		consoleMsg += baseMsg + constants.log.text.reset;
		if (logStack && errOrMsg.stack && (errOrMsg.stack.trim() !== '')) consoleMsg += '\n' + errOrMsg.stack;	// tack on the err.stack only if logStack is true and an err.stack actually exists and isn't empty
		console[level || constants.log.level.warn](consoleMsg);													// Finally, output the complete consoleMsg
	}
	if (ws) wsSend((settings.logging.timeStamp ? '[' + logDateString + '] [' + level + '] ' : '') + baseMsg);	// send the message to the websocket; include the timestamp and log level only if timestamp is true in the settings (otherwise, just the message alone)
}

/**
 * Send a data on the given websocket
 * @param {Object} [ws] - the websocket object. If not specified, nothing is sent
 * @param {Object} dta - the data to send
 */
function wsSend(ws, dta) {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(
		JSON.stringify(dta),
		err => err ? logMsg(err) : false		// return false if successful; otherwise return error
	) else return logMsg('Websocket not ready', constants.log.level.error);
}

/**
 * Load static server pages from disk into the server cache: settings.server.files[fileName].contents
 */
async function loadServerCache() {
	for (const fileInfo of Object.values(settings.server.files)) {
		fileInfo.contents = await fs.readFile(fileInfo.path).catch(err => logMsg(err));
	}
}

/**
 * Handle incoming data on the given websocket
 * @param {String} [msg] - the websocket message in the form: {"cmd": "command", "data": "data", "oldTitle": "Old Title", ...}
 */
async function wsMsg(msgString) {
	const msg = JSON.parse(msg);

	
}

/**
 * Entry Point
 */
loadServerCache().then(loadActiveMatters());
const server = http.createServer();
server.on('request', (request, response) => {
	try {
		let fileName = path.basename(request.url);
		if (request.url.endsWith('/') || fileName === '' || fileName === 'index.html' || fileName === 'index.htm') fileName = 'frontend.html';
		if (settings.server.files[fileName]) {
			response.writeHead(200, settings.server.files[fileName].head);
			response.end(settings.server.files[fileName].contents);		
		} else {
			logMsg('Client requested a file not in server file cache: "' + request.url + '" (parsed to filename: ' + fileName + ')');
			response.writeHead(404, {"Content-Type": "text/plain"});
			response.end('404 Not Found\n');	
		}
	} catch(err) { logMsg(err); }
});
server.listen(settings.server.port, err => {
	if (err) return logMsg(err);
	else {
		const wss = new WebSocket.Server({server});
		wss.on('connection', ws => {
			function closeWs(ws, err) {
				if (err && !err.message.includes('CLOSED')) logMsg(err);
				clearInterval(ws.pingTimer);
				return ws.terminate();
			}
			ws.isAlive = true;
			ws.on('message', msg => wsMsg(msg));
			ws.on('pong', () => ws.isAlive = true);
			ws.pingTimer = setInterval(() => {
				if (ws.isAlive === false) return closeWs(ws);
				ws.isAlive = false;
				ws.ping(err => { if (err) return closeWs(ws, err); });
			}, settings.server.pingInterval);
		});
		console.log('Server ' + settings.server.name + ' (http' + (settings.server.https ? 's://' : '://') + settings.server.address + ') is listening on port ' + settings.server.port);
	}
});
