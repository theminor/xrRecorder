'use strict';
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

let proc = false;


/**
 * Log a message, optionally as an error
 * @param {Error || String} errOrMsg - an error Object or a message to log
 * @param {String} [level="info"] - the log level ("log", "info", "error", "debug", "warn", etc.)
 * @param {boolean} [logStack=false] - if true, the complete call stack will be logged to the console; by default only the message will be logged
 */
function logMsg(errOrMsg, level, logStack) {
	if (!level) level = (typeof errOrMsg === 'string') ? 'info' : 'error';
	if (typeof errOrMsg === 'string' && level === 'error') errOrMsg = new Error(errOrMsg);
	let color = level === 'error' ? '\x1b[31m' : (level === 'warn' ? color = '\x1b[33m' : '\x1b[32m');  // '\x1b[33m' = green ; '\x1b[31m' = red ; '\x1b[33m' = yellow
	console[level]('[' + new Date().toLocaleString() + '] ' + color + (errOrMsg.message || errOrMsg) + '\x1b[0m');   // '\x1b[0m' = reset
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
 * @param {Object} [ws] - the websocket to send response messages on
 * @param {String} [msg] - the websocket message in the form: {"cmd": "command", "data": "data", "oldTitle": "Old Title", ...}
 */
function wsMsg(ws, msg) {
	if (msg === 'startRecording') {
		if (proc) logMsg('Tried to spawn a new recording, but already recording', 'error') else {
			proc = spawn('rec', ['-S', '--buffer 262144', '-c 18', '-b 24', filename], {env: {'AUDIODEV':'hw:X18XR18,0'}});   // *** TO DO: review command line options; see https://dikant.de/2018/02/28/raspberry-xr18-recorder/
			proc.recStatus = '';
			proc.stderr.on('data', dta => proc.recStatus += dta);
			proc.on('error', err => logMsg(err));
			proc.on('exit', code => proc.exitCode = code);
		}
	} else if (msg === 'stopRecording') {
		if (proc && proc.kill) proc.kill(); else logMsg('Unable to stop recording: no recording is in progress', 'error');
	} else if (msg === 'getStatus') {
		wsSend(ws, JSON.stringify({isRecording: proc, files: []});   // *** TO DO: also send filenames
	} else logMsg(`Unknown command "${msg}" recieved on websocket`, 'warn')
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
					ws.on('message', msg => wsMsg(ws, msg));
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
