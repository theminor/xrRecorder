'use strict';
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require('ws');

// Settings:
const FilePath = '/recordings/';
const AudioDevice = 'hw:X18XR18,0';
const BufferSize = 262144;
const Bitrate = 16;   // 24?
const Encoding = 'signed-integer';
const SampleRate = 44100;

let proc = {exitCode: -1};


/**
 * Log a message, optionally as an error
 * @param {Error || String} errOrMsg - an error Object or a message to log
 * @param {String} [level="info"] - the log level ("log", "info", "error", "debug", "warn", etc.)
 * @param {boolean} [logStack=false] - if true, the complete call stack will be logged to the console; by default only the message will be logged
 */
function logMsg(errOrMsg, level, logStack) {
	const color = { error: '\x1b[31m', warn: '\x1b[33m', log: '\x1b[33m', info: '\x1b[36m', reset: '\x1b[0m' }  // red, yellow, green, cyan, reset
	if (!level) level = (typeof errOrMsg === 'string') ? 'info' : 'error';
	if (typeof errOrMsg === 'string' && level === 'error') errOrMsg = new Error(errOrMsg);	
	console[level]('[' + new Date().toLocaleString() + '] ' + color[level] + (errOrMsg.message || errOrMsg) + color.reset);   // '\x1b[0m' = reset
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
		err => err ? logMsg(err) : false
	); else return logMsg(`Websocket not ready for message "${dta}"`, 'error');
}

/**
 * Handle incoming data on the given websocket
 * @param {Object} [ws] - the websocket to send response messages on
 * @param {String} [msg] - the websocket message in the form: {"cmd": "command", "data": "data", "oldTitle": "Old Title", ...}
 */
function wsMsg(ws, msg) {
	if (parseInt(msg)) {   // if a number was sent, that is the number of channels and our instruction to start recording. Note no recording if msg === 0
		if (typeof proc.exitCode !== 'number') logMsg('Tried to spawn a new recording, but already recording', 'error') else {
			let fName = new Date(new Date() - 14400000).toISOString().slice(0,19).replace('T',' ');   // cheap trick one-liner to take ISO time and convert to Eastern time zone and format output as 2019-05-07 15:23:12
			proc = spawn('rec', ['-S', `--buffer ${BufferSize}`, `-c ${parseInt(msg)}`, `-b ${Bitrate}`, `-e ${Encoding}`, `-r ${SampleRate}`, FilePath + fName + '.wav'], {env: {'AUDIODEV': AudioDevice}});
			proc.recStatus = '';
			proc.stderr.on('data', dta => proc.recStatus += dta);
			proc.on('error', err => { if (proc.kill) proc.kill(); logMsg(err)); }
			proc.on('exit', code => proc.exitCode = code);
		}
	} else if (msg === 'stopRecording') {
		if (proc.kill) proc.kill(); else logMsg('Unable to stop recording: probably no recording is in progress', 'error');
	} else if (msg === 'getStatus') {
		fs.readdir(FilePath, function(err, ls) {
			if (err) logMsg(err);
			wsSend(ws, JSON.stringify({isRecording: proc, files: ls}));
		});
	} else {   // any other string will be taken as a file name to attempt to delete
		fs.unlink(FilePath + msg, err => {
			if (err) logMsg(`Unable to delete file "${msg}"`, 'error');
		});
	}
	if (msg !== 'getStatus') wsMsg(ws, 'getStatus');
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
