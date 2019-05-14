'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const childProcess = require('child_process');
const WebSocket = require('ws');

// Settings:
const FilePath = '/recordings/';
const ServerPort = 3000;
const AudioDevice = 'hw:X18XR18,0';
const Bitrate = 24;
const SampleRate = 48000;
const Buffer = 262144;

// Globals:
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
	console[level]('[' + new Date().toLocaleString() + '] ' + color[level] + (errOrMsg ? errOrMsg.toString() : '') + color.reset);   // '\x1b[0m' = reset
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
	if (Number(msg)) {   // if a number was sent, that is the number of channels and our instruction to start recording. Note no recording if msg === 0
		if (typeof proc.exitCode !== 'number') logMsg('Tried to spawn a new recording, but already recording', 'error'); else {
			let fName = new Date(new Date() - 14400000).toISOString().slice(0,19).replace('T','_');   // cheap trick one-liner to take ISO time and convert to Eastern time zone and format output as 2019-05-07_15:23:12
			proc = childProcess.spawn('rec', ['-S', '-c', msg, '--buffer', Buffer, '-b', Bitrate, '-r', SampleRate, FilePath + fName + '.wav'], {env: {'AUDIODEV': AudioDevice}});
			proc.recStatus = '';
			proc.recStats = '';
			proc.stderr.on('data', dta => {
				let msg = dta.toString();
				if (msg.startsWith('\rIn:')) proc.recStatus = dta.toString();   // \n is console code to remove last line of the string
				else proc.recStats += msg;
			});
			proc.on('error', err => { if (proc.kill) proc.kill(); logMsg(err); wsMsg(ws, 'getStatus'); });
			proc.on('exit', code => { proc.exitCode = code; wsMsg(ws, 'getStatus'); });
		}
	} else if (msg === 'stopRecording') {
		if (proc.kill) proc.kill(); else logMsg('Unable to stop recording: probably no recording is in progress', 'error');
	} else if (msg === 'getStatus') {
		fs.readdir(FilePath, function(err, ls) {
			if (err) logMsg(err);
			wsSend(ws, JSON.stringify({isRecording: (typeof proc.exitCode === 'number') ? false : true, files: ls, recStats: proc.recStats, recStatus: proc.recStatus}));
		});
	} else if (msg === 'shutdown') {
		childProcess.exec('sudo /sbin/shutdown -h now', sErr => sErr ? logMsg(cOut) : null);
	} else if (msg === 'reboot') {
		childProcess.exec('sudo /sbin/shutdown -r now', sErr => sErr ? logMsg(cOut) : null);		
	} else if (msg.startsWith('DELETE:')) {
		fs.unlink(FilePath + msg.substring(7), err => {
			if (err) logMsg(`Unable to delete file "${msg.substring(7)}"`, 'error');
		});
	} else {  // anything else is assumed to be just a file name - get stats on a given file using soxi
		childProcess.exec('/usr/bin/soxi ' + FilePath + msg, (sErr, sStOut) => {
			if (sErr) logMsg(sErr);
			wsSend(ws, JSON.stringify({fileDetail: {fileName: msg, data: sStOut}}));
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
			if (request.url.endsWith('.wav')) {
				fs.readFile(FilePath + path.basename(request.url), (wErr, wFile) => {
					if (wErr) return logMsg(wErr);
					else {
						response.writeHead(200, {'Content-Type': 'audio/wave'});
						response.end(wFile);
					}
				});
			} else {
				response.writeHead(200, {'Content-Type': 'text/html'});
				response.end(pageTemplate);
			}
		});
		server.listen(ServerPort, err => {
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
				logMsg(`Server is listening on port ${ServerPort}`);
			}
		});
	}
});
