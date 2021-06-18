'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const childProcess = require('child_process');
const WebSocket = require('ws');

// Settings:
const FilePath = '/recordings/';
const ServerPort = 12380;

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
 * @param {Object} [msg] - the websocket message as an Object NOT as a String
 */
function wsMsg(ws, msg) {
	if (msg.startRecording) {
		if (typeof proc.exitCode !== 'number') logMsg('Tried to spawn a new recording, but already recording', 'error'); else {
			let fName = new Date(new Date() - 14400000).toISOString().slice(0,19).replace('T','_');   // cheap trick one-liner to take ISO time and convert to Eastern time zone and format output as 2019-05-07_15:23:12
console.log(msg.startRecording.audioDevice.numChannels);
			if (msg.startRecording.numChannels === 'mp3')
				proc = childProcess.spawn('rec', ['-S', '-c', '2', '-C', '256', '--buffer', msg.startRecording.buffer, FilePath + fName + '.mp3'], {env: {'AUDIODEV': msg.startRecording.audioDevice}});
			else
				proc = childProcess.spawn('rec', ['-S', '-c', msg.startRecording.numChannels, '--buffer', msg.startRecording.buffer, '-b', msg.startRecording.bitrate, '-r', msg.startRecording.samplerate, FilePath + fName + '.wav'], {env: {'AUDIODEV': msg.startRecording.audioDevice}});
			proc.recStatus = '';
			proc.recStats = '';
			proc.stderr.on('data', dta => {
				let otp = dta.toString();
				if (otp.startsWith('\rIn:')) proc.recStatus = dta.toString();   // \n is console code to remove last line of the string
				else proc.recStats += otp;
			});
			proc.on('error', err => { if (proc.kill) proc.kill(); logMsg(err); wsMsg(ws, {getStatus: true}); });
			proc.on('exit', code => { proc.exitCode = code; wsMsg(ws, {getStatus: true}); });
		}
	} else if (msg.stopRecording) {
		if (proc.kill) proc.kill(); else logMsg('Unable to stop recording: probably no recording is in progress', 'error');
	} else if (msg.getStatus) {
		wsSend(ws, JSON.stringify({isRecording: (typeof proc.exitCode === 'number') ? false : true, recStats: proc.recStats, recStatus: proc.recStatus}));
	} else if (msg.getFileList) {
		fs.readdir(FilePath, function(err, ls) {
			if (err) logMsg(err);
			wsSend(ws, JSON.stringify({files: ls}));
		});
	} else if (msg.shutdown) {
		childProcess.exec('sudo /sbin/shutdown -h now', sErr => sErr ? logMsg(cOut) : null);
	} else if (msg.reboot) {
		childProcess.exec('sudo /sbin/shutdown -r now', sErr => sErr ? logMsg(cOut) : null);		
	} else if (msg.deleteFile) {
		fs.unlink(FilePath + msg.deleteFile, delErr => {
			if (delErr) logMsg(delErr);
		});
	} else if (msg.getDetails) {
		childProcess.exec('/usr/bin/soxi ' + FilePath + msg.getDetails, (sErr, sStOut) => {
			if (sErr) logMsg(sErr);
			wsSend(ws, JSON.stringify({fileDetail: {fileName: msg.getDetails, data: sStOut}}));
		});
	} else if (msg.getRecDevices) {
		childProcess.exec('arecord -l', (gErr, stOut, stErr) => {   // alternatively, consider using "cat /proc/asound/cards"
			if (gErr) logMsg(gErr);
			const arecordRegEx = /card (\d+): ([^ ]+) \[([^\]]+)\]/g;
			const lines = stOut.split('\n');
			let devs = [];
			for (let i = 0; i < lines.length; i++) {
				let match = arecordRegEx.exec(lines[i]);   // matches formatted like: ["card 2: X18XR18 [X18/XR18]", "2", "X18XR18", "X18/XR18"]
				// if (match) devs.push(match);
				if (match) devs.push({fullInfo: match[0], cardNum: match[1], hwName: match[2], name: match[3]});
			}
			wsSend(ws, JSON.stringify({recDevices: devs}));		
		});
	}
	if (!msg.getStatus) wsMsg(ws, {getStatus: true});
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
					ws.on('message', msg => wsMsg(ws, JSON.parse(msg)));
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
