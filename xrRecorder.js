'use strict';
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const settings = require('./settings.json');

/**
 * Log a message, optionally as an error
 * @param {Error || String} errOrMsg - an error Object or a message to log
 * @param {String} [level="info"] - the log level ("log", "info", "error", "debug", "warn", etc.)
 * @param {boolean} [logStack=false] - if true, the complete call stack will be logged to the console; by default only the message will be logged
 */
function logMsg(errOrMsg, level, logStack) {
	if (!level) level = (typeof errOrMsg === 'string') ? 'info' : 'error';
	if (typeof errOrMsg === 'string' && level === 'error') errOrMsg = new Error(errOrMsg);
	let color = '\x1b[32m';  // green
		if (level === 'error') color = '\x1b[31m';  // red
		else if (level === 'warn') color = '\x1b[33m';  // yellow
	const resetColor = '\x1b[0m';
	console[level]('[' + new Date().toLocaleString() + '] ' + color + (errOrMsg.message || errOrMsg) + resetColor);
	if (logStack && errOrMsg.stack && (errOrMsg.stack.trim() !== '')) console[level](errOrMsg.stack);
}

/**
 * Send a data on the given websocket
 * @param {Object} [ws] - the websocket object. If not specified, nothing is sent
 * @param {Object} dta - the data to send
 */
function wsSend(ws, dta) {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(
		JSON.stringify(dta),
		err => err ? logMsg(err) : false   // return false if successful; otherwise return error
	) else return logMsg(`Websocket not ready for message "${dta}"`, 'error');
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
fs.readFile('./page.html', (err, pageTemplate) => {
	if (err) return logMsg(err);
	else {
		const server = http.createServer();
		server.on('request', (request, response) => {
			response.writeHead(200, {'Content-Type': 'text/html'});
			response.end(pageTemplate);
		});
		server.listen(80, err => {
			if (err) return 10000;
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
					}, 10000);
				});
				logMsg('Server is listening on port 80');
			}
		});
	}
});
